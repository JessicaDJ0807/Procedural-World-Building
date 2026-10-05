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
| [Topic 2 — Maps](topics/topic-2-maps.md) | The longest chapter. A value-noise field composited from layers, then warped, run through a cellular automaton, and carved by droplet hydraulic erosion — plus colour ramps interpolated in OKLab and three ways to turn a field into geometry. Includes the structure-function measurements that set the default six-octave stack. |
| [Topic 3 — Voxels](topics/topic-3-voxels.md) | Solids as signed-distance functions instead of stored grids, combined with CSG, and turned back into triangles four different ways. Covers which primitives return true Euclidean distance and why that matters for blending. |
| [Topic 4 — Shaders](topics/topic-4-shaders.md) | A surface-shading study — one eroded terrain drawn by six fragment shaders, holding geometry, light and camera fixed so the strategies can be compared — plus four interactive GPU simulations: ripples, reaction–diffusion, hydraulic erosion and fish schooling. Covers the page's two visual registers — both matte, both dark — what actually made the first attempt read as wet plastic, and the two extra rules a dark ground imposes on a lighting model, a measured stability threshold, a measured mass-conservation result, and the bugs that cost the most to find. |

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
| [Firebase setup](project/firebase-setup.md) | How to configure sign-in, what a saved configuration stores and why it is parameters rather than geometry, and the decisions behind the integration — why popup rather than redirect, why loaded documents are treated as untrusted, why Storage is written but switched off, and how a missing `.env` is made harmless. |
| [Firebase integration report](project/firebase-integration-report.md) | The survey written *before* the integration: a walk through the codebase, what state each page holds, what could be persisted, a proposed data model, and the problems ranked by priority. Kept as the record of the plan the work was measured against. |

## Images

[`images/`](images/) holds every screenshot used above. They are captured by
driving the running app in a headless browser and clipping to the element in
question, not by posing a mock-up — so a figure and the numbers printed
beside it come from the same run.

Names say where an image is used: `readme-*` for the root README's per-topic
hero shots, `topic-N-*` for figures inside a chapter, `project-*` for the
project documents.

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
