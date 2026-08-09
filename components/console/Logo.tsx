/**
 * GigaWork mark.
 *
 * A hexagon — one agent — holding a three-node graph: two workers feeding
 * a synthesiser. That is literally the shape every run takes here, and the
 * shape the run page draws, so the mark says what the product does rather
 * than being decoration.
 *
 * Drawn inline rather than served as an <img> so it inherits the page's
 * accent tokens and stays crisp at 20px in the header and 96px on a
 * splash. `gradientUnits="userSpaceOnUse"` keeps the gradient angle
 * identical at every size — with the default objectBoundingBox it skews
 * when the viewBox is not square.
 *
 * This is OUR mark. The Arc logo is deliberately not reproduced anywhere
 * in this codebase: Arc's guidelines allow partner use only of unmodified
 * files taken from Circle's own brand kit, so redrawing it in SVG would
 * be exactly the modification they prohibit. Attribution to Arc is
 * text-only — see components/console/Footer.tsx.
 */
export function LogoMark({
  size = 28,
  id = 'gw',
}: {
  size?: number
  /** Unique per instance: duplicate gradient ids make later marks render
   *  with the first one's fill. */
  id?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="GigaWork"
    >
      <defs>
        <linearGradient id={`${id}-stroke`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--gw-cyan)" />
          <stop offset="1" stopColor="var(--gw-violet)" />
        </linearGradient>
      </defs>

      {/* Hexagon shell — the agent boundary. */}
      <path
        d="M16 1.8 28.4 8.9V23.1L16 30.2 3.6 23.1V8.9L16 1.8Z"
        stroke={`url(#${id}-stroke)`}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />

      {/* Edges first so the nodes sit on top of them. */}
      <path
        d="M10.6 12.4 16 20.4M21.4 12.4 16 20.4"
        stroke={`url(#${id}-stroke)`}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />

      {/* Two workers… */}
      <circle cx="10.6" cy="11.6" r="2.5" fill="var(--gw-cyan)" />
      <circle cx="21.4" cy="11.6" r="2.5" fill="var(--gw-violet)" />
      {/* …feeding the synthesiser. */}
      <circle cx="16" cy="21.2" r="2.9" fill="#eef2f7" />
    </svg>
  )
}

/** Mark + wordmark, for the header and anywhere the name is needed. */
export function Logo({ size = 26, id = 'gw' }: { size?: number; id?: string }) {
  return (
    <span className="gwt-logo">
      <LogoMark size={size} id={id} />
      <span className="gwt-logo-text">
        GIGA<span className="gwt-logo-accent">WORK</span>
      </span>
    </span>
  )
}
