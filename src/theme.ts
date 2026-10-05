/** The accent blue Topic 1 starts its material on, and Topic 2 tints its field with. */
export const ACCENT_BLUE = '#6ea8fe'

/**
 * The ground every viewport sits on.
 *
 * Dark, but deliberately not near-black. Against near-black a muted surface
 * glows by contrast, which is most of what reads as "sci-fi" in a stylised
 * render — it was the main cause of Topic 4's first palette looking like wet
 * plastic, more than the specular was. A few percent of lightness and a hue
 * to sit against removes that without giving up the dark.
 *
 * The hue is warm: red is the highest channel, blue the lowest. An earlier
 * version ran the other way, 0x1c1a24, and the violet cast fought the surfaces
 * standing on it — the palettes above are clay, peach, sand and sage, every
 * one of them warm, so a cool ground put the whole page in opposition to
 * itself. Warm ground, warm surfaces: the contrast that remains is lightness,
 * which is the one carrying the form.
 *
 * Topics 1–3 each hardcoded 0x111218 separately, so they matched by accident
 * rather than by decision. One constant, so the next topic inherits it.
 */
export const VIEWPORT_BACKGROUND = 0x201d1a

/** The bottom of the gradient, for viewports that use one rather than a fill. */
export const VIEWPORT_BACKGROUND_LOW = 0x181613

/** `#rrggbb` to three channels in [0, 1]. Malformed input falls back to white. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  if (!Number.isFinite(value)) return [1, 1, 1]
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
