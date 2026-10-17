/**
 * FooterCredit — the one line that says who built this.
 *
 * OpenCircle was authored end to end in Arc Studio, Circle's agentic builder,
 * so that is the credit the project wants shown. Circle is still named
 * alongside it because Circle is what actually runs the wallet — crediting the
 * builder without the runtime would be a misleading half-truth.
 *
 * Rendered on both the setup screen and the main screen so the credit is
 * visible whichever one you land on.
 */
const ARC_STUDIO_URL = 'https://studio.arc.io'

export function FooterCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs ${className}`} style={{ color: '#8a849c' }}>
      <a
        href={ARC_STUDIO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold underline-offset-2 transition-colors hover:underline"
        style={{ color: '#6b6580' }}
      >
        Built on Arc Studio
      </a>
      {' · Open source · 100% Circle · Arc Mainnet'}
    </p>
  )
}