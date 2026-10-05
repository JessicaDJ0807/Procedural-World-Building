/**
 * What Three.js reads.
 *
 * The application's own colours live in `src/index.css` as design tokens and
 * never reach this file. The split matters: the UI is deliberately neutral so
 * that a generated world is the only thing on screen with colour in it, and a
 * token leaking from the chrome into a viewport would undo exactly that. Only
 * one value exists in both places, and it is paired by hand below.
 */

/**
 * The accent a *visualization* starts on — Topic 1's default material, Topic 2's
 * default tint, and the top of the single-hue ramp.
 *
 * Not the UI accent. The interface uses a desaturated slate blue (`--accent` in
 * `index.css`), which is the right choice for chrome sitting under text and the
 * wrong one for a 3D surface: the same restraint that keeps a button from
 * glowing makes a lit object look washed out. This one also sets the top of the
 * single-hue colour ramp, which is measured at 86 distinguishable steps in
 * `docs/topics/topic-2-maps.md` — changing it would move that number.
 */
export const VIZ_ACCENT = '#6ea8fe'

/**
 * The ground every viewport sits on.
 *
 * Dark, but deliberately not near-black. Against near-black a muted surface
 * glows by contrast, which is most of what reads as "sci-fi" in a stylised
 * render — it was the main cause of Topic 4's first palette looking like wet
 * plastic, more than the specular was. A few percent of lightness removes that
 * without giving up the dark.
 *
 * It is now neutral. Two earlier versions both had a hue and both were wrong in
 * opposite directions: 0x1c1a24 was violet, and the cool cast fought the warm
 * clay, peach, sand and sage surfaces standing on it. The fix at the time was to
 * invert the hue — 0x201d1a, warm, red the highest channel — which stopped the
 * fight but put a brown cast across every page, and that cast is most of what
 * read as muddy once the chrome around it went neutral.
 *
 * Neutral is the option neither attempt tried. A ground with no hue cannot be in
 * opposition to a surface of any hue, so the warm palettes keep their warmth and
 * nothing has to be traded for it. The contrast that remains is lightness, which
 * is the one carrying the form.
 *
 * Topics 1-3 each hardcoded 0x111218 separately, so they matched by accident
 * rather than by decision. One constant, so the next topic inherits it.
 *
 * Paired with `--viewport-bg` in `index.css`, which paints the page before any
 * canvas has drawn. The two must agree or there is a visible seam; they are
 * checked against each other rather than trusted.
 */
export const VIEWPORT_BACKGROUND = 0x1a1c1e

/** The bottom of the gradient, for viewports that use one rather than a fill. */
export const VIEWPORT_BACKGROUND_LOW = 0x141517

/** `#rrggbb` to three channels in [0, 1]. Malformed input falls back to white. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  if (!Number.isFinite(value)) return [1, 1, 1]
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
