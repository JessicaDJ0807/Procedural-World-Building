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
with a question behind it. It is currently [Green Architecture](green-architecture.md):
vegetation growing over a building, steered by sunlight, moisture and the
building's own geometry.

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
Topic 1 Objects   Topic 2 Maps   Topic 3 Voxels   Topic 4 Shaders   …   Topic 7 Vector Fields
```

The section row is a pill group — weight and a filled background, because these
are destinations rather than tabs. The second row is tabs with an underline,
which is what it was before. Switching section never shows both sets at once.

| Path | Page |
| --- | --- |
| `/` | Project Overview |
| `/project` | Project Overview |
| `/project/explore` | Project Explore |
| `/project/progress` | Project Progress |
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

Three pages, each with one job:

| Page | Job |
| --- | --- |
| Overview | The concept: the idea, the question, and the system as a flow |
| Explore | The experiment: the growth simulation, with its fields on view |
| Progress | The process: the pipeline, one rule at a time, and the decisions |

### Overview

`ProjectLayout`'s wide variant. It opens in the first person with the idea and
then the one question the project answers, set apart under the lede. Below it,
two figures of the **same run** — the building, and which species holds each
cell — so "the environment sorts the plants" is shown before it is described. Then the
system as a flow (geometry + sunlight + moisture → growth rules → spread over
time → the building changes), what I want to explore, the current scope, and
future directions under a heading tagged *Not built*.

### Explore

The one Project page that is driven. It reuses the Workspace's own classes —
canvas and inspector, no library column — so focus mode (H) and the View
popover behave exactly as on a topic. See
[Green Architecture](green-architecture.md) for what it simulates.

### Progress

The pipeline as six cards, then five experiments that each add one rule to the
model (ivy alone), then the three species and the walls they took, then the four
presets side by side, then the decisions with their reasons. Every figure was captured from Explore with the settings named under
it, and each experiment's numbers were measured on the same run. Figures that
do not exist yet render as a dashed *Screenshot to add* slot rather than as a
stand-in image.

![The Explore page from the Corner view: flowering vine on the sunlit fronts and the roofs, ivy in the shadow of the inside corner, moss on the wing's west wall, with the growth and species controls on the right](../images/readme-project-explore.jpg)

## Earlier Project directions

The Project has changed direction twice. Both earlier versions are in the git
history rather than in the tree — nothing is kept hidden "for reference".

**Three worlds** (Volcanic Caldera, Frozen Archipelago, Verdant Valley): one
chunked terrain generator, three specs, walkable in the browser. Retired when
the project pivoted to Green Architecture; its last state is on `main` before
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
