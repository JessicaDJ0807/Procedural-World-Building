# Playground and Project

Jessica Hsiao · Procedural World Building

How the app is divided, why it is divided that way, and why the navigation that
holds the two halves apart was written rather than installed.

## Contents

- [Two experiences, not seven pages](#two-experiences-not-seven-pages)
- [Navigation](#navigation)
- [Why no router](#why-no-router)
- [What the Project pages are](#what-the-project-pages-are)
- [Earlier Project directions](#earlier-project-directions)
- [Notes](#notes)

## Two experiences, not seven pages

The app has two top-level destinations.

**Playground** holds the topics. Each one takes a single technique apart
and exposes every parameter it has, because on those pages the parameter space
*is* the subject — you cannot learn what carry capacity does without being able
to set it somewhere destructive.

**Project** is where the techniques are put back together into one system
with a question behind it. It is currently **Wildform**: a procedural building
game where the player builds the starting architecture, plants growth
behaviors and sets the environment, and plants grow living architecture the
player does not directly design.

The two want opposite things from a user interface. A Playground topic is dense
on purpose: every pixel within reach of the viewport is worth a control. The
Project pages are read rather than driven, so they get a measured column,
generous margins, and type large enough to present from. Putting them at the
same navigation level would have implied they were the same kind of thing.

**The project is not a topic.** Topics are bodies of coursework and they are
numbered; the project cuts across all of them and is numbered by nothing. It
gets its own section rather than a fifth tab.

## Navigation

Two rows in the header:

```
Procedural World Building    [ Playground | Project ]              [ auth ]
──────────────────────────────────────────────────────────────────────────
Topic 1 Objects   Topic 2 Maps   Topic 3 Voxels   Topic 4 Shaders   …   Topic 8 Branching
```

The section row is a pill group — weight and a filled background, because these
are destinations rather than tabs. The second row is tabs with an underline,
which is what it was before. Switching section never shows both sets at once.

| Path | Page |
| --- | --- |
| `/` | Project Overview |
| `/project` | Project Overview |
| `/project/explore` | Project Explore — archived, out of the tabs |
| `/project/build` | Project Build |
| `/project/site` | Project Site |
| `/project/progress` | Project Progress |
| `/project/decisions` | Project Decisions |
| `/playground/objects` | Topic 1 |
| `/playground/maps` | Topic 2 |
| `/playground/voxels` | Topic 3 |
| `/playground/shaders` | Topic 4 |

Anything unrecognised falls back rather than erroring: an unknown project page
lands on Overview, an unknown topic on the newest one, and anything else on `/`.
The address bar is corrected to the page shown, with `replaceState` so Back
does not return to the dead path — which is what `/project/demo` does now that
the Demo page is gone.

Entering a section always lands on its own front door — Playground on its newest
topic, the Project on Overview. Neither remembers where you were last, because a
button that leads somewhere different depending on history is worse than one
that is predictable.

## Why no router

`react-router-dom` 7.18.4 was measured rather than argued about. Bundling only
the seven exports this app would have used, minified, with React external:

| | bytes | gzipped |
| --- | --- | --- |
| App bundle before this change | 1,507,580 | 425,492 |
| `react-router-dom` on top of it | +42,538 (+2.8%) | +15,235 (+3.6%) |

3.6% would not have settled it either way. What settled it was utilisation.
Seven static destinations, no route parameters, no nested data loading, no
loaders or actions, no code splitting, no scroll restoration — the library's
whole value is in the cases this app does not have. Against that, the repo runs
on four runtime dependencies deliberately, and `src/routes.ts` does the job in
about forty lines that a reader of this notebook can follow end to end.

The History API carries it: `pushState` on navigate, a `popstate` listener for
back and forward. The two halves do not fight because `pushState` never fires
`popstate` — the setter updates both the address and the state, the listener
updates only the state. A push to the address already shown is dropped, so
clicking the active tab does not stack duplicate history entries to walk back
through.

Firebase Hosting already rewrote `**` to `/index.html`, so deep links work on
the deployed site with no configuration change. That was in place for the SPA
before any of these URLs existed.

If this ever grows route parameters or per-route data loading, that is the point
to reconsider — and swapping a library in would touch one file.

## What the Project pages are

Six tabs, in the order a reviewer should read them:

| Page | Question it answers |
| --- | --- |
| Overview | What is Wildform? |
| Build | Can I play with the core system? — the main prototype |
| Architecture | What does the system grow? — an atlas of the five structures |
| Site | How does the same idea scale to a real place? |
| Progress | How did the project evolve? |
| Decisions | Why were these design choices made? |

The rule that keeps them coherent: **current pages describe the current
direction; Progress holds the history; Decisions holds the reasoning behind
the pivots.** Earlier text that is still true but no longer current — the
phase-02 growth experiments, the growth-model decisions — moved down those two
pages under its own heading rather than being deleted.

### Overview

`ProjectLayout`'s wide variant. The title, *Wildform*, and the tagline — *grow
architecture by shaping how plants behave* — then the longer description and
the principle (*the player controls the conditions, but not the exact final
form*), with buttons to Build, the Site and Decisions. Then a hero capture
from Build, the loop as a chain (build → plant → grow → interact → mutate →
adapt), the growth behaviors as four cards (Climber, Spreader, Draper, and
Layered — dashed, as a derived state rather than a species), living
architecture with a close-up, the current challenge, campus scale, and future
environments under a heading tagged *Not built*.

### Build

The main playable prototype: a lawn with two buildings to join, a budget of
blocks placed Townscaper-style, Climber, Spreader and Draper to plant, and
living architecture growing where they meet. Building and growing are one
loop. A one-line goal card greets a first visit, top left of the scene, and
stays dismissed per browser. See [Build](build.md).

### Architecture

`ProjectLayout`'s wide variant with a pale studio viewport as its centre: five
structures in two or three variations each, every specimen a real Build game
grown until the structure formed, with a formation timeline and Material,
Structure and Growth views. See [Living Architecture](architecture.md).

### Site

*Wildform at campus scale*, on the same workspace shell as Build. Roosevelt
Island from a saved snapshot of NYC Open Data, the Cornell Tech buildings cut
into cells with procedural façades, lit by the real sun through a simulated
year. The sidebar follows Build's order — an intro, the study, plant
behavior, environment, growth — and then the campus readouts. Its plants are
the three species of the growth model Wildform grew from, so the intro says
so: Build's behaviors and living architecture are not on the campus yet. What
stands between them is written down in [Roosevelt Island](roosevelt-island.md#wildform-at-campus-scale).

### Progress

A timeline of four phases — 01 Procedural Foundations, 02 Site Simulation,
03 Living Architecture, 04 Wildform — each with what it tried, figures from
the app, and the lesson that set up the next (the current phase ends on the
design question instead). No dates: the phases don't line up with weeks.
Below it, *Phase 02 in detail*: the pipeline, the five one-rule experiments,
the three species, the presets and the decisions, as measured at the time.

### Decisions

Six design decisions, for critique, as cards with **question**, **decision**
(or earlier version → problem → current direction), **why**, and where it is
still open, **to discuss**: simulation → gameplay, unlimited → constrained
building, conditions not outcomes, the plant-behavior vocabulary, generic
balcony → living mutations, and a lawn baseline with future environments
(tagged *Not built*). Below, *The growth model underneath*: the five
phase-02 decisions with their rules, evidence and open questions, and the
table of numbers chosen rather than measured.

### Explore (archived)

The midterm prototype — a Climber and a Spreader on the invented building,
growing one Living Platform — is out of the tabs but not deleted. Its address
still works, linked from Progress's phase 03, under a banner that says what it
is and points to Build. It is the one exception to keeping earlier directions
in the history only: its simulation (`src/wildform/`) is the one Build runs,
and the page is the midterm's record. See [Wildform midterm](wildform.md).

## Earlier Project directions

The Project has changed direction twice. Both earlier versions are in the git
history rather than in the tree — nothing is kept hidden "for reference", with the one exception of the archived Explore above.

**Three worlds** (Volcanic Caldera, Frozen Archipelago, Verdant Valley): one
chunked terrain generator, three specs, walkable in the browser. Retired when
the project pivoted to plants growing over buildings (then titled Green Architecture, later Overgrowth, now Wildform); its last state is on `main` before
the pivot, and the watershed simulation that was in progress on top of it is
on the `verdant-watershed` branch. The hashed value noise it introduced is
still used by Topics 5–7 and moved to `src/hashNoise.ts`; the tree and rock
geometry moved to `src/distributions/props.ts`.

### The Demo page

There was a fourth Project page, Demo: Topic 2's droplet erosion and Topic 3's
CSG caves composed on one 128² heightfield, with nine controls and built-in
scenarios. It was the first place two topics had to agree on the same data, and
it is in the git history.

It was removed — before the three worlds were — because Explore became the interactive experience and the two
told different stories — Demo a single eroded tile, Explore three streamed
worlds that cannot use droplet erosion at all, since droplets need the whole
grid and chunks cannot see their neighbours. Two interactive pages with two
terrain systems made the project harder to explain, not easier. Its two
generators, `world.ts` and `useWorld.ts`, had no other caller and went with it.
What it proved — that the heightfield can be read as a distance field and cut
with CSG — still holds.

## Notes

*The first note is from the three-worlds Overview.*

**Two stylesheets both owned `.world-name`.** The Overview's world titles
rendered at 13px instead of 22: the Playground's saved-worlds library in
`App.css` already styles `.world-name`, loads globally, and won the cascade.
Nothing failed — the page simply looked wrong, and it was found by reading the
computed style in the browser. The lesson outlived the page: Project classes
are prefixed (`project-`, `flow-`, `experiment-`) so they cannot collide with
the Playground's global ones.

*The notes below are about the retired Demo page and the earlier Overview hero
that ran its generator. They are kept because the findings outlived the pages.*

**The hero mounted at 814×0 and nothing said so.** `.noise-viewport` sizes
itself with `flex: 1` because in the Playground it is always a flex child; in
the Overview's plain block wrapper it had no height at all. Typecheck, lint and
build were all clean, and the page rendered a correctly-styled empty panel.
Caught by screenshotting the page and looking at it, which is the whole reason
that step is in `CLAUDE.md`.

**The cave solid came out entirely deep blue.** The two viewports index the
colour ramp by different quantities: `NoiseViewport` by the field's value, which
lives in roughly `[0, 1]`, and `VoxelViewport` by a vertex's world-space Y, which
lives in `[-1.3, 1.3]` — on a finished isosurface the density is zero everywhere
by construction, so height is the only signal left in the geometry. A ramp
fitted to the field put every vertex below its floor, so the whole solid clamped
to the terrain palette's deepest stop and the tunnels were invisible inside it.
Two domains, fitted separately.

**The gyroid's gaps are subtracted, not its walls.** A gyroid's walls are the
solid part, so subtracting them leaves two interlocking halves rather than a
cave system. Subtracting the gaps leaves a connected network — which is why the
cave density control moves the gyroid's wall *thickness* rather than its scale.
Scale would change how many tunnels there are, rescaling the whole network, and
the dial would read as zoom instead of as more cave.

**The heightfield SDF is not a true distance field.** `y − terrain(x, z)` returns
a vertical gap, not the shortest distance to the surface, so it reads short on a
steep slope — the same inexactness `density.ts` flags on its own `terrain`
primitive. That is why the tunnel subtraction is a hard boolean: a smooth blend
assumes a unit gradient and bites unevenly where that fails.

**Sea level raises the floor rather than recolouring it.** Painting the low
ground blue leaves it bumpy, and a lake with a textured surface reads as wet
ground rather than as water. Clamping everything below the waterline to one
height makes it flat, which is the whole visual signal — and the terrain
palette's lowest stops are already the two blues, so the colour follows for
free.

**`/` lands on the Project, not on a topic.** The app has a front door now, and
"what am I building" is the right thing behind it; a visitor following a bare
link should not arrive in the middle of a shader study. It is one constant,
`HOME` in `src/routes.ts`, if that should ever be a topic instead.
