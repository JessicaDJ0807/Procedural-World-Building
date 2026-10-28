# Living Architecture

Jessica Hsiao · Procedural World Building

*The Architecture page: an atlas of the structures Build's plants grow —
watched as they form, taken apart into their structure, traced back to the
plants that made them, and compared across contexts.*

**Project → Architecture.** Five structures — Bridge, Balcony, Scaffold,
Terrace, Canopy — with two or three variations each, every one a 3D specimen in
a pale studio. Under it: Origin, Conditions, Construction, Variation, Impact.

## Contents

- [Every specimen is a real Build game](#every-specimen-is-a-real-build-game)
- [The variations](#the-variations)
- [The formation timeline](#the-formation-timeline)
- [Three views](#three-views)
- [The studio](#the-studio)
- [Code](#code)
- [Measured](#measured)
- [Limitations](#limitations)
- [Notes](#notes)

## Every specimen is a real Build game

A specimen is a **recipe** — a few blocks, a Climber and a Spreader planted
twice at the foot of chosen walls, a world seed and the rain — and a
`BuildGame` run on it, ten steps at a time as Build plays, until Build forms
its first living structure. That structure is the specimen:
- planned by Build's planner from the real growth around its node, so it bows,
  leans and reaches as the plants made it;
- drawn by Build's own renderer.

Nothing is modelled and nothing is forced. If a recipe ever grows a different
structure first — because Build changed — the page throws instead of showing
the wrong thing.

The recipes were found by search: 432 runs over 26 layouts, 6 seeds and two
rain levels, keeping runs where the wanted kind formed **first**. Every kind
has such runs; nodes formed between steps 50 and 180.

Build itself is unchanged in behaviour. Two additions, used only by this page:
`growthDirections` is exported (the planner's own averaging, for the Growth
view's arrows), and `livingObject` also returns its meshes by part (for the
Structural view). Three test games of the stepping-stone run grew the same
structures at the same steps before and after.

## The variations

Labels describe what Build actually grew, checked in Node, not what a recipe
hoped for.

| Kind | Variation | What differs |
| --- | --- | --- |
| Bridge | Two-column gap · Three columns, to a taller tower · Four-column gap | span 2.0 / 3.0 / 4.0 blocks; the arch rises an eighth of its span |
| Balcony | Swung west · Swung east · Straight out, higher | the Spreader's heading: west, east, or out from the wall |
| Scaffold | Arm to a taller neighbour · Arm down to a lower roof · Nothing in reach | what its crown finds within four columns |
| Terrace | Free, on columns · Spanning to the neighbour | a neighbour in reach or not |
| Canopy | Low, on columns · Spanning a short gap · High, neighbour out of reach | height (the node's) and reach |

**Terraces have two.** In every layout searched, a terrace either stands free
on columns or spans to a neighbour in reach. Every free one formed at the
roof line of a two-storey block, because a node has to be within a storey of
the roof and at least two-thirds of a storey up. Two candidates for a third
had the same deck, at the same height, on the same columns, so they were
dropped.

## The formation timeline

The slider is the steps since the node formed, 0 to 560. Moving it calls the
structure's own `grow(age)`, the function Build animates it with. The stages
are Build's (`STAGES` in `living.ts`):

| Steps | Stage |
| --- | --- |
| 0–30 | node: the knot swells |
| 20–150 | frame: rails, keels, helices and roots draw out |
| 140–300 | surface: the decks fill in from their roots |
| 280–380 | mature: raw fibre turns to stone |
| 360–520 | vegetation: leaves open from the node out |

A tick at step 300 marks maturity, when the structure starts to shade and
support. Play runs at 70 steps a second, about 8 seconds start to finish. Start
and Complete jump to either end. Orbit and zoom work throughout.

## Three views

- **Material** (default): Build's colours and leaves.
- **Structure**: the leaves hidden, the decks pale and translucent, the frame
  rust, roots and columns brown, the supporting buildings grey. Labels mark
  the node, the deck, a frame member, the lowest root (a "column, rooted"
  where it reaches the ground), and where it reaches a neighbour.
- **Growth**: the structure ghosted. Shown at the step the node formed, from
  the game's own state:
  - every plant layer as a small square on its cell, Climber green and
    Spreader yellow, each layer stepped further off the wall as in Build;
  - every stem from parent cell to child;
  - the seeds;
  - amber rings on the cells whose combination made the node;
  - arrows for the Climber's and Spreader's average headings near the node:
    the directions the planner read to bow, lean and aim the structure.

## The studio

One renderer and scene for the page's lifetime. Choosing a specimen swaps in
only its objects:
- the supporting buildings, Build's `buildTown` in one pale material;
- the structure, Build's `livingObject`;
- the Growth view's picture.

It then eases the camera to the new framing. The view looks across the
structure's longest extent, shifted toward the wall it grows from: a bridge
side-on, a deck in profile, never from behind the building it reaches toward.
Switching views swaps materials and visibility. Labels are HTML, nudged apart
where points crowd.

## Code

`src/architecture/`:

| File | What it holds |
| --- | --- |
| `specimens.ts` | The recipes; `grow()` runs a real Build game on one and captures the structure and the plants at its node; `measure()` |
| `SpecimenViewport.tsx` | The studio: one scene, specimen swapping, views, timeline, labels, camera easing |
| `views.ts` | View modes and their colours |
| `ArchitecturePage.tsx`, `architecture.css` | The page: plates, stage, timeline, variations, texts |

## Measured

- Growing a specimen takes 35–120 ms in Node. Each is grown the first time it
  is opened, then kept.
- **No leaks.** Cycling every structure and every view twice left GPU
  geometries at 17 (20 before; the count is taken lazily), and only the
  current specimen's 7 labels in the page.
- In the browser, at 1440 and 390 wide: all 14 specimens render with no
  errors, and every view and timeline position works. The page doesn't scroll
  sideways at phone width.

## Limitations

- **The Growth view is a moment**, the step the node formed. The plants don't
  grow on as the timeline plays; the timeline is the structure's.
- **No plants are drawn on the grown structure** beyond its own leaves. In a
  game, Spreader would spread over the deck and Drapers hang from the rim.
- **Terraces: two variations**, for the reason above.
- **The specimens are first structures** in small towns. In a full game a
  structure can grow beside or on others, and look less isolated.
- **Draper makes no architecture**, so it has no plate.

## Notes

- **Framing measured three times too big.** The structure sits in a group
  scaled to the town, and its bounds were taken before the scale applied:
  every model filled a third of the frame.
- **A guessed label was wrong.** "Down to a lower roof" was a bridge that grew
  level to the ground floor of a taller tower. Labels are now written from
  what each run grew.
- **The camera stood behind the far building.** Looking across a free
  terrace from the wrong side put its four-storey neighbour in the way; the
  view now shifts toward the wall the structure grows from.
- **The data line said "0.2 storeys of rise" for the bridge.** Rise is shown
  only from 1.5 units, where it means something (the scaffold).
