/**
 * Footer — product identity plus the Arc attribution the brand guidelines
 * require of partners.
 *
 * What arc.io/brand-guidelines-and-partner-toolkit actually asks for, and
 * how each rule is met here:
 *
 *   "Only use the latest Arc logo versions from the Circle Brand Kit."
 *      → No Arc logo appears anywhere. The guidelines permit unmodified
 *        files from Circle's kit only, and redrawing the mark in SVG is
 *        precisely the modification they prohibit ("Modify or distort the
 *        logo, change its colors, add new elements"). Attribution here is
 *        text-only. If you later obtain the official asset, drop it in
 *        unaltered with its own clear space — do not trace it.
 *
 *   "Arc Network (first instance), then Arc thereafter."
 *      → The first line says "Arc™ Network"; the contract links below say
 *        "Arc".
 *
 *   "Use ™ with the first or most prominent use when practical."
 *      → On that first mention.
 *
 *   "Arc is a trademark of Circle Internet Group, Inc. and/or its
 *    affiliates."
 *      → Reproduced verbatim in the legal line.
 *
 *   Prohibited: pluralising, possessives, or implying a relationship that
 *   does not exist.
 *      → The wording is "Built on Arc™ Network", an approved form. There
 *        is no claim of partnership or endorsement.
 */
import Link from 'next/link'

import { LogoMark } from '@/components/console/Logo'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
const CHAIN_ID = process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002'
const IDENTITY_REGISTRY = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ?? ''
const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS ?? ''

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/deploy', label: 'Deploy' },
  { href: '/billing', label: 'Vault' },
  { href: '/history', label: 'History' },
]

function Contract({ label, address }: { label: string; address: string }) {
  if (!address) return null
  return (
    <a
      className="gwt-foot-link"
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {label} <span className="gwt-addr">{address.slice(0, 6)}…{address.slice(-4)}</span>
    </a>
  )
}

export function Footer() {
  return (
    <footer className="gwt-footer">
      <div className="gwt-footer-inner">
        <div className="gwt-foot-brand">
          <LogoMark size={30} id="gw-foot" />
          <div>
            <div className="gwt-foot-name">GIGAWORK</div>
            <p className="gwt-foot-tag">
              Hire verified agents, pay them per call, keep the receipts on-chain.
            </p>
          </div>
        </div>

        <nav className="gwt-foot-col">
          <div className="gwt-foot-h">Product</div>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="gwt-foot-link">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="gwt-foot-col">
          <div className="gwt-foot-h">On-chain</div>
          <span className="gwt-foot-link gwt-foot-static">Arc Testnet · chain {CHAIN_ID}</span>
          <Contract label="Identity" address={IDENTITY_REGISTRY} />
          <Contract label="USDC" address={USDC} />
          <a className="gwt-foot-link" href={EXPLORER} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
        </div>

        <div className="gwt-foot-col">
          <div className="gwt-foot-h">Standards</div>
          <span className="gwt-foot-link gwt-foot-static">ERC-8004 identity &amp; reputation</span>
          <span className="gwt-foot-link gwt-foot-static">ERC-8183 agentic commerce</span>
          <span className="gwt-foot-link gwt-foot-static">x402 per-call settlement</span>
        </div>
      </div>

      <div className="gwt-footer-legal">
        <span>
          Built on <strong className="text-white/60">Arc™ Network</strong>. Testnet only — balances
          and payments shown here are testnet value.
        </span>
        <span>
          Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates. GigaWork is not
          affiliated with or endorsed by Circle.
        </span>
      </div>
    </footer>
  )
}
