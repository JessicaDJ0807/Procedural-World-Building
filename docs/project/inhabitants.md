# Inhabitants

Jessica Hsiao · Procedural World Building

*The little lives of Wildform: small creatures that live on the green, walk
what the plants have grown, and discover new paths as living structures
emerge — in Play and the Lab, and in a studio of their own.*

**Project → Inhabitants** is the studio: a portrait of the creature, six test
scenes, a live inspector of what each one wants and why, its state machine
drawn from the code, and experiments with the weather, its nature and its
needs. In **Play** and the
**Lab** they live in the world itself, and **Show Inhabitants** hides them.

## Contents

- [The premise: they live on the green](#the-premise-they-live-on-the-green)
- [Navigation](#navigation)
- [Behavior](#behavior)
  - [Two layers: what it wants, how it goes about it](#two-layers-what-it-wants-how-it-goes-about-it)
  - [Needs and nature](#needs-and-nature)
  - [Choosing a goal](#choosing-a-goal)
  - [What a place offers](#what-a-place-offers)
  - [The state machine](#the-state-machine)
  - [Seasons and weather](#seasons-and-weather)
  - [Not saved, but the same characters](#not-saved-but-the-same-characters)
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

### Two layers: what it wants, how it goes about it

`src/inhabitants/mind.ts` and `agent.ts`. They used to wander at random and
walk over to anything new. Now each has reasons:

    perception → needs + nature → goal (mind.ts) → state machine (agent.ts) → route (nav.ts) → walking

- **What it wants** — a *goal*: explore, rest, seek shelter or observe —
  chosen by a small utility system from its needs, its nature and the weather,
  over places it can actually reach.
- **How it goes about it** — a *state*: idle, exploring, travelling,
  resting… The state machine carries a goal out; one goal passes through
  several states (seek shelter: idle → travelling → resting).
- **Whether it can** — the navigation graph, unchanged: A* within a region,
  only where plants grow or on mature structures. A goal never overrides it.

### Needs and nature

**Needs** (0–1) change as it lives:

| Need | Falls | Rises |
| --- | --- | --- |
| Energy | 0.011 a second walking (a minute of walking tires it), half as much again in the cold; 0.0015 standing | 0.045 a second resting, a little less if uncomfortable — about twenty seconds back from tired |
| Comfort | — | follows how the place it stands feels, at 0.2 a second (below) |
| Curiosity | 0.12 on getting somewhere it explored, 0.35 on reaching a structure it hadn't seen, 0.03 for each new neighbourhood, a little while looking round | 0.006 a second otherwise, faster for a curious nature |

**Nature** (0–1) never changes: how *curious* it is, how *cautious*, and how
*sociable* — kept for later; nothing reads it, and nothing pretends to.

**Familiarity**: it counts its visits to 3-unit neighbourhoods; four visits
and a place is familiar. A cautious nature prefers the familiar and the near.

### Choosing a goal

`decide` scores the four goals over about thirty candidate places in its own
region — a random spread, one cell of each structure there, and where it
stands — by straight-line distance; only the winner is routed (falling back
to the next best if the graph has no way there). Each score is a sum of
named factors, which the studio shows:

| Goal | Up | Down | Only if |
| --- | --- | --- | --- |
| Explore | curiosity; a curious nature; something new in reach (an unseen structure above all), weighted by nature | caution; tiredness; discomfort; the weather out there; the cold | somewhere else in its region |
| Rest | tiredness; a cautious nature; a good spot in reach | — | — |
| Seek shelter | how much better somewhere reachable feels than here; discomfort; less if far | — | somewhere at least 0.12 more comfortable |
| Observe | a lookout in reach (less if it knows it well); a little curiosity | tiredness; discomfort; the weather out there | a lookout worth 0.35 |

An unavailable goal isn't scored, and the studio says why ("nowhere reachable
is more comfortable").

**It sticks to what it chose.** A goal is chosen when it is idle. While it
carries one out, the goal gets a small bonus (0.08) against near-equals, and
it looks again only every 1.5 s — and then changes course only if a rival is
better by 0.25, it has rested at least 4 s, or it's exhausted (energy under
0.1 while exploring). Choosing afresh, the goal it has just finished is a
little less appealing (−0.15), for variety.

How strongly a structure it hasn't seen draws it depends on its nature, both
in the score and in ranking places (0.3 + 1.2 × curious − 0.6 × cautious):
weighted only in the score, a cautious one still picked an unseen bridge as
the most novel place, and reached it as soon as a curious one.

Five things found by watching, not planned:
- *A balanced inhabitant looked out from the same balcony 69% of the time and
  never explored.* Looking round satisfied curiosity (−0.03 a second), so it
  never built up; and the goal it had just finished kept the "already doing
  it" bonus. Now looking round satisfies little (−0.01), a well-known lookout
  palls, and the bonus applies only while a goal is under way.
- *Sheltering, it walked straight back out into the rain.* Under cover its
  comfort is high, so exploring looked fine and shelter looked pointless. Now
  exploring and observing count the weather out there, sheltering lasts until
  the weather clears, and staying sheltered is worth how much worse it would
  be in the open.
- *One sheltered a step short of the canopy, in the rain:* "near enough" to
  the chosen place counted as there. Now only the chosen cell does.
- *In Play's autumn, five of six sheltered all season.* Rain counted from 0.45,
  so autumn's 0.72 felt like 85% of a downpour, and sheltering lasted until it
  cleared. Now rain counts from 0.6 (autumn's is a third of a downpour), and
  sheltering palls after half a minute or so, so a curious one goes out.
- *Winter had the most exploring of the year* in a world with nothing covered
  in reach: shelter wasn't possible, and nothing else held them back. Now cold
  weighs against exploring, and walking in it tires them faster.

### What a place offers

From the world's own data, not a new simulation:

- **Cover** — a horizontal surface (a roof, a deck, a structure's underside)
  0.8–10 units above, within 0.55 units of the point just in front of the cell
  (for a wall, 0.6 out from it: a wall is covered only by something
  projecting over it, an eave, a canopy, a bridge). A first version looked in
  1.2-unit grid squares and counted every wall as covered by its own roof —
  70% of walkable cells. Now a plain building's walls come out 0% covered, and
  the covered cells are under canopies, decks and pods.
- **Sun** — the growth model's own sunlight field, shadows included.
- **Height** — a lookout is 1.5–9 units up, open to the sky.
- **Comfort** = 1 − 0.55 × rain × exposure − 0.4 × cold × exposure −
  0.3 × summer heat × sun, where rain and cold come from the game's weather
  (below) and exposure falls with cover.
- **What living architecture is for** — a design intention by kind, applied
  only to cells the graph says are walkable (an underside never is):

  | Kind | Offers |
  | --- | --- |
  | Hanging pod | enclosure (+0.3 shelter — its hoops close round you), somewhere to settle |
  | Terrace | somewhere to settle |
  | Balcony | a lookout (+0.2), somewhere to settle |
  | Bridge, suspended walkway | passage: new ground beyond (+0.15 to exploring) |
  | Canopy | measured cover; somewhere to settle |

  Scaffolds and root columns are walked like any structure; their vertical
  climb is in the graph, nothing more is claimed of them.

### The state machine

`TRANSITIONS` in `agent.ts` is the machine: every change of state goes
through `enter`, which checks it against the table and counts any that isn't
there (the tests require none, after every scenario they run). The studio's
graph is drawn from the same table, so it can't drift from the code.

| State | Means |
| --- | --- |
| Idle | standing still, deciding: every goal starts here |
| Exploring | walking somewhere unfamiliar |
| Discovering | walking to a structure it hasn't seen |
| Travelling | walking to a chosen place — to rest, shelter, look out — or where it was sent |
| Resting | staying put while energy, or comfort, comes back |
| Observing | standing at a lookout, looking round (4–7 s) |
| No route | sent somewhere it can't reach |
| Stranded | the growth under it withered, nothing walkable near |

Resting and observing are new; the rest are the old machine's. Discovering is
now a decision — a curious inhabitant goes to see a new structure, a cautious
one may not — where before every inhabitant broke off whatever it was doing.
*Crossing* is still a fact read off where it stands, not a state.

### Seasons and weather

Nothing seasonal is scripted: the inhabitants read what the game already
has, and the goals follow.

- **Rain** — `game.env.rain`; it starts to matter at 0.6 and is full at 0.95
  (spring's 0.55 is dry to them, autumn's 0.72 a third of a downpour).
- **Cold** — `game.warmth`, 1 in spring and summer, 0.15 in winter.
- **Summer heat** — the seasons' summer weight, in Play only (the Lab's
  weather holds): sun becomes something to get out of.

So in autumn's rain and winter's cold, cover is worth more and going out
worth less; in summer a shaded pod is; and in winter, as growth withers,
routes go — they replan, give up or strand, as before. Measured on a grown
Play world (a tower between the two buildings, both planted, 1,800 steps),
six inhabitants, 150 s a season, by share of their time:

| Season | Explore | Observe | Rest | Seek shelter |
| --- | --- | --- | --- | --- |
| Spring | 53% | 32% | 14% | — |
| Summer | 38% | 29% | 21% | 13% (out of the sun, in the pod) |
| Autumn | 38% | 29% | 32% | 1% |
| Winter | 14% | 5% | 82% | — |

Winter's routes don't wither in that measurement (the world was held still);
in Play they do, and exploring falls further.

### Not saved, but the same characters

Inhabitants still aren't saved — nor where they stood — so saving their
needs alone would resume nothing coherent. Instead each one's **nature** is
seeded by the world's seed and its number, not the load: a reloaded world has
the same characters in it, with fresh needs (tested). The save format is
unchanged, so every older world loads as before.

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
- **Six scenes,** each a real Build game set up from a recipe in the
  Architecture page's form — through the same `recipeGame` — and grown:

  | Scene | What it tests |
  | --- | --- |
  | Exploring | one building grown over: two inhabitants wander, rest, wander |
  | No way across | two buildings grown over by Climbers alone — no meeting, no structure; send one across and it has no route |
  | Joined by a bridge | the three-column bridge, mature: its deck is walkable, they cross |
  | A bridge forms | the two-column bridge before it forms; growth runs at 15 steps a second, the bridge matures at step 360, and their regions merge |
  | Shelter from rain | the low canopy in a downpour: under it is drier — who goes there, and when do they leave |
  | Winter dieback | a grown tower whose growth runs on at winter's warmth: routes wither under them |

- **Controls:** play/pause, reset the scene, pick an inhabitant, **Decides for
  itself** on or off, **Follow** (the camera stays close on the selected one
  — they're Play-sized, small in a whole scene), reset the view. **Click the
  scene to send** the selected inhabitant there: it goes, or says why it
  can't.
- **The inspector** reads the agent: its behavior and why; where it stands
  (which building, or which structure it's crossing); its destination;
  whether there is a route and how many cells remain; its speed; its region's
  size, buildings and structures. *Technical details* fold out the cell, the
  position, the time in its behavior, the structures it knows, distance
  walked and replans, and the graph's size and rebuilds.
- **What it wants and what it's doing**, side by side: its goal and the
  reason, its state and where it's going — the distinction the page is built
  round. Then its needs (bars that move) against its nature (that don't).
  ![The studio's lower band in the Shelter scene: the state machine drawn from the code with Resting current and selected, the transition from Idle highlighted, Resting's entries and exits read out from the table, the recent history; beside it the four goals scored — Rest chosen, Seek shelter not possible because it is already comfortable — with Rest's factors; and the experiment controls for season, downpour, nature and needs](../images/inhabitants-mind.png)

- **How it goes about it:** the state machine, drawn from `TRANSITIONS`. Its
  current state is filled, the transition it last made flashes, and picking a
  state reads out what it means, how it's entered and left, and which goals
  lead to it. Under it, **Lately**: its recent goals and changes of state, as
  recorded (a repeat of the last entry isn't logged again).
- **What it wants:** each goal's score as it last weighed them — the real
  decision it acted on, or its 1.5-second check while busy, not a fresh
  calculation (that would draw on its random stream and change what it does).
  The chosen goal is marked; an impossible one says why instead of showing a
  score; picking one lists its factors. When it would now choose something
  else but is keeping to its goal, it says so.
- **Try it:** the season and a downpour (this scene's own game: a winter
  scene's growth really withers), the selected one's nature (its own, curious,
  balanced, cautious), and its energy and curiosity. Comfort isn't set by hand:
  it follows the place.
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
| `mind.ts` | Needs, nature, conditions; what a place offers (cover, comfort, lookout); scoring the goals |
| `agent.ts` | The inhabitant and its state machine (`TRANSITIONS`); coats; sending; finding its feet after a rebuild |
| `inhabitantMesh.ts` | The model, its animations, and the view that places and animates many |
| `population.ts` | Play's and the Lab's: when to rebuild the graph, when inhabitants arrive |
| `visibility.ts` | Show Inhabitants: the shared, stored display preference |
| `scenarios.ts` | The studio's scenes and their runner |
| `StateGraph.tsx`, `MindPanel.tsx` | The studio's state machine drawing, and its goal, needs, utilities and history |
| `StudioViewport.tsx`, `InhabitantsPage.tsx`, `inhabitants.css` | The studio |

Elsewhere: `BuildViewport` takes `inhabitants`; `WorldMenu` takes `display`
options; `architecture/specimens.ts` exports `recipeGame`, which `grow` now
uses too.

## Measured

**Decisions** (`tests/inhabitants.test.ts`, real scenes, by what they do):
- *Natures differ.* One inhabitant alone in the Exploring scene, three runs of
  150 s each:

  | Nature | Exploring | Observing | Places known | Walked |
  | --- | --- | --- | --- | --- |
  | Curious (0.9, cautious 0.1) | 47% | 7% | 43 | 207 units |
  | Balanced (0.5, 0.5) | 18% | 26% | 33 | 147 units |
  | Cautious (0.25, 0.9) | 0% | 38% | 29 | 121 units |

- *A new bridge:* from maturing to being on it, a curious one took 10.8–14.3 s
  over three runs; a cautious one never went, in all three.
- *Shelter:* in the Shelter scene's downpour, open ground feels 0.46; two of
  three went under the canopy within 5 s and the third at 25 s, to cells of
  cover 1.0 and comfort 1.0; they stayed while it poured, and left when it
  stopped ("the weather has cleared").
- *No shelter in reach* (two bare buildings, autumn, a downpour): seek shelter
  isn't possible, it says why, and they carry on with something else — at
  least three changes of state each in 60 s, none stuck.
- *Unreachable:* over 120 s in No way across, every place either set out for
  was in its own region.
- *Dieback:* 45 s of winter growth took the tower from 1,758 walkable cells to
  1,104; routes failed under them and they replanned; none ever stood on a
  cell that wasn't walkable.
- *Paused,* nothing changes; *reloaded,* a world's inhabitants have the same
  natures.
- *Every change of state* in every scene was in the table.
- **Cost:** a decision takes about 0.03 ms; it is made only when idle, or every
  1.5 s while resting or walking — not every frame.

**From before:**

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

- **A cautious nature never explores** in the Exploring scene: its pull to the
  new is small enough that observing and resting always win. It does move —
  between lookouts and resting places it knows — but a little more range at
  the cautious end would be truer to "tends to stay in familiar places".
- **Winter is mostly rest** (82% of their time where routes hold) — perhaps
  more than it should be; the balance came from tuning against what was seen,
  not from a target.
- **Places are judged by straight-line distance** when choosing; only the
  winner is routed, so a nearby place reached by a long way round can win.
- **Cover is approximate:** horizontal surfaces above, within half a unit. It
  doesn't know about walls beside it (a corner is no more sheltered than a
  wall), and a pod's enclosure is a stated bonus, not measured.
- **Needs restart on load** (above).

## Not built yet

Ideas, not features: inhabitants that seek each other out (their sociability
is stored for this, and nothing uses it yet), that favour particular plants,
that help seed new growth, or that a player can send in Play. No hunger,
jobs, dialogue or relationships.
