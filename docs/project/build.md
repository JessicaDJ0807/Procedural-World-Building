# Build

Jessica Hsiao · Procedural World Building

*Wildform's main playable prototype: the player builds part of the
architecture, and plants grow the rest.*

    build → plant → grow → plants meet → living architecture → build again

The design idea: **the player controls the starting conditions, but not the
exact final form.** Where rigid blocks go, from a budget, and where seeds go,
are the player's; what the plants make of them is the simulation's.

![The lawn scenario played out under a clear sky: the three-storey west building and two-storey east building, a one-column stepping-stone tower between them, and a living bridge arching from each building to the tower, with a balcony-pod on the tower. Teal Draper curtains hang from the roof edges and a ledge of the west and east buildings and from the tower's roof, and under the west bridge where a curtain spread onto it; patchy beds of ground cover spread from the foot of the tower and the east building](../images/build-living.jpg)

## Contents

- [The scenario](#the-scenario)
- [Two kinds of architecture](#two-kinds-of-architecture)
- [Rigid architecture: building](#rigid-architecture-building)
- [The plants](#the-plants)
- [The Draper: a plant that hangs](#the-draper-a-plant-that-hangs)
- [Living architecture: mutation nodes](#living-architecture-mutation-nodes)
- [What grows from what](#what-grows-from-what)
- [Growing in stages](#growing-in-stages)
- [Build and grow are one loop](#build-and-grow-are-one-loop)
- [Surfaces: roofs and living architecture](#surfaces-roofs-and-living-architecture)
- [Ground spread](#ground-spread)
- [Sky and light](#sky-and-light)
- [The page](#the-page)
- [Saving worlds](#saving-worlds)
- [Inhabitants](#inhabitants)
- [Seeds planted](#seeds-planted)
- [Code](#code)
- [Measured](#measured)
- [Limitations](#limitations)
- [Notes](#notes)

## The scenario

A lawn, and two existing buildings on it: a three-storey block to the west
and a two-storey block to the east, **eight columns apart**. They are free,
and can't be removed.

**Goal: join the two buildings with living architecture, using no more than
30 blocks — and keep them two buildings.**

A living bridge reaches about five columns, so the plants can't do it alone.
The player has to bring the buildings within reach, and that is the decision:

- push a wing out from one building, then let one bridge grow across;
- or put up a cheaper stepping-stone tower between them, and get two living
  links, west to tower and tower to east;
- or bridge the gap with blocks directly — which joins the two masses into
  one building, and the goal asks that they stay separate. Spending blocks on
  the connection itself undoes the point of it.

The first version stood the buildings four columns apart: both bridges grew
without a block spent, and there was no decision to make.

## Two kinds of architecture

| | Rigid | Living |
| --- | --- | --- |
| Made by | the player, block by block | the plants, where they meet |
| Comes | at once | over hundreds of steps, in stages |
| Costs | one block from the budget each | time, and the right conditions |
| Form | modular, predictable | decided by the plants and the context |
| Looks | clean boxes, warm stone, muted terracotta roofs | irregular decks, fibrous below and stone with moss above, on roots |

## Rigid architecture: building

Townscaper's interaction: the player only places and removes blocks on a
14 × 14 × 8 grid, and the rules (`townMesh.ts`) decide what each becomes:

- **walls** only where a side faces the open, each with a window; a **door**
  on one open side of each ground-floor house;
- a **roof** by the neighbours at the same height — a hip roof on a house
  alone, one gable ridge along a row, a roof terrace with parapets where
  there are neighbours both ways;
- an **arch** under a block that spans between two others at its height, with
  nothing beneath — a gateway, or a bridge's arcade — and **stilts** under any
  other floating block;
- a **string course** where a storey meets the one above: a ledge, drawn
  where the growth model has one;
- a stone **footing** into the lawn.

Each block the player places costs one of 30. A new block takes the colour of
the block it was placed against, so a house stays one colour; on open ground
a stone from the Site's palette. The sky and light are a clear day of the
page's own (see *Sky and light*).

## The plants

Wildform's two species and their simulation, unchanged: the **Climber** (goes
up, follows edges, tolerates shade) and the **Spreader** (goes sideways, seeks
light), growing in **stacks of layers** — each onto what is already there,
the top layer shading the ones beneath. Sun and rain are the growth model's.

**Layered** is not a third species to plant: it is what a cell becomes when
one plant has grown over the other. It is shown beside the species, and it is
what the mutation rules read.

The fourth is the **Draper**, which hangs — next.

## The Draper: a plant that hangs

Climber grows up, Spreader sideways. The **Draper** grows **down**: it hangs
from an elevated edge and lets strands fall under gravity until they gather
into a curtain (`draper.ts`, drawn by `draperMesh.ts`).

It is its own model, not a third Wildform species. Wildform's plants live on
wall cells, each growing into a neighbouring cell. A hanging strand spends
most of its length in open air below an edge, where there are no cells, and
adding a species to Wildform would have changed Explore's simulation and
every species array the Build loop reads. The Draper still reads the same
world:
- the light and moisture where it hangs;
- the Climber growth beneath it;
- the town it hangs past or lands on;
- the living architecture it hangs from.

**The rules:**

1. **Anchoring.** A Draper needs an edge at the top. Valid edges:
   - the top edge of an open wall face: a **roof** eave, or a **ledge** (a
     string course where the storey continues above);
   - the bottom edge of a block with nothing under it, an **overhang**;
   - the edge of a **mature living structure's deck**.

   An edge runs on along neighbouring blocks with the same edge, up to three
   either side, so a curtain can widen along an eave. Not the lawn.
2. **Direction.** Each strand grows down, about 0.03 units a step at full
   vigour. A slow sway along the edge and a little outward drift keep it from
   hanging like a cable; gravity dominates.
3. **Surface.** Where there is a wall behind, a strand clings lightly: it is
   drawn toward a small, wavering gap off the façade. Where there is none,
   under an overhang or a bridge, it hangs free.
4. **Contact.** A strand that reaches the lawn **roots**, and a small patch of
   Draper grows round the root (in the ground cover), tying hanging growth
   back to the ground. A strand that meets a block — a lower roof, a wing —
   rests on it and stops.
5. **Density.** A Draper sprouts a strand every 24 steps (slower when it
   grows poorly), up to 9. They come in clusters of two or three, spreading
   out along the edge from where it was planted. Strands near the middle are
   longest (up to 10 units, about three storeys), so the curtain's hem curves.

**Ecology.** It likes moderate moisture and part sun: the lee of a building,
or the filtered light under a deck. It slows in full sun, in deep shade and
on a dry wall. Its vigour is the product of a light match (best at 0.45) and
a moisture match (best at 0.5). Both are read over the band of wall it hangs
across — about 4 units down and 1.5 either side — not at the anchor (see
*Notes*).

**Interactions.**
- **Veil.** Over a wall where Climber has grown (3 or more Climber cells
  under the anchor), a Draper grows half as many strands again, and faster:
  a denser curtain where the two meet.
- **Spreading onto living architecture.** An established Draper (160 steps,
  4 strands) can attach to a mature living deck. It does so when its edge
  comes within 2.6 units of the deck's edge, or a grown strand within 1.2,
  and a new curtain starts there. Only a planted Draper spreads, at most
  twice.

An established Draper takes part in the mutation rules through its curtain
(see [The Draper's forms](#the-drapers-forms)).

**Drawn as hanging vegetation, not lines:**
- the stems are thin three-sided tubes, tapering, green-brown to fresher green;
- slim pointed leaves hang off them, dense near the top and sparser below,
  with pale young leaves opening at the tip;
- clusters of larger leaves bunch round a stem every so often;
- a lip of foliage runs along the edge between the outermost strands;
- a few leaves sit round each rooted base.

The leaves are teal-green, to read apart from Climber's dark green and
Spreader's olive. They sit at fixed distances along each strand, so a growing
strand adds leaves at its tip and none move.

**Planting.** With Draper chosen, the player clicks a wall, a roof or a
mature living structure, and the Draper anchors on the nearest valid edge:
- on a wall, the edge at the top of that block;
- on a block with nothing below, its soffit edge if that is nearer;
- on a roof, the nearest open edge;
- on a living structure, the nearest deck edge.

On hover, a mint bar along the edge, with short strands hanging from it,
shows where it would hang. The lawn, and a living structure that has not
matured, show nothing and refuse the click.

## Living architecture: mutation nodes

The old rule spawned a rectangular prefab platform where the plants met.
Here a meeting forms a **mutation node**, and architecture grows from it.

Every 10 steps, `findNode` looks for a wall cell where enough of one
combination has gathered (`living.ts`):

- at least **6** cells of Climber + Spreader, or **2** of a layered
  combination, within 1.2 units;
- their growth at least **25 steps** old on average — established, not a
  passing tip;
- at least **1.8 units** up the wall (at the foot, the "bridge" was a ramp
  from the lawn);
- **5 units** from any other node, and **8** structures at most, of which at
  most **3** balconies (see *Measured*).

The rarer layered combinations are looked for first.

## What grows from what

The combination is read from the cell's stack; it sets the architectural
identity. The context — the wall's facing, the plants' growth directions
nearby, other buildings in reach, the free space in front, the roof above —
sets the form.

| Stack | Combination | Grows |
| --- | --- | --- |
| two layers, both species | **Climber + Spreader** | a **bridge** to another building in reach, or a **balcony** if none |
| a Climber on two layers | **Climber + Layered** | a **scaffold**, up past the roof |
| a Spreader on two layers | **Spreader + Layered** | a **terrace** at a roof, or a **canopy** below one |

The Climber gives a vertical path, the Spreader horizontal reach, layered
growth mass:

- **Bridge.** From the node, a cast along the wall's facing, turned toward the
  Spreader's growth and fanned ±20° and ±40°, at the node's height and a
  storey up or down, finds the nearest face of *another* building within five
  columns. The deck arches between them, rising an eighth of its span and
  bowed sideways the way the Spreader was growing. It grows as two halves
  from either end that meet in the middle, each flaring into a root plate on
  its wall. Under it, two edge rails and a sagging keel.
- **Balcony.** No building in reach: a pod out along the wall's facing and the
  Spreader's direction, as far as the free space allows (2–4.2 units),
  widening then narrowing, curling up at its lip, on two root braces from the
  wall below, tendrils hanging from the rim.
- **Scaffold.** Three helical rails twisting round an axis 1.25 units off the
  wall, leaning with the Climber's growth, from below the node to a storey
  above the roof, with small stair pads stepping round them and a crown on
  top; tie-backs into the wall each storey. If another building is within
  four columns of the crown, an arm grows across to it.
- **Terrace / canopy.** A thick fan-shaped deck from the wall, at the roof if
  it is within a storey (terrace), else just above the node (canopy), domed,
  widening outward along the wall's facing and the Spreader's direction. If
  another building is within reach it spans to it; if not, and it is high, two
  trunk-like root columns carry its far edge to the ground.

Each structure is a set of curves and swept surfaces, so no two come out
alike.

## The Draper's forms

A Draper never enters a wall cell's stack — its strands hang in open air off
the face — so its meetings can't be read from `comboOf`. They are read from
the curtain instead (`draperLiving.ts`): what grows on the wall behind its
grown strands (within 0.7 units of one), what has spread along the edge it
hangs from, and what its strands have reached below. A Draper must be
established first: hung 200 steps, with five strands.

| The curtain | Combination | Grows |
| --- | --- | --- |
| hangs from living architecture, or over three cells of layered growth, with three strands down to the lawn or a roof at least 2.5 units below | **Draper + Layered** | a **root column** |
| hangs over four Climber cells, from an edge at least 5.5 units up, with another building within five columns (level or up to two storeys up or down) | **Climber + Draper** | a **suspended walkway** |
| hangs from an edge at least 4.5 units up where three Spreader cells have spread (on the edge, the roof beside it or just under it), with room below for the pod | **Spreader + Draper** | a **hanging pod** |

Checked in that order, before the wall's nodes, and each Draper makes one
structure at most. Where the conditions aren't met, nothing forms: a curtain
over Climber with no building in reach stays a veil; a pod that would hit a
block or come within half a unit of the lawn isn't grown.

What the Draper brings is a direction the others don't have — down — so its
forms hang, descend and are held in tension:

- **Root column.** The landed strands nearest the curtain's middle twist into
  a trunk: six strands spiralling round an axis from the edge to where they
  landed, narrow in the middle, flaring at the foot into six buttress roots,
  gripping the edge with a capital of five strands. Bracket shelves, one a
  storey, grow out on alternating sides. Under a living deck it stands free;
  on a wall, half a unit off the face. A foot on another building's roof makes
  it a connection.
- **Suspended walkway.** A thin deck (0.14 units, against a bridge's 0.3–0.4)
  sagging below the line between its ends, hung by hangers from two cables
  strung between masts at either end; strands trail from its edges. It lands
  on the neighbour's roof when that is within two storeys up or down, so it
  can slope where a bridge stays level.
- **Hanging pod.** Under a lip grown from the Spreader's spread, seven open
  hoops, widest a third of the way down and gathered to a point 3.1–3.5 units
  below, ribs between, a floor across the belly, a mouth facing out; hangers
  gather to the lip's end; strands trail below.

Two new kinds of member carry this: **trunks** (drawn thick, and climbable
surfaces like any frame member) and **cables** (thin, in the Draper's teal,
not surfaces). Both are optional fields on a structure, so worlds saved before
them load unchanged; a saved world round-trips both, and the Draper's record
of what it formed, and carries on identically (checked for 400 steps after a
reload).

**Spacing.** Draper forms keep the wall's five-unit spacing, with two
exceptions: a column may stand under the structure it hangs from, and two
forms facing opposite ways may be two units apart. Without the second, a
tower slinging walkways from both eaves — 3.6 units apart — only ever got
one.

## Growing in stages

A structure grows over simulation steps, so pausing pauses it:

| Steps after the node | Stage |
| --- | --- |
| 0–30 | **node** — a knot swells where the plants met |
| 20–150 | **frame** — rails, keels, helices and roots draw out along their length |
| 140–300 | **surface** — the decks fill in from their roots outward |
| 280–380 | **mature** — the raw, fibrous tint gives way to stone |
| 360–520 | **vegetation** — leaves open over it, from the node out |

At step **300** it becomes architecture: its decks are added to the world as
solids, so they cast shade on the plants (and the plants under a new bridge
respond, as under Wildform's platform), and the walls its frame and roots
touch become support, so Climbers climb it. A connection counts from then.
And its surfaces join the building, so plants grow on it (next section).

## Build and grow are one loop

There are no separate modes. Tools — **Build**, **Remove**, **Plant** — work
whether growth is running or paused, and editing the town never resets it:

- the town becomes a new building, and every plant layer whose cell still
  exists (same position, same facing) is carried onto it in birth order, with
  its age and the conditions it grew in (`WildGrowth.restoreFrom`); a layer
  under a new block is dropped, and what grew from it is left standing;
- mature living structures persist and are laid back into the new world, still
  shading and supporting;
- the new architecture can shade plants that were in the sun — which then
  wither — and new walls are open to growth.

## Surfaces: roofs and living architecture

*Geometry creates different conditions; no surface is arbitrarily plantable
or unplantable.* Pitched roofs used to have no cells at all — plants stopped
at the eave — and a living structure was a shadow and a support with nothing
growing on it, so only the Draper used it. Now both are surfaces
(`surfaces.ts`).

**Patches.** The growth model's cells are vertical walls and flat roofs, and
`assembleBuilding` is shared with Explore and the Site, so it is left alone.
Instead each pitched roof face and each part of a mature structure becomes a
grid of cells laid on the surface as drawn, appended to the town's building
and stitched to the cells beside it (any edge cell within 0.45 units of
another surface's cell). An eave joins the top of the wall under it, a root
joins the wall it grips, and a deck's rim joins its underside. A wall cell
with all eight neighbours gives up a diagonal for the stitch, so growth can
step onto a patch as well as off it. Every roof patch cell in a test town
(862 of 862) is reachable from the walls.

**Every cell carries its surface:** a kind (wall, flat roof, roof slope,
ridge, eave, gable end, deck top, deck rim, underside, support, junction),
its slope, attachment (an edge or rib to hold) and water retention. From
these:

    slope → runoff → moisture
    kind + slope + attachment → affinity per behavior → suitability

**Roofs.** Three pitches, so the roofs a player gets are three surfaces: a
terrace is flat, a gable over a row is 31°, a house's hip roof 49° (they were
41–43° and alike before). Water kept falls with slope — 1.0 flat, 0.80 at
31°, 0.49 at 49° — and what a slope sheds lands on its eave, which comes out
wetter than the slope above it. Ridges shed both ways, and are the driest
line. Ridges and eaves are edges, which the geometry field reads, so the
Climber follows them.

| From three seeds on the sunny side, 800 steps, mean of 6 | Climber | Spreader |
| --- | --- | --- |
| Terrace, 0° | 1.8% | **100%** |
| Gable, 31° | 0.5% | 7.6% |
| Hip, 49° | 1.3% | 1.5% |

| Seeded at the walls' feet and on the roof, 1,500 steps | rain 55% | rain 85% |
| --- | --- | --- |
| Terrace: Spreader | 95% | 98% |
| Gable slope: Spreader | 0.2% | 37% |
| Hip slope: Spreader | 0.7% | 8.6% |
| Hip eaves: Climber · Spreader | 48% · 25% | 86% · 50% |

Flat roofs fill. Steep roofs keep little and grow at their eaves. Moderate
roofs are in between, and patchy in dry weather — see *Notes* for why.

**Living architecture.** Once a structure matures, its surfaces join the
building:
- each deck's **top**, with its **rim** (the outer fifth either side);
- its **underside**;
- every rail, keel, rib and root, as a **support** strip;
- **junctions** where a deck meets its node or the wall it roots in.

| Behavior | Affinity on a structure |
| --- | --- |
| Climber | full on rims, supports and junctions; about half on a deck top; 0.5 underneath |
| Spreader | full on a deck top; fair on a rim; 0.3 on a rib; 0.25 underneath |
| Draper | unchanged: it anchors on deck edges, rims and the eaves under them |

Draper-favored is not Draper-exclusive: an underside is poor for the others,
and possible. A structure's surfaces keep its id. A node can form on them
like on a wall: a deck top plans from its rim's direction, a roof slope from
its eave. Those nodes use the same mutation rules (`living.ts`) — there is no
second system for structures grown on structures.

On the stepping-stone run, at step 3,200:

| Living surface | Climber | Spreader | Layered |
| --- | --- | --- | --- |
| Deck top | 3.8% | 12.3% | 1.7% |
| Deck rim | 18.9% | 4.4% | 2.2% |
| Support | 5.7% | 0.8% | 0.4% |
| Underside | 1.8% | 0.2% | 0.1% |
| Junction | 17.6% | 22.5% | 9.2% |

**Recursion happens.** In that run a balcony grew at step 1,630 from the rim
of bridge #1 — architecture grown on architecture — matured, and its own
surfaces joined the building. A structure born on another doesn't count as
a connection (its start is not a block).

**Planting.** A click on a wall, a roof of any pitch or a mature structure
plants there. Only glass refuses. On anything but a wall, a note names the
surface and how it suits the plant — *Roof slope · poor for a Spreader* —
good (suitability ≥ 0.45), fair (≥ 0.2), poor, or *poor — it may not spread*
(under 0.1, the least a tip needs to move). A structure that hasn't matured
says so.

**Surface view** (sidebar, last): every cell as a dot, coloured red–yellow–
green by one behavior's suitability (Climber, Spreader), or by how good a
hanging anchor it is (Draper). The plants are hidden while it shows.

## Ground spread

The plants on the walls creep out onto the lawn round their feet
(`groundCover.ts`). It is drawn, not simulated — the growth model has no
ground — but it is read from the simulation, so it is where the plants are,
as old as they are, and the kind they are:

- **Sources.** Every plant layer in a wall cell within 1 unit of the ground,
  its reach growing with its age. A cell two or three layers deep is also a
  source of layered growth. A living structure adds its roots and supports
  that come within 1.2 units of the ground, and the wall foot under its
  node — the denser patches by mutation zones.
- **Stronger where it is moist and shaded**, so beds are thicker in a
  building's lee and at corners, where two walls' sources overlap.
- **Each kind spreads its own way:**

| | Reach | Patches | Drawn as |
| --- | --- | --- | --- |
| Climber | up to 1.4 units — it goes up, not out | a fine fringe at the wall foot | small dark leaves |
| Spreader | up to 5 units — the ground coverer | broad, irregular mats | ivy-like leaves |
| Layered | up to 2.6 units | dense clumps | upright tufts |

Coverage is the sum of the sources' falloffs, saturated. Noise then breaks
it into patches, more strictly the thinner it gets: next to a wall nearly
every place is covered, while farther out only the noise's peaks are, so a
bed frays into islands instead of ending in a circle. A leaf appears where a
fixed per-tile random number falls under the local density. As a bed grows,
leaves are added and none move. Under the beds the lawn's colour shifts
toward moss.

The beds are three instanced meshes of 4–9 triangles a leaf, over a
0.5-unit grid. They are redrawn on every edit and every 16 steps while
growing.

## Sky and light

A clear day, for a playable sandbox (`sky.ts`):
- a pale blue horizon deepening to a medium blue overhead;
- soft white clouds from noise on a plane overhead, thinning toward the
  horizon;
- a faint warm glow round the sun.

Sunlight is barely warm, the sky fill cool, and the haze pale blue-grey. The
lawn is a fresh, slightly muted green (`#87a35c`), mown in stripes over the
grid.

The page first borrowed the Site's golden hour. Its orange wash turned the
lawn dusty and the plants olive, and a playable sandbox wants the clear
colours. The Site keeps its golden hour.

## The page

**Project → Lab** (this page; it was the Build tab, and its route is still
`/project/build`) — the game with every control and number showing. The
full-screen game is [Play](play.md). A first visit gets one card, top left of the scene: *Goal: connect the
structures using living architecture. Build what you need, then let plants
complete what you don't.* "Got it" puts it away, remembered per browser, and
it goes once the goal is met.

The sidebar is the game's interface rather than a dashboard, in the order a
player asks:

1. **Goal.** The objective, and a four-step progress strip: plant → node →
   mature → join. Under it, living connections and whether West ↔ East are
   joined, and one hint while the goal is open. On completion it becomes a
   completion block: *✓ Goal complete — West ↔ East connected, with n of
   30 blocks*. There is no target count of connections, because it depends
   on the layout: a wing needs one link, a stepping-stone tower two.
2. **Mode.** Build / Remove / Plant. The active mode gets a tint and a short
   accent bar. Below that, the block budget, then the quieter secondary
   actions Undo / Clear / Restart.
3. **Plant behavior.** Climber ↑ (*climbs, follows edges*), Spreader ↔
   (*spreads, seeks light*), Draper ↓ (*hangs from edges, follows gravity*).
   The selected one has a left accent bar in its own colour, stronger in
   Plant mode, where it is what a click will place. Choosing one switches to
   Plant mode. All three show **coverage**: the share of the building's
   growable surface each holds. For the Draper that is the surface its
   curtains hang over (cells within 0.6 units of a grown strand); a curtain
   in open air, under a deck, counts none.
4. **Interaction.** **Layered**, which is not a plant to place but what forms
   where plants grow over each other, with its coverage, and the most recent
   mutation (*Climber + Spreader → Bridge · step 390*).
5. **Environment.** Rain and Sun direction, each with a reading of what the
   value means for the plants. Rain: dry / light / moderate / wet. In the
   lawn scenario, median wall moisture (low walls / high walls) is 0.16/0.08
   at 10% rain, 0.36/0.22 at 30%, 0.54/0.36 at 55% and 0.69/0.50 at 85%.
   Sun: which walls it lights, from the growth model's sun — east and west
   as the game names its buildings, front and back as seen from where the
   camera starts. Changing either shows, for 2.5 s, how well every surface
   now suits the selected plant — the Lab's weather tint — so the effect is
   visible at once rather than hundreds of steps later. (The game itself has
   no weather controls: its seasons set the weather; see
   [Play](play.md#weather).)
6. **Growth.** Transport controls: ▶ Play / Pause, Step, the step count;
   speed 1× / 4× / 16×.
7. **Living architecture.** The outcome first, the recipe second: *Bridge /
   Balcony 4 — Climber + Spreader · 3 bridges, 1 balcony*. Below it, the
   mutation rules in a fold-out.
8. **Events.** The last three by default, and *Show history* for up to 40.

The camera follows the app's convention: drag rotates, right-drag moves, scroll zooms — a short click is a click, so a left-drag never places a block. Right-click removes a block with any tool; a white ghost shows where a block
will go, red what will be removed. A label appears in the scene beside a new
node, and again when a structure matures.

## Saving worlds

The top of the sidebar is the world: its name, an amber dot when there are
unsaved changes, **Save**, and **Worlds ▾** — New world, Save as…, My worlds….

- **Save** asks for a name (1–120 characters) the first time, then saves over
  that world. **Save as…** makes a new one ("… copy").
- **My worlds** lists each world with its scenario, blocks, step, living
  structures and when it was saved. Each has Open, Rename, Duplicate (a new
  world with the same state, "… copy") and Delete (asks first).
- **New world**: a fresh lawn, default weather, a new seed.
- **Unsaved changes** means your own changes since the last save — a block,
  a planting, a slider — or more than 200 steps of growth. Growth alone counts
  only past that: the world keeps growing while it plays, and when every step
  counted, a world saved mid-growth was unsaved again within a frame (83 steps
  by the time the dialog closed). Opening another world, New world, Restart and
  leaving all ask first, saying which it is, with **Save first** for a world
  already saved.
- A world opens **paused**, at the step it was saved, with its weather on the
  sliders.
- A failed save or open says why and leaves the current world as it was. A
  world this build can't read — saved by a newer version, or damaged — is
  listed with the reason and can't be opened.

What is saved is the world's state, not its scene:
- the town;
- the living architecture as planned;
- every plant layer and growing tip;
- the Drapers;
- the weather, seed and step;
- the seeds the player has planted (see [Seeds planted](#seeds-planted)).

Loading rebuilds the rest through the same path as an edit (`BuildGame.load`).
So a loaded world is not a picture of the saved one but the same simulation:
in Node, its next 400 steps were identical to the original's. Stored in
Firestore under `users/{uid}/worlds`, with the heavy part in chunks so no
document nears 1 MiB — see [Firebase setup](firebase-setup.md#wildform-worlds).

## Inhabitants

The Lab has the game's inhabitants too — creatures that walk only where plants
grow or on mature living architecture — with **Show Inhabitants** under the
Growth controls and a count of how many live there. It is the same
preference as Play's, stored in the browser, never a change to the world.
See [Inhabitants](inhabitants.md).

## Seeds planted

Blocks are the player's direct construction; seeds their indirect influence.
Both are counted, so how a player balances them can be seen: under the block
budget the sidebar reads *Seeds planted 9*, then *Climber 4 · Spreader 4 ·
Draper 1*. Play shows the same count (see [play.md](play.md#seeds-planted)).
Nothing is limited by it — no seed budget, no score.

The count lives on the game (`BuildGame.seeds`), the one state the Lab and
Play share, and rises in exactly two places: `plant` and `plantDraper`,
when they succeed. So it counts what the player did and nothing the
simulation does:
- a refused planting — the same plant twice on one cell, glass, a second
  Draper where one hangs — counts nothing;
- growth, branching, regrowth after winter, a Draper spreading onto living
  architecture, and mutations count nothing (checked: 1,500 steps of a game
  where Drapers spread and structures formed, and a winter and its regrowth,
  left the count where it was).

Plantings can't be undone — Undo takes back blocks — so the count only rises,
until Restart or New world sets it to zero. It is saved with the game's other
counters. A world saved before seeds were counted has no record of them, and
the count isn't rebuilt from what is there: seedlings that withered and
Drapers that fell leave no trace, so a rebuilt count would undercount without
saying so. Such a world opens counting from zero, marked partial — shown as
*3+* — and stays marked through later saves. Counts in a save that aren't
three whole, non-negative numbers are ignored the same way. `npm test` runs
these cases (`tests/seeds.test.ts`).

## Code

`src/build/`:

| File | What it holds |
| --- | --- |
| `town.ts` | The grid, the existing (locked) blocks, the budget, masses, undo, the lawn scenario |
| `townMesh.ts` | The rigid rules: walls, windows, doors, roofs, arches, stilts, string courses, footings |
| `townBuilding.ts` | The town as growth cells for the plants |
| `lawn.ts` | The lawn: gentle relief, mown stripes over the grid |
| `worldState.ts` | A world as data: what is saved, how it is read back and checked, versions and migration |
| `WorldMenu.tsx` | The world bar and its dialogs: Save, Save as, New world, My worlds, unsaved changes |
| `surfaces.ts` | Pitched roofs and living architecture as cell patches stitched to the building; each cell's kind, slope, retention, attachment and per-behavior affinity |
| `draper.ts` | The Draper: edges and anchoring, gravity-led strands, contact and rooting, vigour, the veil, spreading onto living architecture |
| `draperLiving.ts` | The Draper's meetings, read from its curtain, and the three forms they grow: root column, suspended walkway, hanging pod |
| `draperMesh.ts` | Drapers drawn: tapering stems, hanging leaves and clusters, the lip, rooted bases |
| `groundCover.ts` | Ground spread round wall feet and living roots, by species, patchy |
| `sky.ts` | The clear-day sky dome and the scene's light colours |
| `living.ts` | Mutation nodes, what grows from each combination, connections, shade and support |
| `livingMesh.ts` | Living architecture drawn, and grown in stages |
| `game.ts` | One game: building, plants and living architecture carried through every edit; the goal |
| `BuildViewport.tsx`, `BuildPage.tsx`, `build.css` | The scene and the sidebar |

In Wildform: `WildGrowth.restoreFrom`, and `World.addLiving` for living
architecture's solids and support. Wildform's own page and its Midterm Demo
are unchanged (its platform still forms at step 870, with the same counts).

## Measured

In Node, with the lawn scenario:

- **The intended strategy works and is cheap.** A three-block stepping-stone
  tower in the middle, a Climber and a Spreader planted together at the foot
  of each of the four walls that face across the gaps: living bridges grow
  east to tower and tower to west, and the goal is complete at step 700–800,
  with 3 of 30 blocks.
- **Without blocks it can't be done.** Nothing living reaches eight columns.
- **Edits keep the growth.** Placing a block mid-growth carried all 3,930
  plant layers across (it was losing a fifth — see *Notes*); a rebuild takes
  about 80 ms.
- **Which combinations turn up.** Planting both species at every ninth cell
  round the foot of the buildings, over 4,000 steps, in three layouts:
  Climber + Spreader first, from step 100–300; Climber + Layered from step
  500–1,100; Spreader + Layered in one layout of three, at step 2,800. The
  layered combinations need stacks two deep, which take time.
- **Balconies, uncapped, took every slot.** Climber + Spreader with no building
  in reach becomes a balcony, and before the cap of three they filled all
  eight structures before a layered node formed. Capped, a run grows a mix —
  balconies, scaffolds and terraces, or balconies, scaffolds and bridges.

Ground spread, in the browser, for the stepping-stone run above:

| Step | Climber leaves | Spreader leaves | Layered tufts | Update |
| --- | --- | --- | --- | --- |
| 200 | 21 | 199 | 3 | 0.7 ms |
| 400 | 45 | 632 | 5 | 1.0 ms |
| 700 | 101 | 1,275 | 32 | 1.5 ms |
| 1,100 | 124 | 1,459 | 62 | 1.7 ms |
| 1,600 | 168 | 1,444 | 84 | 1.5 ms |

The Spreader covers the ground, the Climber stays a fringe, and layered
tufts come late, as layered stacks do. The Spreader levels off near 1,450
leaves: its reach is reached by step 480, and after that only new sources
add to it.

Drapers, in the browser, on the stepping-stone run, planted at step 0 on the
tower's roof edge, the west building's east roof edge and a ledge on its
south face, and the east building's roof edge:

- Strands first reached the lawn and rooted at step 290; by step 1,100,
  25 of 66 strands had rooted.
- Vigour measured 0.58–0.85 on the planted edges. The tower's Draper became a
  veil over the Climber by step 700.
- Spreading: one curtain started under the west bridge at step 700, the step
  it matured, from the west building's curtain hanging past it. By step
  1,100, eight Drapers were hanging, four of them on living architecture.
- Cost at step 1,100, with 8 Drapers, 66 strands and 5,690 leaves: laying
  every strand out again after an edit takes 1.3 ms; redrawing them takes
  2.7 ms, every 4 steps while they grow; 100 steps of the whole game, plants
  and Drapers, took 26 ms.
- With real clicks, a click on the west building's wall planted a Draper on
  the ledge above it, and a click on the lawn was refused.

In the browser, with real clicks: placing and stacking blocks spends the
budget, planting and five seconds of play at 16× grew 583 layers, two
structures had formed by step 962, and Undo returned a block with every
plant layer kept.

## Limitations

- **Draper strands pass through living decks.** A strand from a roof edge
  above a bridge hangs straight through the deck; it starts a curtain on the
  deck's edge, but doesn't stop at it.
- **Walkways make the goal much easier.** On the stepping-stone run (a
  three-storey tower between west and east), Climbers with a Draper on each
  of the tower's eaves reached the goal on 10 of 10 seeds (median step about
  900); Climber and Spreader, the bridge route, on 4 of 10. A walkway needs
  only Climber under the curtain and a building in reach, where a bridge
  needs the right meeting high enough on the right face. Whether walkways
  should count toward the goal, or reach less far, is open.
- **Draper forms aren't affected by the seasons' warmth.** The Draper's own
  growth doesn't read it, so its forms come as readily in winter.
- **Ground spread is drawn, not grown.** It follows the plants but does not
  feed back into the simulation: a bed doesn't seed new wall growth, and a
  block placed on a bed only clears the leaves under it.
- **The player can't build on living architecture**, only plant on it.
- **Saving has not run against a live Firestore project.** The save logic has
  been tested end to end on a stand-in store that enforces the rules and the
  1 MiB limit, but not on Firestore itself; see
  [Firebase setup](firebase-setup.md#not-yet-verified). Undo history isn't saved.
- **A loaded world draws its random numbers afresh** from the seed and step,
  as every edit does. It continues exactly as the saved world would have after
  an edit at that step, not as it would have without one.
- **Moderate roofs are patchy in dry weather.** See *Notes*.
- **Ridges are for wet weather.** The driest line on a roof; the Climber
  follows them at 85% rain, rarely at 55%.
- **Stitches are by distance.** A wall cell gives up a diagonal neighbour
  for a stitch, so growth near a stitch is a little less connected there.
- **Spreader + Layered is rare.** It needs a Spreader to grow onto a two-layer
  stack, which takes a long time; a player waiting for a terrace waits.
- **The strategy is cheap.** Three blocks of thirty win; the budget will want
  tuning once there is more to spend it on.
- **One scenario**, a lawn; no hills, water or seasons.

## Notes

- **Withered stacks were miscounted as meetings.** A plant never grows onto
  its own kind, but when a middle layer withers the stack closes over the
  gap, so a cell can hold one species twice. The combination was read from
  depth alone, so a two-layer cell counted as Climber + Spreader whatever it
  held. It wasn't rare: at peak, 183 of 317 such cells in a default run, and
  292 of 423 when the sun moved mid-run, held one species twice. A
  combination now needs both species in the stack. It changed no outcome
  measured: three seeds of the stepping-stone run grew the same structures at
  the same steps (goal at step 700 on seed 1), because where nodes form there
  were already enough genuine meetings.
- **A fifth of the growth vanished on every edit.** When a middle layer
  withers, the stack closes over the gap and can hold one species twice in a
  row. Carrying growth across an edit by re-growing each layer refused the
  second, as the growth rule would. It now copies stacks as they stand.
- **A long advance looked for nodes once.** Advancing 1,600 steps in one call
  checked for a node at the end only, so a test run grew one structure where
  frame-by-frame play grew eight. It now advances in stretches of ten steps.
- **The lawn read as olive-brown.** The Site's lawn colour, under the golden
  hour this page first had, went murky. With a clear sky of its own, the lawn
  is a fresher green.
- **A Draper planted at the eaves barely grew.** Its vigour first read the
  moisture of the cell nearest its anchor. Moisture in the growth model
  gathers low on a wall and is near zero at the top, where a Draper is
  planted. Wall moisture runs 0.00 / 0.32 / 0.47 / 0.59 / 0.73 at the
  10th / 25th / 50th / 75th / 90th percentiles; sun runs 0.14 in shade and
  0.6–0.87 in sun. Vigour came out at 0.32–0.39, and after 1,100 steps no
  strand had reached the ground. It now reads the band of wall the curtain
  hangs across.
- **Chained spreading covered every deck.** When a curtain that had spread
  could spread again, six hung from the decks by step 1,100. Now only a
  planted Draper spreads, at most twice.
- **A world saved after pausing still read as unsaved.** The check compared
  the game's change count recorded at the save with the count in the scene's
  last report, which is sent every 0.3 s while growth runs and not at all when
  paused. After run, pause, save, the report stayed behind and the two never
  matched (reproduced on the earlier build: rounds two and three of run, pause,
  save were all "unsaved"). The check now reads the game's live count.
- **Saving crashed the page on its first run in a browser.** A React effect
  written as `() => onSession({...})` returned the setter's result, and React
  treats an effect's return value as its cleanup: "destroy is not a function"
  on the next render, and the sidebar unmounted. Typecheck and lint were clean;
  the headless test found it.
- **Moderate roofs: the sunny face dries, the shady face is too dark.** On
  the 31° gable the face toward the sun reads sun 1.00 and dries to moisture
  0.17; the other face keeps 0.26 but reads light 0.54, too little for the
  light-loving Spreader. The terrace has both, at sun 0.87 and moisture 0.25.
  So a moderate roof grows the Spreader in patches. That is the model's
  answer, not a tuning target, and in wet weather it greens (37%).
- **Slope was charged twice.** The first affinity took the Spreader from 1 on
  the flat to 0.3 at the steepest, on top of the water slope already costs
  it. A Spreader seeded on the gable died before it spread. It now eases off
  gently (0.7 + 0.3 × flatness), and runoff does the sorting.
- **The first runoff curve made moderate behave like steep.** Retention of
  0.60 at 31° left the gable's slopes almost bare; the curve now keeps 0.80
  there and 0.49 at 49°.
- **Terrace plants were inside the slab.** A terrace's cells sat at the top of
  the block, but townMesh draws a slab 0.08 of a block thick on it, so the
  cells and every plant on them were buried. The surface view showed a
  terrace with no dots; the cells now sit on the slab.
- **Seeds planted up high drew a stem from the lawn.** The vegetation drew
  every seed's stem from the ground, assuming seeds at the foot of a wall. A
  seed on a roof hung a straight dark line down to the grass. Seeds above
  0.5 units now start where they are planted.
- **The first ground beds were discs.** Summing the falloffs of every wall-foot
  cell saturated the coverage nearly to the full reach, so each building sat
  on an evenly filled round carpet. A lower gain lets only the band against
  the wall saturate, and noise thresholding that tightens with distance
  frays the rest.
