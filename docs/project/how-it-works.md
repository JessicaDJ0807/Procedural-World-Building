# How Wildform works

Jessica Hsiao · Procedural World Building

*Every mechanism behind the game, in the order the data flows: from a block
the player places to the living architecture the plants grow, and back. Each
stage names its algorithm, its key numbers and the code that runs it. The
numbers are the code's own constants or were measured; nothing here is an
estimate.*

The same account, shorter, is the app's **Project → How it works** page.

```
 blocks ──▶ building rules ──▶ growth cells ──▶ fields ──▶ growth ──▶ meetings ──▶ grammar ──▶ living architecture
 (voxels)   (adjacency)        (surface graph)  (sun,      (tips,      (stacks,     (nodes,     (curves, swept decks,
                                                 moisture,  layers;     curtains)    context)    stages)
                                                 geometry)  Draper)                                  │
     ▲                                                                                              │ matures:
     └────────────── new surfaces, shade and support feed the cells and fields ◀────────────────────┘ shade, support, surfaces

 alongside: seasons (weather + look) · inhabitants (walkable graph, A*) · rendering · saving
```

## Contents

1. [Blocks: the voxel town](#1-blocks-the-voxel-town)
2. [Building rules: blocks into houses](#2-building-rules-blocks-into-houses)
3. [Growth cells: a graph over every surface](#3-growth-cells-a-graph-over-every-surface)
4. [Fields: light, water, geometry](#4-fields-light-water-geometry)
5. [Growth: Climber and Spreader](#5-growth-climber-and-spreader)
6. [The Draper: a plant that hangs](#6-the-draper-a-plant-that-hangs)
7. [Meetings and the mutation grammar](#7-meetings-and-the-mutation-grammar)
8. [Living architecture: geometry and stages](#8-living-architecture-geometry-and-stages)
9. [Seasons](#9-seasons)
10. [Inhabitants](#10-inhabitants)
    - [The landscape](#10b-the-landscape)
11. [Rendering](#11-rendering)
12. [Saving](#12-saving)
13. [The Architecture page's specimens](#13-the-architecture-pages-specimens)

## 1. Blocks: the voxel town

`src/build/town.ts`. The player's world is a **voxel grid**, 14 × 14 cells
and 8 storeys, stored as one byte per cell (0 empty, else a colour), with a
parallel mask for the two existing buildings, which can't be removed.

- **Budget:** 30 blocks; a new block is refused when none are left.
- **Colour:** a block takes the colour of the one it was placed against; on
  open ground, a position hash weighted toward the stone palette.
- **Undo:** a stack of edits; Clear is one undoable edit.
- **Buildings ("masses"):** a stack-based **flood fill** over the six face
  neighbours gives every connected group of blocks an id. The goal reads it:
  a mature structure whose two ends are in different masses is a *living
  connection*, and a **union–find** over those connections says whether west
  and east are joined (`game.ts: updateConnections`). Blocks that make west
  and east one mass don't count — the goal asks that they stay two.

## 2. Building rules: blocks into houses

`src/build/townMesh.ts`. The player only places and removes blocks; every
block then becomes something that depends on its neighbours, so the same
click reads differently in different places — the Townscaper idea.

These are **deterministic local adjacency rules**: each block reads its
neighbours and gets exactly one result.

- **Walls** only on sides that face open air, each with a framed window; one
  ground-floor open side of a house gets a door.
- **Roofs** on a block with nothing above, chosen by its neighbours at the
  same height: none → a small **hip** roof; neighbours along one axis only →
  a **gable** whose ridge runs along the row; along both axes → a flat
  **roof terrace** with a parapet on each edge that opens onto a drop.
  Neighbours count whether or not something stands on them (counting only
  roofed ones made a 3 × 3 block with a house on it come out as gables
  meeting terraces).
- **Arches** under a block that spans between two blocks at its own height;
  **stilts** (four posts) under any other overhanging block.
- A stone **footing** on the ground floor; **string courses** where a storey
  meets the next — the ledges the Spreader favours.

Built as merged boxes and prisms in vertex colour and rebuilt in full on each
edit: a full grid is 1,568 cells and rebuilds in a few milliseconds.

**Not Wave Function Collapse.** WFC also picks a module per cell from what
its neighbours allow, but it chooses among *several* compatible modules —
lowest entropy first, at random, propagating constraints and sometimes
backtracking. Here every neighbourhood has exactly one answer, so there is
no search and no randomness in the shape. That is deliberate for a game: the
player has to be able to predict what a click will build. Variety comes from
arrangement, not from chance.

## 3. Growth cells: a graph over every surface

`src/build/townBuilding.ts`, `src/green/building.ts`, `src/build/surfaces.ts`.
Plants don't grow on meshes; they grow on **cells** — small patches sampled
over every surface — joined by a neighbour table.

- **Scale:** a block is 3 units; a cell is 0.25, so a block face is 12 × 12
  cells.
- **Walls:** each run of open faces up a column becomes a wall segment; each
  storey line in it a ledge (0.2 deep). Windows and doors are cut from the
  same openings the mesh draws: cells inside a pane are **GLASS**
  (ungrowable), within one cell of it **FRAME**.
- **Roofs:** flat roof terraces become roof cells; everything else is added
  as patches below.
- **Per cell:** position, outward normal, an "across" and "up" direction in
  the surface, flags (GLASS, FRAME, LEDGE, SHELTER, ROOF, EDGE), and eight
  neighbours.
- **The neighbour table:** for each of eight directions, step one cell along
  the surface and take the **nearest cell within 0.2** (a bucket-grid
  search). There are no special cases: wall-to-wall corners, wall tops to roof
  edges and walls standing on roofs all fall out of the nearest-cell rule.
  A roof cell missing a neighbour is an **EDGE**.
- **Patches** (`surfaces.ts`): pitched roofs and every *mature* living
  structure are laid as grids of cells on the surface as drawn, appended to
  the building and **stitched** to the nearest cells of other surfaces within
  0.45 — an eave to the wall under it, a deck's root to the wall it grips. So
  growth moves wall → eave → ridge, and wall → root → deck. Each patch cell
  carries a kind (roof slope, ridge, eave, gable, deck top, rim, underside,
  support, junction), how much rain it keeps (`1 − 0.7·smooth(10°, 70°,
  slope)`), and a per-species **affinity** that weights suitability — e.g.
  a deck top suits the Spreader (0.7 + 0.3·flatness), a support the Climber
  (1) far more than the Spreader (0.3). No surface is reserved for one
  species; only glass is invalid.

## 4. Fields: light, water, geometry

`src/wildform/world.ts`, `src/green/fields.ts`. Every cell gets three fields,
recomputed when the building or weather changes.

**Sun.** The sun stands at 38° elevation; its azimuth is the weather's (the
default −58°). Each cell's direct light is Lambert, `n·L / cos(38°)`, so a
flat roof gets about 0.78. **Shadows are exact ray tests, not a shadow map:**
the ray from each cell toward the sun is tested against every edge of every
building footprint, and blocked if it crosses one at a height inside the
building. Overhangs on the cell's own wall shade it too. Sky light adds 0.14
on a wall (less in an inside corner, ×0.6 under a balcony) and 0.2 on a roof:
`sun = clamp(sky + 0.86·direct)`.

**Moisture** — rain running down the building. Each wall column is walked top
to bottom carrying a load of runoff:
- direct rain `0.35·rain` (none under shelter; glass passes it all on);
- rising damp at the foot, `0.45·(0.4 + 0.6·rain)·e^(−y/1.6)`;
- a ledge catches `0.8×` the load and passes on only 35%;
- the load carries on at 90% plus half the direct rain;
- evaporation `×(1 − 0.55·sun)`.

Whatever reaches a column's foot drains onto a roof below it; roof cells get
`0.6·rain` (×1.35 at an edge) plus that runoff. Two passes of a three-tap
blur wick water sideways, and the result is mapped to 0–1 by `1 − e^(−1.6x)`.
Patch surfaces keep rain by their slope (an underside gets little, an eave
more).

**Geometry** — something to hold. A breadth-first search from frame, ledge
and edge cells, two steps deep (1 on the feature, 0.5 a step away), and a
Gaussian falloff from corners (`e^(−(d/0.9)²)`, inside corners stronger).
Mature living architecture adds support: its frame and roots set geometry to
1 on the walls they touch, and its decks join the shadow rays.

**Per species**, the two plants read these differently:
- moisture match `smoothstep(0.06·need, need, moisture)`;
- light match `clamp(1 − 1.1·|sun − preference|, 0.08, 1)`;
- `env = moisture × light × affinity`;
- `suitability = env × (1 − support + support·geometry)`.

## 5. Growth: Climber and Spreader

`src/wildform/growth.ts`, `species.ts`, `sim.ts`. Growth is **agent-based**:
each plant spreads by **tips** that walk the cell graph one step at a time.

| | Climber | Spreader |
| --- | --- | --- |
| Light preference | 0.5 (part shade) | 0.85 (sun) |
| Moisture need | 0.4 | 0.3 |
| Needs something to hold (support) | 0.5 | 0.25 |
| Pull up (vertical) | 0.85 | −0.05 |
| Pull sideways (lateral) | 0 | 0.55 |
| Bonus on a ledge | 0 | 0.35 |
| Keeps going straight | 0.45 | 0.1 |
| Avoids its own kind | 0.35 | 0.05 |
| Most tips | 30 | 22 |

Each step, every tip:
1. may die, with probability `0.005 + 0.12·harsh²` (harsh = 1 − env where it is);
2. scores each enterable neighbour —
   `1.4·suitability + vertical·rise + lateral·(1 − |rise|) + straightness·(step · heading) + ledge bonus − crowding·own neighbours + noise`;
3. grows into the best one if its suitability is over 0.1, with probability
   `0.05 + 0.95·suitability²`;
4. may branch into the second best (`branch + branchPerEnv·env`).

So the Climber's upward, edge-following habit and the Spreader's sideways
spread come only from these weights; neither has a separate steering rule.
Side shoots wake on cells it already holds, more as it grows.

**Layers.** A cell holds up to three layers. A plant never grows onto its own
kind, and how well it grows onto the other is a substrate factor: a Climber
onto Spreader ×1.6, a Spreader onto Climber ×1.2. A covered layer gets
`0.75^(layers above)` of the light.

**Withering.** A layer whose conditions fall more than 0.12 below what it grew
in is stressed, and dies with probability `0.24·(drop − 0.12)` per step. A
Climber that dies takes everything grown from it; a Spreader's descendants
live on as orphans; the stack closes over the gap. Seeds never wither.

**Warmth** (the seasons, below): below 1, a tip idles a step with probability
`1 − warmth`, and side shoots scale with it.

**Determinism.** All randomness comes from one seeded generator (a
mulberry32-style hash), seeded from the world's seed — and, after a rebuild,
from the seed and the step — so the same world and the same actions grow the
same plants. **Editing doesn't reset growth:** when the town changes, every
layer is carried onto the new building by position and facing (not cell
index), in birth order, keeping its birth step.

## 6. The Draper: a plant that hangs

`src/build/draper.ts`. The Draper is its own model, not a third tip species:
its strands spend most of their length in open air below an edge, where
there are no cells.

- **Anchoring:** on an edge — a roof eave, a string course, the underside of
  an overhang, or a mature structure's deck edge. A click finds the nearest
  valid edge; the curtain can widen along it up to three blocks either side
  of the one clicked.
- **Strands:** each is laid out in 0.22-unit steps straight down, with a slow
  sway along the edge and a little drift outward; where there's a wall behind
  it, it clings to a wavering gap off the face. It ends at its reach (up to
  10 units), the lawn (where it **roots**), or a block (where it rests).
- **Density:** a strand every 24 steps, up to nine — a curtain, longest in the
  middle so its hem curves.
- **Vigour:** best in part sun (light about 0.45) and moderate moisture
  (about 0.5).
- **Veil:** over a wall the Climber has grown, it grows half as many strands
  again, faster.
- **Spreading:** an established Draper attaches to a mature deck edge within
  2.6 units of its own edge (or 1.2 of a strand) and starts a new curtain
  there — at most twice.

## 7. Meetings and the mutation grammar

`src/build/living.ts`, `src/build/draperLiving.ts`, `src/build/game.ts`.
Living architecture is a **grammar**: what meets decides what grows, and the
context decides its shape.

**What met** is read from a cell's stack: both species present (two layers)
is *Climber + Spreader*; a Climber on top of two layers is *Climber +
Layered*; a Spreader on top, *Spreader + Layered*. The Draper meets the
others through its curtain (it never enters a stack): once established — 200
steps, five strands — the game reads the cells behind its grown strands, the
edge it hangs from, and what its strands reached below.

**A node forms** (checked every 10 steps, at most one per check): enough cells
of one combination within 1.2 units (six for Climber + Spreader, two for the
layered ones), their growth at least 25 steps old on average, at least 1.8
units up, five units clear of other structures, eight structures at most.
The rarer combinations are checked first. Balconies are capped at three.

| What met | Grows | Shaped by |
| --- | --- | --- |
| Climber + Spreader | **Bridge** to another building within five columns; else a **Balcony** | the gap; the Spreader's heading bows the arch and aims it |
| Climber + Layered | **Scaffold**: helical rails past the roof | leans with the Climber; an arm to a building within four columns |
| Spreader + Layered | **Terrace** at the roof, or a **Canopy** below it | how far the roof is; a neighbour in reach to span to |
| Climber + Draper | **Suspended walkway** | a building within five columns, up to two storeys up or down |
| Spreader + Draper | **Hanging pod** | Spreader along the edge; room to hang |
| Draper + Layered | **Root column** | strands rooted below; what it hangs from |

## 8. Living architecture: geometry and stages

`src/build/living.ts` (planning), `src/build/livingMesh.ts` (drawing).
Nothing is a prefab: each structure is **planned as curves** from its node
and the context, then **swept** into geometry.

- **Finding a target:** casts out from the node along the wall's facing,
  turned toward the Spreader's heading and fanned ±20° and ±40°, at the
  node's height and a storey up or down, for the nearest face of *another*
  building.
- **Curves:** a bridge is a quadratic Bézier from wall to wall, its middle
  control point raised 0.12 of the span (so the arch's crown rises about 6%
  of it) and pushed sideways by the Spreader's heading; a scaffold is
  three helical rails round a leaning axis; a walkway sags on a catenary below
  cables strung between masts; a pod is a stack of open hoops round a
  teardrop profile; a root column is six strands spiralling round an axis.
- **Swept decks:** each deck is a Catmull–Rom curve swept with a ring
  section — a flattish top, a deeper rounded underside, an edge that swells
  and dips by a hash — coloured root-brown below and stone with moss on top.
  Rails, ribs, roots and cables are tubes.
- **Growing in stages,** over simulation steps after the node: a knot swells
  (0–30), the frame draws out along its length (20–150), the decks fill in
  from their roots (140–300), raw fibre turns to stone (280–380), leaves open
  from the node out (360–520).
- **Maturing (step 300)** turns it into architecture: its decks join the
  shadow rays (shade), the walls its frame and roots touch become support for
  climbing, and its surfaces become cell patches (section 3) — so plants grow
  onto it, and it can grow more architecture.

## 9. Seasons

`src/game/seasons.ts`, `seasonLook.ts`, `src/build/seasonFx.ts` (Play only).
The year turns on its own: four 500-step seasons, each setting the real rain
and sun direction the fields are computed from, and a **warmth** for the
growth.

| Season | Rain | Sun azimuth | Warmth |
| --- | --- | --- | --- |
| Spring | 0.55 | −58° | 1 |
| Summer | 0.45 | −58° | 1 |
| Autumn | 0.72 | −62° | 0.8 |
| Winter | 0.50 | −70° | 0.15 |

The season comes from the step alone, so a saved world returns in its season
with nothing extra saved. Changes are blended over 150 steps with a
smoothstep, applied every five steps. Tuned by goal rate over ten seeds: 4 of
10 reached the goal, as without seasons, with winter costing about a third of
the plants and spring regrowing them.

**The look** follows the same blend: leaf materials are patched in their
shader to pull toward the season's colour at their own brightness; the lawn,
sky, haze and light are tinted; and particles fall — rain scaled by the real
rain value (none at 0.4, 900 drops at 0.8), snow in winter, leaves in autumn,
petals in spring — and leaves drop wherever growth withers, brown except in
autumn, when they take the season's colours. The land's plants take the tint
too, each layer by its own strength: broadleaves fully, shrubs and saplings
85%, ferns 80%, grass 45%, conifers 10%.

## 10. Inhabitants

`src/inhabitants/`. Small creatures that walk only **where plants grow or on
mature living architecture**, so what they can reach is the plants' doing.

- **Walkable graph:** the growth cells, through the same neighbour table — a
  cell with growth that doesn't face down, or any surface of a mature
  structure but its underside.
- **Regions:** a **flood fill** gives connected walkable cells a region; a
  route never leaves one. Two buildings are separate regions until growth or
  a structure joins them (on the bridge fixture: two regions until the bridge
  matures at step 360, then one). Rebuilt as the world changes, in 1–2 ms.
- **Routes:** **A\*** by distance over walkable cells.
- **Behaviour, in two layers.** *What it wants*: a **utility** system scores
  four goals — explore, rest, seek shelter, observe — from its **needs**
  (energy, comfort, curiosity), its **nature** (curious, cautious) and the
  game's own weather (rain, warmth, summer), over places it can reach, judged
  by what they offer: cover from the building's own surfaces, sunlight from
  the growth model, height, and what each kind of living architecture is for
  (a pod encloses, a balcony looks out, a bridge leads somewhere new). It
  sticks to a goal (hysteresis, a 1.5 s recheck, a margin to interrupt).
  *How it goes about it*: a **state machine** — idle, exploring, discovering,
  travelling, resting, observing, no route, stranded — whose transitions are
  one table that every change is checked against, and that the Inhabitants
  page draws its graph from.
- **Population (Play and the Lab):** one per 120 walkable cells, up to six.
  They only read the game; nothing about them is saved.

## 10b. The landscape

`src/build/landscape.ts`, `landscapeDecor.ts`. Scenery round the town, never
read by the simulation. Height is the town's ground plus seeded **Perlin**
hills — two octaves, **domain-warped** so the rolls bend and run together —
under a smoothstep **mask** that is exactly zero within 3 units of the grid, so
gameplay ground is untouched. The clearing sits in a shallow **hollow**: the
ground lifts from inside its edge to a rim about 2 units up, its height noise
round the circle and open along the valley, so the trees at the edge stand
above the buildings and close the view without making an arena; moisture,
colour and the conifers' odds read the *relief* (the land without the rim), so
the rim stays green meadow slope. Landforms come from **ridged noise**, (1 − |n|)²:
a ridgeline whose crest wanders, with peaks and saddles, a gentle front and a
steep back; a lower spur; shallow troughs far out; and an open valley kept
clear of trees (as anisotropic Gaussians they read as isolated domes). Three
0–1 fields — elevation, moisture (wetter in hollows), fertility — colour the
ground by smooth blends and decide where decorations grow: a seeded
jittered-grid **scatter**, kept by suitability × density, clustered by noise
fields, with minimum spacing and a quiet margin round the buildings — grass and
flowers in the meadow, saplings just ahead of the forest's edge, shrubs and
ferns under it. Beyond the meadow, a **forest** round a small, irregular clearing (its radius
noise sampled round a circle, 13–21 units): trees scattered as tight or loose
Gaussian groves round jittered centres, visited nearest-first so the cap is
spent where trees are seen, small at the edge and maturing over 20 units. Six
**families** — broad and slender deciduous trees, short firs, tall spires,
crooked and weeping accents. Each grove has a **leading family**, drawn with
odds that favour conifers on high ground but move with a slow noise field, and
50–85% of its trees follow it; the rest are companions — so stands are mixed
and no side of the clearing is all one kind. A **middle layer** at the edge —
saplings, groups of young trees, tall shrubs, ferns — turns the meadow into
forest gradually. A **stream** springs on the ridge's slope and leaves by the valley: laid out by
bearing, meandered by noise and drawn toward low ground, widening round bends
and into pools; its water level never rises downstream and stays below the
ground on both sides (it had stood on a levee above the meadow); it is cut
into `height` — a bowl under the water, a small lip at its edge, banks widening
with the cut — drawn by a finer bank mesh than the lawn allows, and its
translucent water's patterns move along the stream's own phase, at its pace. **Footpaths** are routed by **A\***
over a grid priced by slope², each coming to one building's outer side but
never into the gap between them or near the water — so nothing on the ground
joins the buildings — then rounded (Chaikin), meandered, and laid as ragged,
alpha-faded ribbons on the lawn's drawn surface. A meadow **patch field**
clusters taller grass, ground cover in warped, lobed patches, and wildflower
drifts of one colour each; a broad tone shifts the green; a few accents — a
fallen log, mossy stones, mushrooms, a flowering shrub — each take a quarter of
the clearing. Nothing stands on the protected ground round the buildings and
between them. Reeds, stones and fallen leaves follow the water and the paths. Through the
year, uniforms set from the same seasonal look tint the water, open and close
the flowers, and scatter leaves in autumn. All drawn as **instanced meshes** that can't be clicked; trees near the
camera dissolve by a dithered fade; only trees within 60 units cast shadows,
since no farther one can reach the sun's shadow map. Saved as a seed and a
density; the objects regenerate. Details in [build.md](build.md#the-landscape).

## 11. Rendering

three.js, WebGL.

- **Vegetation** (`src/wildform/wildVegetation.ts`, `src/green/vegetation.ts`):
  **instanced meshes** — one batch of stems and one of leaves per species —
  each instance carrying its birth step. A vertex shader reads the step:
  leaves open from nothing over 30 steps and turn from young to mature
  colour; stems draw out and thicken with age. So growth animates on the GPU
  without rebuilding geometry; only new layers are appended (partial buffer
  uploads), and a full rebuild happens only when growth is removed.
- **The town:** merged boxes and prisms in vertex colour, rebuilt per edit.
- **Sky:** a shader dome — a horizon-to-zenith gradient, **fBm** clouds
  (five octaves of value noise) projected onto a plane overhead, a glow round
  the sun.
- **Lawn:** a 180 × 180 grid displaced by sines, mown stripes per column.
- **Ground cover** (`src/build/groundCover.ts`): a 0.5-unit tile grid round
  the town; wall feet, rooted structures and Draper roots splat a strength that
  grows with age; two octaves of value noise break it into patches; a leaf
  appears where a fixed per-tile hash falls under the density, so leaves never
  jump between updates.
- **Living architecture:** swept decks and tubes (section 8), grown by
  revealing index ranges in stages.
- **Render on demand** (`src/renderLoop.ts`): a frame is drawn only while
  something moves; idle, nothing is drawn. Shadow maps refresh only when
  needed — every eight steps while a structure is still growing.

## 12. Saving

`src/build/worldState.ts`, `src/firebase/worlds.ts`. A world is saved as
**state, not scene**: no meshes and no cells.

- **Saved:** the town (base64 bytes), the living structures as planned, the
  Drapers, every plant layer (position, facing, species, birth, parent, env —
  22 bytes each) and growing tip, the weather, seed, step, counters and logs.
- **Loading rebuilds the rest** through the same path an edit takes — town →
  building rules → cells and patches → fields → growth laid back by position —
  so a loaded world is the same simulation, not a picture of one: its next 400
  steps match the original's.
- **Firestore:** a world document under `users/{uid}/worlds`, its body cut
  into 800,000-character chunks; a save writes a new snapshot first and points
  the world at it last, so a failed save never leaves a broken world.
  Versioned: a newer format is refused, an older one migrated.

## 13. The Architecture page's specimens

`src/architecture/specimens.ts`. Every specimen on the Architecture page is a
real game: a **recipe** — a few blocks, seeds, a world seed, the rain — played
ten steps at a time until the game forms the structure. The recipes were found
by **search** over layouts and seeds (432 runs for the wall's five forms, 357
for the Draper's three), keeping runs where the wanted kind formed. If a
recipe ever grows something else, the page refuses to show it.
