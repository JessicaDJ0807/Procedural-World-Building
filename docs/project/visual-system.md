# The visual system

Jessica Hsiao · Procedural World Building

One place for colour and type, what each token means, and the two measurements
that decided the parts that were not a matter of taste.

## Contents

- [Chrome is not visualization](#chrome-is-not-visualization)
- [The tokens](#the-tokens)
- [Contrast](#contrast)
- [Typography](#typography)
- [The default palette, and what restraint cost](#the-default-palette-and-what-restraint-cost)
- [Notes](#notes)

## Chrome is not visualization

The one distinction the whole system rests on.

**Chrome** is the application: navigation, panels, controls, readouts, prose. It
is deliberately neutral, so that a generated world is the only thing on screen
carrying colour. Its tokens live in `src/index.css` on `:root`, and nothing else
in the app writes a raw colour.

**Visualization** is what a topic produces: a lit surface, a meshed solid, a
colour ramp, a shader's output. It is allowed to be as saturated as the subject
needs. It is owned by `src/theme.ts` (what Three.js reads), `src/palette.ts`
(the ramps) and `src/gpu/style.ts` (Topic 4's two registers).

Before this, the two shared constants. `ACCENT_BLUE` was simultaneously the UI's
accent, Topic 1's default material colour, Topic 2's default tint and the top of
the single-hue ramp — so restraining the interface would have washed out a lit
3D surface, and the ramp's measured 86 distinguishable steps would have moved as
a side effect of a button's hover state. It is now `VIZ_ACCENT`, and the
interface has its own.

One value genuinely has to exist in both places: the viewport ground. The page
paints it before any canvas has drawn, so `--viewport-bg` in `index.css` and
`VIEWPORT_BACKGROUND` in `theme.ts` must agree or there is a visible seam. They
are checked against each other rather than trusted.

## The tokens

### Surfaces

Four levels, so hierarchy comes from the surface a thing sits on rather than
from a border drawn round it.

| Token | Value | Used for |
| --- | --- | --- |
| `--bg` | `#151617` | The ground the app sits on |
| `--surface-1` | `#1b1c1e` | Navigation rows, side panels |
| `--surface-2` | `#212325` | Inputs, dropdowns, cards |
| `--surface-3` | `#292b2e` | Raised, hovered, selected |
| `--surface-float` | `#232629` | Popovers and menus, opaque on purpose |
| `--border` / `--border-strong` | `#2c2f33` / `#3a3e44` | Two weights, not eight alphas |

The surfaces are genuinely neutral — red, green and blue within three points of
each other.

### Text

Three greys and a disabled one. See [Contrast](#contrast) for why not four.

| Token | Value |
| --- | --- |
| `--text-primary` | `#e6e8ea` |
| `--text-secondary` | `#b4bac1` |
| `--text-muted` | `#949aa3` |
| `--text-disabled` | `#5c626a` |

### Accent and semantics

| Token | Value | Used for |
| --- | --- | --- |
| `--accent` | `#7d9cc9` | Selected state, filled slider track, links |
| `--accent-strong` | `#9ab4d9` | The same, where it carries small type |
| `--accent-line` | `#5f7899` | Hairlines on selected and primary |
| `--accent-subtle` | 13% accent | Selected row and primary button fill |
| `--focus` + `--focus-ring` | `#8fb0dd` | Keyboard focus, on every surface |
| `--danger` | `#d98b7d` | Delete, and errors |
| `--warning` | `#cbab74` | Repairs, stale state |
| `--success` | `#8fae92` | "In the demo" |

The accent is never a large fill. A dark interface tinted blue across most of
its area stops reading as neutral, and the blue stops meaning *this one*.

Danger keeps its own hue rather than becoming another shade of accent — a
destructive action that looks like a primary one is the failure worth designing
against.

### Buttons

Three roles, defined once on `.reset-button` and `.project-button`, so every
topic gets the same three: **secondary** is the bare neutral, **primary** adds
the accent hairline and a 13% fill, **destructive** swaps in the danger hue.
Primary is a lifted neutral rather than a saturated fill, because on a dark
neutral a filled accent button is the loudest thing on the page, and "Save" is
not.

### Native controls

`accent-color: var(--accent)` on `:root` re-tints range inputs and checkboxes in
one declaration. Without it they paint in the browser's own blue, which is
brighter and more saturated than anything else here.

## Contrast

Every text style on all seven pages is measured against WCAG AA by compositing
each translucent layer down to the page and comparing the result with the
rendered text colour — the way the eye sees it, not the way the stylesheet
declares it. The lowest passing ratio is **5.12:1** against a requirement of
4.5:1.

**The scale is three greys because four will not fit.** Holding every size to
4.5:1 puts the floor at about `#949aa3` on the lightest surface small text ever
lands on — a selected row, where the accent tint lifts the background under
11px uppercase labels. Four distinct greys do not fit between that floor and
near-white without two of them being indistinguishable, so the level that was
lost is carried by size, weight and letter spacing instead. That is where the
distinction belonged.

The first attempt had four greys at 13.9, 7.0, 4.3 and 3.0 to 1, and the note
beside them claimed everything down to the third cleared AA. It did not: 4.34 is
below 4.5, and the fourth was failing at every size it was used at. The error
was in a design-time calculation against one surface; running the check against
what the browser actually rendered found twelve failing styles.

## Typography

One family for the whole product: `--font-sans`, a system stack, declared on
`body` so that every `font: inherit` in the two stylesheets resolves to it.

One exception, and it is content rather than chrome: Topic 2's Lab prints its
pipeline as pseudocode, and pseudocode's indentation is meaning — a loop body
only reads as one if it lines up. That block alone uses `--font-code`, a system
monospace stack. Metrics, labels and controls never do.

The Project pages are more spacious than the Playground, and that difference is
carried entirely by size, weight, line height and whitespace — never by a second
family. The same uppercase label is 11px in a dense sidebar and 13px on a page
you present from; body text is 14px at 1.45 against 15px at 1.65.

| Role | Treatment |
| --- | --- |
| App brand | 13px, `--weight-strong` |
| Section nav, topic tabs | 13px, `--weight-ui` |
| Page title | 32px, `--weight-strong`, tightened tracking |
| Card heading | 17px, `--weight-strong` |
| Small uppercase label | 10–13px, `--label-weight`, `--label-tracking`, muted |
| Body | 14px (Playground) / 15px (Project) |
| Metrics | body size, `font-variant-numeric: tabular-nums` |

Metrics get tabular figures rather than a monospace family. Frame rates and
millisecond costs update in place, and proportional digits make the number jump
sideways as it changes; tabular figures hold the column still without bringing
in a second typeface.

## The default palette, and what restraint cost

The default ramp is now **Land** — blue-grey water, cool greens, stone rather
than sand, and an off-white rather than a white peak. `terrain`, the full-strength
hypsometric ramp, is still in the list.

Adding one rather than retuning the other was a measured decision. Ramps are
compared by path length through OKLab, where Euclidean distance is built to be
perceptually uniform, and the method here reproduces the chapter's published
figures exactly before being used on anything new.

| Stops | Distinguishable steps |
| --- | --- |
| `terrain`, full strength | 165 |
| **`land`, as shipped** | **127** |
| `magma` | 114 |
| greyscale baseline | 100 |
| single hue | 86 |
| viridis | 83 |

Desaturating is not free: it costs this ramp 23% of its resolving power. The
first draft — the most literal reading of "lower saturation, smoother
transitions" — scored **94**, *below greyscale*, which would have quietly
inverted the claim Topic 2's colour section exists to make. Getting back above
the baseline meant widening the lightness range and keeping some hue rotation at
low chroma, rather than keeping the saturation.

Calming the peak from `#f2f0ea` to `#e8e5dd` cost a further 3 steps and was
taken: near-white peaks were the brightest thing on screen, brighter than any
text.

So both ramps stay. `land` is the default because it sits beside a neutral
interface; `terrain` remains because it is the cartographic convention and the
widest range measured here, and deleting it to make the UI calmer would have
been trading a teaching artefact for a colour preference.

## Notes

**Topic 4's surfaces were not touched.** Its clay, peach, sand and sage palettes
are the subject of a shading study, not chrome, so changing them to match the
interface would have broken the comparison the page exists to make. Only the
ground moved, because it comes from `VIEWPORT_BACKGROUND`. Checked on screen
afterwards: the warm surfaces still read as warm against a neutral ground.

**The ground is neutral because both hues were wrong.** `theme.ts` recorded that
a violet ground (`0x1c1a24`) fought the warm surfaces standing on it, and the
fix at the time was to invert the hue to warm (`0x201d1a`). That stopped the
fight but put a brown cast across every page, which was most of what read as
muddy once the chrome around it went neutral. Neutral is the option neither
attempt tried: a ground with no hue cannot be in opposition to a surface of any
hue, so the warm palettes keep their warmth and nothing is traded for it.

**Four greys existed because nothing had named a role.** `#8b93a3`, `#6f7789`,
`#7f8798` and `#7d8494` were all doing the same job in different files. They
differed because each was chosen in isolation, not because anyone decided there
should be four.

**The second navigation row was rendering in Times.** Moving the topic tabs out
of `.app-nav` into their own row left their `font: inherit` with nothing to
inherit from — `body` had never set a family, so it resolved to the user agent's
serif, at 16px instead of 13px, across the whole app. Declaring the stack on
`body` fixes the cause rather than the symptom: every `font: inherit` in both
stylesheets now resolves correctly by construction instead of by whichever
ancestor happened to carry a shorthand.
