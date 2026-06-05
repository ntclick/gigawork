import { type SkillHandler } from '../handlers'
import { runSource, summarizeSources, type SourceResult } from './sourceRunner'
import { withTimeout } from '../../workflow/timing'
import { workflowRuntimeConfig } from '../../workflow/runtimeConfig'

export function createSocialLiteBundleHandler(
  getSkill: (name: string) => SkillHandler | undefined,
): SkillHandler {
  return async (input) => {
    const timeoutMs = workflowRuntimeConfig.bundleTimeoutMs || 12_000
    const slowSkillsAsync = workflowRuntimeConfig.slowSkillsAsync

    const topic = (input.topic as string | undefined) ?? (input.keyword as string | undefined) ?? (input.query as string | undefined) ?? 'Bitcoin'
    const windowHours = Number(input.window_hours ?? 24)

    const socialSentimentSkill = getSkill('social-sentiment')
    const webIntelSkill = getSkill('web-intel')

    const sourcesToRun: Promise<SourceResult<unknown>>[] = []
    const slowSourcesDeferred: string[] = []

    // 1. Reddit Sentiment (always run, fast)
    if (socialSentimentSkill) {
      // If slowSkillsAsync is true, run Reddit-only. Otherwise, run both.
      const channels = slowSkillsAsync ? ['reddit'] : ['reddit', 'twitter']
      if (slowSkillsAsync && process.env.APIFY_API_TOKEN) {
        slowSourcesDeferred.push('twitter_apify')
      }
      sourcesToRun.push(
        runSource('social-sentiment', () =>
          withTimeout('social-sentiment', timeoutMs - 1000, () =>
            Promise.resolve(socialSentimentSkill({ topic, window_hours: windowHours, channels }))
          )
        )
      )
    } else {
      sourcesToRun.push(
        Promise.resolve({
          source: 'social-sentiment',
          ok: false,
          durationMs: 0,
          error: 'Failed: social-sentiment skill not registered'
        })
      )
    }

    // 2. Web Intel (defer if slowSkillsAsync is true)
    if (webIntelSkill) {
      if (slowSkillsAsync) {
        slowSourcesDeferred.push('web_intel')
      } else {
        sourcesToRun.push(
          runSource('web-intel', () =>
            withTimeout('web-intel', timeoutMs - 1000, () =>
              Promise.resolve(webIntelSkill({ query: topic }))
            )
          )
        )
      }
    } else if (!slowSkillsAsync) {
      sourcesToRun.push(
        Promise.resolve({
          source: 'web-intel',
          ok: false,
          durationMs: 0,
          error: 'Failed: web-intel skill not registered'
        })
      )
    }

    const results = await Promise.all(sourcesToRun)
    const summary = summarizeSources(results)

    const data: Record<string, unknown> = {}
    let sentimentScore: number | null = null
    let samplePosts: unknown[] = []

    for (const r of results) {
      if (r.ok) {
        data[r.source] = r.data
        if (r.source === 'social-sentiment' && r.data && typeof r.data === 'object') {
          const sentimentObj = r.data as Record<string, unknown>
          if (typeof sentimentObj.sentiment_score === 'number') {
            sentimentScore = sentimentObj.sentiment_score
          }
          if (Array.isArray(sentimentObj.posts)) {
            samplePosts = sentimentObj.posts
          }
        }
      } else {
        data[r.source] = { error: r.error || 'Unknown error' }
      }
    }

    return {
      bundle: 'social-lite-bundle',
      partial: summary.partial,
      slow_sources_deferred: slowSourcesDeferred,
      sources_ok: summary.ok,
      sources_failed: summary.failed,
      sentiment_score: sentimentScore,
      sample_posts: samplePosts,
      data,
      generated_at: new Date().toISOString(),
    }
  }
}
