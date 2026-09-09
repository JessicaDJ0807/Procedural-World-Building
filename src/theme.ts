/** The accent blue Week 1 starts its material on, and Week 2 tints its field with. */
export const ACCENT_BLUE = '#6ea8fe'

/** `#rrggbb` to three channels in [0, 1]. Malformed input falls back to white. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  if (!Number.isFinite(value)) return [1, 1, 1]
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
