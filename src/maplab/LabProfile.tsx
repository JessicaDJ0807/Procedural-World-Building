type LabProfileProps = {
  resolution: number
  field: Float32Array
  row: number
  seaLevel: number
}

const WIDTH = 600
const HEIGHT = 110

/**
 * A slice through the terrain along the chosen row.
 *
 * The vertical axis is the value, 0 to 1 — height up to the current amplitude
 * — stretched to fill the strip. It started fixed at the amplitude slider's
 * maximum so that amplitude would visibly flatten it, and that made every
 * profile a near-flat line: a strip about 1,020 × 96 pixels against a 1.5 axis
 * compresses a 2.4-wide tile 6.6 times vertically. The shape is
 * what the strip is for; the terrain beside it shows the amplitude.
 */
export function LabProfile({ resolution, field, row, seaLevel }: LabProfileProps) {
  const r = resolution
  const toX = (i: number) => (i / (r - 1)) * WIDTH
  const toY = (value: number) => HEIGHT - 4 - value * (HEIGHT - 8)

  let ground = `M 0 ${HEIGHT}`
  for (let x = 0; x < r; x++) {
    ground += ` L ${toX(x).toFixed(1)} ${toY(field[row * r + x]).toFixed(1)}`
  }
  ground += ` L ${WIDTH} ${HEIGHT} Z`
  const sea = toY(seaLevel)

  return (
    <svg
      className="lab-profile"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Height profile along row ${row}`}
    >
      <path d={ground} className="lab-profile-ground" />
      {/* Over the ground, translucent: the seabed should read through it. */}
      {seaLevel > 0 && <rect x={0} y={sea} width={WIDTH} height={HEIGHT - sea} className="lab-profile-sea" />}
    </svg>
  )
}
