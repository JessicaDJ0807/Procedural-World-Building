# Inhabitants

Jessica Hsiao · Procedural World Building

*The little lives of Wildform: small creatures that live on the green, walk
what the plants have grown, and discover new paths as living structures
emerge — in Play and the Lab, and in a studio of their own.*

**Project → Inhabitants** is the studio: a portrait of the creature, four
test scenes, a live inspector, and optional overlays. In **Play** and the
**Lab** they live in the world itself, and **Show Inhabitants** hides them.

## Contents

- [The premise: they live on the green](#the-premise-they-live-on-the-green)
- [Navigation](#navigation)
- [Behavior](#behavior)
- [Appearance](#appearance)
- [In Play and the Lab](#in-play-and-the-lab)
- [The studio](#the-studio)
- [Code](#code)
- [Measured](#measured)
- [Limitations](#limitations)
- [Not built yet](#not-built-yet)

## The premise: they live on the green

There was no inhabitant system before this; it was designed from scratch,
small on purpose, so it could be shared by every page.

An inhabitant walks only where something grows, or on mature living
architecture. Bare wall, glass and the open lawn are off-limits. That one
rule is what makes them worth having: what an inhabitant can reach is the
plants' doing. Two buildings are separate worlds to it until growth or a
structure joins them; a bridge maturing opens a route it will go and
discover; winter's withering can strand one where it stood. They make the
consequences of growth visible without a number on screen.

## Navigation

`src/inhabitants/nav.ts`. The walkable graph is the plants' own: the cells
of the building — walls, roofs, and the decks, rims and supports of living
architecture — joined by the one neighbour table the growth uses
(`green/building.ts`), stitched across roofs and structure patches
(`build/surfaces.ts`). A cell is walkable if:

- it has plant growth and doesn't face down (no walking upside down under a
  soffit), or
- it belongs to a mature living structure and isn't its underside.

Connected walkable cells form **regions** (a flood fill over the neighbour
table); a route never leaves its region. Routes are A* by distance. Each
region records the buildings (town masses) and structures it touches, which
is how an inhabitant notices a new structure. Cells are a quarter-unit
across, twelve to a storey, so routes are fine-grained.

The graph is a snapshot: it is rebuilt as the world changes — when the
building is rebuilt (a block placed, a structure maturing) and as growth
spreads or withers — and inhabitants find their cells again by position.

## Behavior

`src/inhabitants/agent.ts`: one small state machine, the same on every page.
Each behavior is entered for a reason the inhabitant records (its *why*,
shown in the studio):

| Behavior | When |
| --- | --- |
| Idle | resting 1.5–4 s between walks, or waiting with exploring off |
| Exploring | walking to a random nearby cell of its own region |
| Discovering | a living structure it didn't know has joined its region: it walks to it |
| Travelling | walking to a place it was sent (the studio sends them) |
| No route | sent somewhere it can't reach — another region, or where nothing grows |
| Stranded | the growth under it withered and nothing walkable is within a unit |

*Crossing* isn't a behavior but a fact read off where it stands: on a living
structure. They walk at 0.75 units a second — a storey in four seconds — in
real time, not growth steps, so they keep moving while growth is paused. They
know the structures already in their region when they arrive; only what
joins later is a discovery.

## Appearance

`src/inhabitants/inhabitantMesh.ts`. A small round creature: a soft egg of a
body in its coat colour, a paler belly, dark eyes with a glint, rosy cheeks,
stubby feet, and a sprout from its head — the game's own ivy leaf — so it
reads as something that belongs to the plants. A handful of simple shapes
keeps it legible at the game's distance.

It was first a sixth of a storey tall, and in the game it was a speck lost
among the ivy, whose leaves stand further off a wall than it did. It is now
1.1 units — a third of a storey — and stands 0.3 units off the surface,
clear of the leaves. On a wall its "up" is the wall's outward direction, so
it hugs the surface like a gecko.

Four coats — Moss, Lichen, Blossom, Bark — tell them apart; all behave
alike. Four animations, chosen by behavior: a breathing **idle** with blinks
and glances; a bobbing **walk** with stepping feet and a swinging leaf; a
quicker, perkier walk when **discovering**; a **puzzled** head-tilt and
drooping leaf with no route, or stranded.

## In Play and the Lab

`src/inhabitants/population.ts`, through an optional `inhabitants` prop on
`BuildViewport`:

- **They arrive with the green:** one for every 120 walkable cells, up to six,
  each on a random cell of a region of at least 30 cells, the emptiest region
  first. None leave.
- **They follow the world:** the graph is rebuilt every 10 growth steps (at
  most twice a second) and whenever the building is.
- **They only read the game.** Nothing about them is saved; a loaded or new
  world gets new inhabitants (`game.epoch`).
- **Show Inhabitants** — in Play's Worlds menu, and a checkbox under the
  Lab's Growth controls — hides the models only: the inhabitants carry on
  walking underneath, and reappear where they have got to. It is a display
  preference kept in the browser (`localStorage`), shared by Play and the
  Lab, and never counted as a change, so it never marks a world unsaved.
- While they're alive the scene keeps drawing — at 30 frames a second when
  shown, 8 while hidden — since they move with the game paused.

## The studio

`src/inhabitants/InhabitantsPage.tsx`, `StudioViewport.tsx`, `scenarios.ts`.
The Architecture page's layout, warmer: Fredoka names, rounder plates.

- **Portrait:** one inhabitant on a plinth, to orbit and zoom; every coat and
  every animation.
- **Four scenes,** each a real Build game set up from a recipe in the
  Architecture page's form — two of them its own bridge recipes, through the
  same `recipeGame` — and grown:

  | Scene | What it tests |
  | --- | --- |
  | Exploring | one building grown over: two inhabitants wander, rest, wander |
  | No way across | two buildings grown over by Climbers alone — no meeting, no structure; send one across and it has no route |
  | Joined by a bridge | the three-column bridge, mature: its deck is walkable, they cross |
  | A bridge forms | the two-column bridge before it forms; growth runs at 15 steps a second, the bridge matures at step 360, and their regions merge |

- **Controls:** play/pause, reset the scene, pick an inhabitant, **Explore on
  its own** on or off, **Follow** (the camera stays close on the selected one
  — they're Play-sized, small in a whole scene), reset the view. **Click the
  scene to send** the selected inhabitant there: it goes, or says why it
  can't.
- **The inspector** reads the agent: its behavior and why; where it stands
  (which building, or which structure it's crossing); its destination;
  whether there is a route and how many cells remain; its speed; its region's
  size, buildings and structures. *Technical details* fold out the cell, the
  position, the time in its behavior, the structures it knows, distance
  walked and replans, and the graph's size and rebuilds.
- **Overlays, off by default:** labels naming each one's behavior; the
  selected one's route and destination (red when it has no route); and the
  walkable cells, green where it can reach and red where it can't.

Each scene's game is its own, made fresh on every reset and never saved, and
the studio ignores Show Inhabitants: nothing done here reaches a player's
worlds or settings.

## Code

`src/inhabitants/`:

| File | What it holds |
| --- | --- |
| `nav.ts` | The walkable rule, regions, A*, nearest cells; built from a game, never writing to it |
| `agent.ts` | The inhabitant and its state machine; coats; sending; finding its feet after a rebuild |
| `inhabitantMesh.ts` | The model, its animations, and the view that places and animates many |
| `population.ts` | Play's and the Lab's: when to rebuild the graph, when inhabitants arrive |
| `visibility.ts` | Show Inhabitants: the shared, stored display preference |
| `scenarios.ts` | The studio's scenes and their runner |
| `StudioViewport.tsx`, `InhabitantsPage.tsx`, `inhabitants.css` | The studio |

Elsewhere: `BuildViewport` takes `inhabitants`; `WorldMenu` takes `display`
options; `architecture/specimens.ts` exports `recipeGame`, which `grow` now
uses too.

## Measured

- **The premise holds.** On the two-column bridge fixture, the towers are
  separate regions at steps 40–300 (one 690 cells, one 18 at step 300). At
  step 360 the bridge matures, its surfaces join the graph, and one region of
  1,018 cells spans both buildings and the bridge; a 60-cell route between the
  buildings goes over it.
- **A graph builds in 0.6–1.8 ms** on that fixture (3,936–4,334 cells); a scene
  sets up in 44–241 ms.
- **Behavior, traced in Node:** sent across before the bridge, an inhabitant
  says *no route*, waits 2.5 s, gives up; wanders until step 373, just after
  the bridge matures; *discovers* it, walks onto it, rests; sent across
  again, travels a 29-cell route and arrives on the far building. In the
  browser the same scene showed both inhabitants discovering at step 367 and
  on the bridge by step 433.
- **Show Inhabitants, in Play:** hidden, six inhabitants walked on (total
  distance 4.3 → 11.8 units over 3 s) with the same ids; shown again, they
  stood where they had got to; growth ran 100 steps and a planting counted
  while hidden; a just-saved world stayed saved, its change count unchanged.
- **No leaks:** the bridge scene held 27 GPU geometries after two full cycles
  of every scene and three resets.
- Explore's Midterm Demo hash and the Lab's goal regression are unchanged:
  inhabitants never write to the game.

## Limitations

- **No inhabitant can leave a building on foot** unless growth or a structure
  joins it to another — by design — so in a sparse world each stays put.
- **On a wall they hug it sideways.** "Up" is the surface normal, so on a
  vertical wall the figure sticks out from it; it reads as clinging, but it
  isn't how a person would stand.
- **They are small in the whole game view** — legible up close, specks across
  the lawn. The studio has Follow for that; Play doesn't.
- **At phone width Play hides the world menu, and with it Show Inhabitants.**
- **They overlap each other**: no avoidance between inhabitants.
- **Headless runs are slow**: in the browser tests the software renderer
  advanced the agents at roughly half real time.

## Not built yet

Ideas, not features: inhabitants that favour particular plants or
structures, that gather where it's sheltered, that help seed new growth, or
that a player can send. Today they walk, rest, discover, and say when they
can't get somewhere.
