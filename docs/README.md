# Study notebook

Jessica Hsiao · Procedural World Building

The write-ups for the course, organised by what each document *is* rather than
by when it was written. Start at the [root README](../README.md) for the
project itself; this page indexes everything below `docs/`.

## Contents

- [Topics](#topics) — one chapter per body of work
- [Analysis](#analysis) — measurement and comparison reports
- [Project](#project) — infrastructure and setup
- [Images](#images)
- [How this is organised](#how-this-is-organised)

## Topics

One chapter per topic, in course order. Each opens with what the page does,
then works through the mechanism, and closes with a `## Notes` section holding
the decisions — including the ones that turned out to be wrong.

| Chapter | What it covers |
| --- | --- |
| [Topic 1 — Objects](topics/topic-1-objects.md) | The render loop and the material model. Five primitives swapped in place, orientation stored as a quaternion so the gizmo never gimbal-locks, and image-based lighting from a `RoomEnvironment` cubemap generated at runtime rather than loaded from an HDR file. |
| [Topic 2 — Maps](topics/topic-2-maps.md) | The longest chapter, in two views. The **Lab**: white, Perlin and cellular noise, shaped and warped and masked, shown as a map beside the terrain it makes with the pseudocode written out — plus why ridged folds each octave rather than the sum, the measured range loss that makes it normalise, and eight presets as recipes. The **Workbench**: a value-noise field composited from layers, then warped, run through a cellular automaton, and carved by droplet hydraulic erosion — plus colour ramps interpolated in OKLab and three ways to turn a field into geometry. Includes the structure-function measurements that set the default six-octave stack. |
| [Topic 3 — Voxels](topics/topic-3-voxels.md) | Solids as signed-distance functions instead of stored grids, combined with CSG, and turned back into triangles four different ways. Covers which primitives return true Euclidean distance and why that matters for blending. |
| [Topic 4 — Shaders](topics/topic-4-shaders.md) | A surface-shading study — one eroded terrain drawn by eight fragment shaders, including animated water and a stylized contour map, holding geometry, light and camera fixed so the strategies can be compared — plus four interactive GPU simulations: ripples, reaction–diffusion, hydraulic erosion and fish schooling. Covers the page's two visual registers — both matte, both dark — what actually made the first attempt read as wet plastic, and the two extra rules a dark ground imposes on a lighting model, a measured stability threshold, a measured mass-conservation result, and the bugs that cost the most to find. |
| [Topic 5 — Distributions](topics/topic-5-distributions.md) | A scattering study: trees, bushes and rocks placed by per-layer rules over a small eroded terrain. Each rule is a product of soft factors — elevation band, slope window, water preference, cluster noise, and for rocks a "vegetation is sparse" term — and a hover probe prints every factor at the point under the pointer. Covers jittered-grid candidates and per-layer seeded streams, instanced rendering, terrain-driven variation, the measurement that set the relief, and the layer coupling that turned out to come from placement order rather than probability. |
| [Topic 6 — Paths](topics/topic-6-paths.md) | A spline study: up to four roads and four rivers on one terrain, built from the same 2D curve and opposite in who gives way, meeting as junctions, causeways and tributaries. The road is projected onto the ground, smoothed into a grade, and the corridor is cut and filled to meet it; the river is traced downhill from a source, held to a water surface that only descends, and only ever cuts. Covers centripetal Catmull–Rom at even arc length, the corridor stamp, the grade-smoothing trade (73% → 15% for 2.5× the earth moved), the measured switch in river behaviour between terrain influence 0.5 and 0.6, the debug view that draws the projection literally, and two drag bugs that only appeared on a loaded machine. |
| [Topic 7 — Vector Fields](topics/topic-7-vector-fields.md) | A particle study: eighteen thousand particles advected through one 2D velocity field — a current, Gaussian-profile vortices, curl noise, and drag-to-stir dipoles — with trails accumulated in a half-float buffer. Covers why every term is divergence-free and the numerical check that confirms it, the measurement for the midpoint method (Euler drifts a vortex orbit outward 78% in ten seconds), frame-rate-independent persistence, the arrow overlay and draggable vortices, and a cutoff that read as divergence until it was moved. |

## Analysis

Reports that outgrew the chapter they belong to. Every figure in them was
produced by running the project's own code over its own scenes.

| Report | What it covers |
| --- | --- |
| [Energy and idle cost](analysis/energy-and-idle-cost.md) | Where the app's power actually goes. How idle cost was found and removed, what the browser already handles, and the measurement showing the display pass — not the simulation — is the expensive part for three of the four GPU studies. Includes two findings that reversed an assumption: lowering the pixel ratio buys frame rate rather than energy, and fragment area is the wrong proxy for an O(N²) simulation. Belongs to [Topic 4](topics/topic-4-shaders.md). |
| [Meshing, size, and chunking](analysis/topic-3-meshing-and-chunking.md) | A comparison of the five meshing techniques on one axis — where a vertex is allowed to be — followed by where the approach stops scaling and why chunking is the answer. Belongs to [Topic 3](topics/topic-3-voxels.md). |

## Project

Infrastructure rather than course material: things the app needs in order to
run, or that were investigated before being built.

| Document | What it covers |
| --- | --- |
| [Explorable worlds](project/explorable-worlds.md) | Three worlds you can fly around in, generated from one system with no per-world code path. Chunked terrain from a hashed height function, scatter that answers to the ground, and the measurements behind it — including two waterlines that were below every point in their world, two spawn headings that faced backwards, and a chunk build that cost a dropped frame a second until the normals stopped asking the height function five times per vertex. Now also macro topography — mountains far from the river, a damped corridor near it — and the coarse backdrop that gives them somewhere to stand, since the chunk ring ends 400 units out. |
| [Showcase worlds](project/showcase-worlds.md) | Five saved worlds that demonstrate what the four topics can do, each leading with a different mechanism rather than a different palette — with the measurements showing they differ structurally, how they were seeded into an account without weakening the security rules, and the three things the topics genuinely cannot express. |
| [The visual system](project/visual-system.md) | The design tokens, and the line between application chrome and visualization. Why the interface is neutral and the worlds are not, what desaturating the default colour ramp cost in measured resolving power, why the text scale is three greys rather than four, and the typography fix behind a navigation row that was rendering in Times. |
| [Playground and Project](project/app-structure.md) | How the app splits into two top-level sections, why the project is not a numbered topic, and why the navigation was written rather than installed — including the measurement that decided against React Router. Covers the three Project pages (Overview as a board of the three worlds and their references, Explore, Progress as each topic's real contribution), why the Demo page was retired, and the bugs that were invisible in the code.
| [Firebase setup](project/firebase-setup.md) | How to configure sign-in, what a saved configuration stores and why it is parameters rather than geometry, and the decisions behind the integration — why popup rather than redirect, why loaded documents are treated as untrusted, why Storage is written but switched off, and how a missing `.env` is made harmless. |
| [Firebase integration report](project/firebase-integration-report.md) | The survey written *before* the integration: a walk through the codebase, what state each page holds, what could be persisted, a proposed data model, and the problems ranked by priority. Kept as the record of the plan the work was measured against. |

## Images

[`images/`](images/) holds every screenshot used above. They are captured by
driving the running app in a headless browser and clipping to the element in
question, not by posing a mock-up — so a figure and the numbers printed
beside it come from the same run.

Names say where an image is used: `readme-*` for the root README's per-topic
hero shots, `readme-project-*` for the Project area's pages (reference images for the worlds live in `public/inspiration/`, not here — they are not captured from the app), `topic-N-*` for
figures inside a chapter, and `project-*` for the project documents.

## How this is organised

Four categories, each holding at least one document — no folder exists to fill
out a template.

```
docs/
├── README.md     this index
├── topics/       one chapter per topic
├── analysis/     measurement and comparison reports
├── project/      infrastructure and setup
└── images/       screenshots, captured from the running app
```

The split that matters is **topics** against **analysis**. A chapter explains
how a thing works and is meant to be read start to finish; a report answers one
question with numbers and is meant to be cited. Topic 3's meshing report was
separated out for exactly that reason — it compares five techniques that the
chapter only has to implement four of.

**Algorithms are not their own folder.** The obvious alternative was to file by
subject — `algorithms/`, `data-structures/` — but the algorithm material here
(fBm, cellular automata, droplet erosion, marching cubes, dual contouring) is
not written as standalone pieces. It is woven into the chapter that motivates
it, and cutting a chapter into folder-sized fragments would make it harder to
study from, not easier. If a subject ever does outgrow its chapter, it becomes
a report in `analysis/`, which is what that folder is for.
