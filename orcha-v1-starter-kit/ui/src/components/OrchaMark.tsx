const BARS = [
  { from: [7, 24, 13, 6], to: [6, 10, 26, 10], color: 'currentColor' },
  { from: [14, 26, 21, 7], to: [6, 16, 26, 16], color: 'currentColor' },
  { from: [22, 27, 28, 11], to: [6, 22, 26, 22], color: '#2B7FFF' },
] as const

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function OrchaMark({ size = 28, open = 0 }: { size?: number; open?: number }) {
  return (
    <svg
      className="orcha-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      {BARS.map((bar, i) => {
        const [x1, y1, x2, y2] = bar.from.map((n, idx) => mix(n, bar.to[idx], open))
        return (
          <path
            key={i}
            d={`M${x1} ${y1} ${x2} ${y2}`}
            fill="none"
            stroke={bar.color}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}
