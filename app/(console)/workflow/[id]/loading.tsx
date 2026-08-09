/**
 * Instant shell for the run view.
 *
 * `page.tsx` is an async server component, so without a loading boundary
 * `router.push('/workflow/:id')` held the user on the home page — button
 * still reading "Thinking…" — until the RSC payload for the new segment
 * came back. The work was already done by then; only the swap was late.
 *
 * This renders immediately on navigation, so the jump happens the moment
 * the workflow exists and the real view streams in behind it. The layout
 * mirrors WorkflowView's first screen (title, status, progress bar,
 * deliverable panel) so the transition doesn't visibly reflow.
 *
 * Note: Next 16 also offers `unstable_instant` for validated instant
 * navigation, but it requires `cacheComponents: true` app-wide — a much
 * larger change than this route needs.
 */
export default function Loading() {
  return (
    <main className="gwt-page">
      <div className="gwt-wrap">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Workflow</div>
            <div className="gwt-skel mt-2 h-[19px] w-[min(420px,70%)]" />
          </div>
          <div className="gwt-skel h-[15px] w-16" />
        </div>

        <div className="mt-3">
          <div className="gwt-bar">
            <span style={{ width: '0%' }} />
          </div>
        </div>

        <div className="gwt-h">Deliverable</div>
        <div className="gwt-panel gwt-deliver">
          <div className="gwt-panel-bar">
            <span>final report · pending</span>
          </div>
          <div className="space-y-2.5 p-4">
            <div className="gwt-skel h-3 w-[85%]" />
            <div className="gwt-skel h-3 w-[70%]" />
            <div className="gwt-skel h-3 w-[78%]" />
          </div>
        </div>
      </div>
    </main>
  )
}
