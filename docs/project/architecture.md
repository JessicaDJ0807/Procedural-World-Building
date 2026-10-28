# Living Architecture

Jessica Hsiao · Procedural World Building

*The Architecture page: an atlas of the structures Build's plants grow —
watched as they form, taken apart into their structure, traced back to the
plants that made them, and compared across contexts.*

**Project → Architecture.** Eight structures — Bridge, Balcony, Scaffold,
Terrace, Canopy, Suspended Walkway, Hanging Pod, Root Column — side by side,
with two or three variations each, every one a 3D specimen in a pale studio.
Under each: Origin, Conditions, Construction, Variation, Impact — and for the
three the Draper takes part in, a note setting each against the form nearest
to it.

**One row, not two families.** The index first grouped the plates under "on
the wall" and "with the Draper", which read as Climber and Spreader on one
side and the Draper on the other. The three plants are peers, and each form
is a combination of them, so the eight plates sit in one row, each labelled
with its recipe.

## Contents

- [Every specimen is a real Build game](#every-specimen-is-a-real-build-game)
- [The variations](#the-variations)
- [The Draper's forms](#the-drapers-forms)
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

| Suspended Walkway | Level, roof to roof · Down two storeys to a low roof · Up to a taller neighbour | the neighbour's roof: level, two storeys down, two up |
| Hanging Pod | Under a two-storey eave · High, four storeys up · Under a wing, beside a tower | where the curtain met the spread edge |
| Root Column | Holding up a walkway · Down a layered wall · Onto a lower wing's roof | what it hangs from, and where it lands |

**Terraces have two.** In every layout searched, a terrace either stands free
on columns or spans to a neighbour in reach. Every free one formed at the
roof line of a two-storey block, because a node has to be within a storey of
the roof and at least two-thirds of a storey up. Two candidates for a third
had the same deck, at the same height, on the same columns, so they were
dropped.

## The Draper's forms

![A suspended walkway, a hanging pod and a root column, from the Architecture page](../images/architecture-draper-forms.jpg)

*From the page: a walkway sloping down two storeys to a low roof; a pod under
a two-storey eave; a root column holding up a walkway, drawn pale as site.*

The Draper's forms are read from its curtain, not a wall cell's stack — what
grows behind its strands, what has spread along its edge, what its strands
reached below (the rules are in [build.md](build.md#the-drapers-forms)). What
they add is a direction: **down**. They hang, descend and are held in tension
where the wall's forms bear, spread and arch.

**Specimens with a Draper.** A recipe can plant a Draper on a block's edge —
as a player clicks it — or on the first structure to mature. A Draper form
often follows another structure (a column needs something to hang from), so
the specimen is the first structure of the recipe's kind. If it hangs from
one, that host is drawn in the supporting buildings' pale material, without
leaves, in every view: part of the site, not a second subject. (At first it
was drawn in full colour, and a column holding up a walkway read as a page
about the walkway.) Other structures standing nearby aren't drawn, as they
aren't for the wall's forms, and only the specimen's own curtain is. The recipes came from 357
runs over two searches — layouts, seeds, where the Draper was planted — and
every Draper kind had many: walkways formed in every layout with Climber
under the curtain and a building in reach (from step 200, as soon as the
Draper was established), pods under every eave with Spreader at its top,
columns most often from a Draper that had spread onto a balcony or walkway.

**The distinctions, as the page draws them:**

| | The wall's form | The Draper's |
| --- | --- | --- |
| Bridge / Suspended Walkway | arches up at its own level; a deck 0.3–0.4 units thick holds itself up | sags below its ends; a deck 0.14 thick hung from cables between masts; lands roof to roof, up or down two storeys |
| Canopy / Hanging Pod | one broad deck held out over open ground, often on columns | hoops round a space, a floor inside, hung from above under a small lip; never touches the ground |
| Scaffold / Root Column | three light rails spiral up past the roof: a frame to climb | one twisted trunk let down from above and flared into roots: a support |

**The Structure view** colours the cables in the Draper's teal, and labels
each form's own members — mast, suspension cable, hanger, slung deck; cap,
woven hoops, floor, trailing strands; trunk, capital, bracket shelf, buttress
roots. **The Growth view** draws the curtain's strands and anchor in teal, and
rings the cells under the curtain the game counted. Pods and columns are
framed from lower down, so their volume reads rather than their top.

Getting the pod to read took one correction: its cap was first as long as a
canopy's deck, and from the studio's camera it hid the basket — a canopy over
some rings. It is now a lip as far as the pod's middle, with the hangers
gathered to its end.

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
| `specimens.ts` | The recipes, with Drapers where a form needs one; `grow()` runs a real Build game on one and captures the structure, what stood before it, the curtains, and the plants at its node; `measure()` |
| `SpecimenViewport.tsx` | The studio: one scene, specimen swapping, views, timeline, labels, camera easing |
| `views.ts` | View modes and their colours |
| `ArchitecturePage.tsx`, `architecture.css` | The page: plates, stage, timeline, variations, texts |

## Measured

- Growing a specimen takes 35–120 ms in Node. Each is grown the first time it
  is opened, then kept.
- **No leaks.** Back on the first bridge after cycling every structure and
  view, GPU geometries read 19, and 19 again after a second cycle (17 on
  first load; the count is taken lazily). A root column with its walkway and
  curtains holds 50 while shown. Only the current specimen's 7 labels stay in
  the page.
- In the browser, at 1440 and 390 wide: all 23 specimens render with no
  errors, and every view works. The page doesn't scroll sideways at phone
  width; the eight plates scroll within their row.
- All 23 recipes grow their kind in Node (24–100 ms each), the wall's 14 as
  before the Draper's forms were added.

## Limitations

- **The Growth view is a moment**, the step the node formed. The plants don't
  grow on as the timeline plays; the timeline is the structure's.
- **No plants are drawn on the grown structure** beyond its own leaves. In a
  game, Spreader would spread over the deck and Drapers hang from the rim.
- **Terraces: two variations**, for the reason above.
- **The specimens are first structures** in small towns. In a full game a
  structure can grow beside or on others, and look less isolated.
- **A host is drawn complete, not as it grows.** The timeline grows the
  specimen; what it hangs from is already there.
- **A column on a wall can be crowded out.** It keeps the wall's five-unit
  spacing from anything but what it hangs from, so on a busy wall the
  balconies that formed first often take its place. The "Down a layered wall"
  specimen formed after three; they aren't drawn.

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
