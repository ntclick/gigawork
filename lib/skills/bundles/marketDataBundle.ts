import { type SkillHandler } from '../handlers'
import { runSource, summarizeSources, type SourceResult } from './sourceRunner'
import { withTimeout } from '../../workflow/timing'
import { workflowRuntimeConfig } from '../../workflow/runtimeConfig'

export function createMarketDataBundleHandler(
  getSkill: (name: string) => SkillHandler | undefined,
): SkillHandler {
  return async (input) => {
    const timeoutMs = workflowRuntimeConfig.bundleTimeoutMs || 12_000

    const tokenAddress = input.token_address as string | undefined
    const chain = input.chain as string | undefined
    const symbol = input.symbol as string | undefined
    const timeframe = input.timeframe as string | undefined
    const marketSlug = input.market_slug as string | undefined
    const query = input.query as string | undefined
    const topN = input.top_n as number | undefined
    const minTvlUsd = input.min_tvl_usd as number | undefined
    const stablecoinOnly = input.stablecoin_only as boolean | undefined

    const scannerSkill = getSkill('crypto-scanner')
    const yieldsSkill = getSkill('defi-yields')
    const signalsSkill = getSkill('trading-signals')
    const polymarketSkill = getSkill('polymarket-pulse')

    const sourcesToRun: Promise<SourceResult<unknown>>[] = []

    // 1. Crypto Scanner
    if (scannerSkill && tokenAddress) {
      sourcesToRun.push(
        runSource('crypto-scanner', () =>
          withTimeout('crypto-scanner', timeoutMs - 1000, () =>
            Promise.resolve(scannerSkill({ token_address: tokenAddress, chain: chain || 'ethereum' }))
          )
        )
      )
    } else if (scannerSkill) {
      sourcesToRun.push(
        Promise.resolve({
          source: 'crypto-scanner',
          ok: false,
          durationMs: 0,
          error: 'Skipped: token_address missing'
        })
      )
    } else {
      sourcesToRun.push(
        Promise.resolve({
          source: 'crypto-scanner',
          ok: false,
          durationMs: 0,
          error: 'Failed: crypto-scanner skill not registered'
        })
      )
    }

    // 2. DeFi Yields
    if (yieldsSkill) {
      sourcesToRun.push(
        runSource('defi-yields', () =>
          withTimeout('defi-yields', timeoutMs - 1000, () =>
            Promise.resolve(
              yieldsSkill({
                top_n: topN ?? 10,
                min_tvl_usd: minTvlUsd ?? 1000000,
                stablecoin_only: stablecoinOnly ?? false,
              })
            )
          )
        )
      )
    } else {
      sourcesToRun.push(
        Promise.resolve({
          source: 'defi-yields',
          ok: false,
          durationMs: 0,
          error: 'Failed: defi-yields skill not registered'
        })
      )
    }

    // 3. Trading Signals
    if (signalsSkill) {
      sourcesToRun.push(
        runSource('trading-signals', () =>
          withTimeout('trading-signals', timeoutMs - 1000, () =>
            Promise.resolve(
              signalsSkill({
                symbol: symbol || 'BTC/USDT',
                timeframe: timeframe || '4h',
                exchange: 'binance',
              })
            )
          )
        )
      )
    } else {
      sourcesToRun.push(
        Promise.resolve({
          source: 'trading-signals',
          ok: false,
          durationMs: 0,
          error: 'Failed: trading-signals skill not registered'
        })
      )
    }

    // 4. Polymarket Pulse
    if (polymarketSkill && (marketSlug || query)) {
      sourcesToRun.push(
        runSource('polymarket-pulse', () =>
          withTimeout('polymarket-pulse', timeoutMs - 1000, () =>
            Promise.resolve(polymarketSkill({ market_slug: marketSlug || query }))
          )
        )
      )
    } else if (polymarketSkill) {
      sourcesToRun.push(
        Promise.resolve({
          source: 'polymarket-pulse',
          ok: false,
          durationMs: 0,
          error: 'Skipped: market_slug and query missing'
        })
      )
    } else {
      sourcesToRun.push(
        Promise.resolve({
          source: 'polymarket-pulse',
          ok: false,
          durationMs: 0,
          error: 'Failed: polymarket-pulse skill not registered'
        })
      )
    }

    // Run parallel sources using Promise.all as runSource handles errors inside
    const results = await Promise.all(sourcesToRun)
    const summary = summarizeSources(results)

    const data: Record<string, unknown> = {}
    for (const r of results) {
      if (r.ok) {
        data[r.source] = r.data
      } else {
        data[r.source] = { error: r.error || 'Unknown error during execution' }
      }
    }

    return {
      bundle: 'market-data-bundle',
      partial: summary.partial,
      sources_ok: summary.ok,
      sources_failed: summary.failed,
      data,
      generated_at: new Date().toISOString(),
    }
  }
}
