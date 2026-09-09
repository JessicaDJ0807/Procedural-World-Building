# Procedural World Building

Coursework for a weekly design course, built with React, TypeScript, and
Three.js. Each week's work lives on its own page behind a nav shell, so the app
accumulates as the course goes rather than replacing what came before.

| | Week | Page |
| --- | --- | --- |
| 1 | 3D Objects | A real-time WebGL object viewer with material and orientation controls |
| 2 | Noise | A layered noise stack, smoothed by a cellular automaton, carved by hydraulic erosion, and graphed as 3D geometry |

## Week 1 — 3D Objects

- **Shape switching** — cube, sphere, torus, icosahedron, and torus knot,
  swapped in place without rebuilding the scene.
- **Orientation gizmo** — a draggable mini-cube with labelled X/Y/Z axes.
  Orientation is stored as a quaternion so the object tumbles freely without
  gimbal lock.
- **Material controls** — colour, metalness, roughness, and wireframe, lit by a
  `RoomEnvironment` image-based light so metallic surfaces have something real
  to reflect.
- **Transform** — auto-spin (degrees/second) layered on top of the gizmo
  orientation, plus uniform scale.
- **Orbit camera** — click and drag the main canvas to orbit the view.

## Week 2 — Noise

Every cell holds a value in `[0, 1]`, built from a stack of noise layers. The
composited map drives geometry in the centre viewport; the map itself sits in
the sidebar as the source you inspect and tune.

Drag to orbit, scroll to zoom, right-drag to pan.

It opens on a six-octave fBm stack at 128², height 1.4, with the automaton off
and the erosion preset on Gorges — the configuration that measures closest to
real topography (see [Building an fBm stack](#building-an-fbm-stack)). Press
**Rain** to erode it.

### Geometry modes

| Mode | What it draws |
| --- | --- |
| **Height field** | The map as a graph — one vertex per cell, raised to its value and welded into a continuous surface. A **Height** slider scales the relief. |
| **Volumetric cloud** | True 3D noise, one point per cell. The sidebar map shows a single z-slice, moved with the **Slice** slider. |
| **Planet** | A sphere whose every vertex is displaced by the 3D field sampled at its own position. A **Relief** slider scales the displacement. |

#### Why the planet samples the volume

The obvious way to put noise on a sphere is to wrap the 2D map around it as a
texture. That gives a visible seam where the map wraps and pinching at both
poles, because an equirectangular grid crowds without limit as it approaches
them. Sampling the **volumetric** field at each vertex's own position in space
avoids the problem rather than working around it: there is no parameterisation,
so there is no seam and no poles, and detail stays even everywhere.

It also gives the volumetric field a second job — the same buffer the point
cloud draws is what the planet is carved from.

### Colour

A single **Colour** picker tints both the sidebar map and the 3D geometry — they
show the same field, so a second colour would only let them disagree. The cell
value scales the chosen colour, so 1 is the colour itself and 0 is black; the
greyscale ramp is just what white gives you. It defaults to `#6ea8fe`, the same
blue Week 1's material starts on, shared as `ACCENT_BLUE` in `theme.ts` rather
than written out twice.

### Inspecting

Click or drag on the sidebar map to select a cell. Its exact value is reported
below the map, the cell is outlined there, and a marker appears at the matching
point on the 3D geometry — on the surface at that vertex's height, or at the
cell's centre in the volume.

Clicking the selected cell again clears the selection. A click that deselects
also suppresses the drag that would otherwise follow, so the pointer sitting on
the cleared cell cannot immediately reselect it.

### Layers

Each layer samples its own field and composites onto the running result,
bottom-up. A layer carries:

| Control | Effect |
| --- | --- |
| Frequency | Lattice cells per side, interpolated up to the display resolution |
| Spread (σ) | Standard deviation of that layer's distribution (mean is 0.5) |
| Blend | How it combines with the layers beneath it |
| Opacity | How much of the blend result is kept |
| Shaping | A remap applied to this layer before blending |

Blend modes: Normal, Add, Subtract, Multiply, Screen, Overlay, Difference,
Lighten, Darken. Layers can be reordered, disabled, reseeded, and removed;
order matters for every mode except the commutative ones.

#### Building an fBm stack

The page opens on six octaves — frequency doubling from f2 to f64, amplitude
halving — rather than the two layers it started with, and **Octaves**,
**Persistence** and **Rebuild as fBm stack** regenerate that stack from scratch.

Why it matters is measurable. A surface reads as terrain when its structure
function `S(d) = mean (h(x+d) − h(x))²` is a straight line on a log-log plot:
the same roughness at every scale. The slope gives the Hurst exponent H, and
real topography sits at H ≈ 0.5–0.8 with R² above 0.99.

| stack | H | straightness R² |
| --- | --- | --- |
| two layers, f4 + f16 | 0.67 | 0.960 |
| **six octaves, f2–f64** | 0.75 | **0.990** |
| six octaves + Gorges erosion | 0.73 | **0.996** |

The old pair was never too rough — H was already in range. It had content at f4
and f16 and a hole between them, and the eye reads that hole as randomness.

**Persistence is the roughness dial**, and the only one worth tuning by eye:

| persistence | H | R² | reads as |
| --- | --- | --- | --- |
| 0.30 | 0.93 | 0.998 | smooth, rolling |
| 0.50 | 0.75 | 0.990 | balanced (default) |
| 0.65 | 0.57 | 0.975 | craggy |
| 0.80 | 0.43 | 0.941 | out of the realistic band |

The opacities the builder writes — 1, 0.33, 0.14, 0.07, 0.03, 0.02 — look
arbitrary but are forced. Normal blend is a **lerp, not a sum**, so a layer's
weight in the finished field is its own opacity times ∏(1 − opacity) over every
layer above it; hitting halving weights means inverting that chain from the top
down. With the bottom layer opaque the weights telescope to exactly 1, which is
what keeps the composite's mean at 0.5 instead of drifting toward black.

Octave seeds are the octave index rather than a running counter, so rebuilding
at a different persistence redraws the *same* terrain at a different roughness
instead of an unrelated one — which is the only way the dial is readable.

One cost worth knowing: averaging six octaves shrinks the variance, so the
stack's relief is about 0.44 against the old pair's 0.71. Raising spread has
diminishing returns (0.3 → 0.31, 0.6 → 0.44, 0.8 → 0.49, no clipping at any of
them), so the default compensates with the **Height** slider instead — display
scaling costs nothing and never pushes values into a clamp.

**Frequency is what makes a stack worth having.** Blending independent fields
at the same frequency is a dead end — a sum of Gaussians is just another
Gaussian, so the stack would look like one noisier layer. A coarse lattice
interpolated up, sitting under a fine one, is the octave stacking that fractal
noise is built from. At frequency 4 the field is smooth blobs; at frequency
equal to the resolution it degenerates back to per-cell white noise.

The stack starts from 0 and the bottom layer blends against it like any other,
rather than being special-cased. That keeps the model predictable, but it does
mean a bottom layer set to Multiply yields nothing — exactly as it would in an
image editor.

### Automata

A cellular automaton runs between the layer stack and the output shaping. Where
the shaping operations are per-cell — `f(x)` — this is `f(x, neighbours)`
applied repeatedly, and it is what turns speckled noise into connected
landmasses and caves.

Each pass thresholds the field to a live/dead mask, then sets a cell live when
at least **Survive at** of the cells in its block are live. The block is the
whole 3×3 (or 3×3×3) neighbourhood, **the centre included** — counting only the
8 surrounding cells looks like the same rule but is not: with no vote of its
own a cell cannot hold its state, and the field erodes away instead of settling.

| Control | Effect |
| --- | --- |
| Alive above | Value at or above which a cell starts live |
| Survive at | Live cells needed in the block, out of 9 in 2D or 27 in 3D |
| Play / Step / Reset | Advance one generation at a time, or watch it run |

Generation 0 leaves the field untouched, so the automaton is genuinely off until
stepped. Live cells keep their original value and dead cells go to 0, so land
holds its noise detail while the sea goes flat — islands with terrain, rather
than a binary plateau. On a planet, that reads as continents against ocean.

#### The run stops when it is actually finished

Each pass counts the cells it flipped, and a pass that flips none is a fixed
point: every later pass is identical to it. Play stops there and the readout
names the generation it reached. Running past that point would tick a counter
against a frozen picture, which reads as the controls being broken.

How long that takes depends entirely on the dimensionality. On the default
stack, 2D settles at generation 4 at 64² and 8 at 128², while 3D at 32³ needs
**42** — a 27-cell block has far more ways to stay balanced, so the boundary
keeps rearranging long after it looks finished. A rougher stack takes longer
still: the earlier two-layer default needed 82 passes in 3D, which is what the
cap of 96 was sized for. If a rule does reach the cap the readout says so and
reports how many cells were still flipping, rather than claiming the field had
settled.

#### Dead-end rules say so

Large parts of the parameter space are silent no-ops that the picture cannot
show, so the readout reports them directly:

| Setting | What happens | Readout |
| --- | --- | --- |
| Alive above under the field's minimum, or Survive at 1 | Every cell is alive, so no cell can flip | *no cells changed* |
| Alive above over the field's maximum | Everything dies and the geometry vanishes | *every cell died* |

Where those boundaries fall depends on the field rather than being fixed
numbers. The default stack spans 0.33–0.77, so Alive above is inert below ~0.33
and wipes out over ~0.78; a stack whose values reach the ends of `[0, 1]` leaves
almost no inert region at all. Survive at behaves the same way — on a smooth
stack even 9 of 9 leaves plenty alive, because a cell surrounded by nine live
neighbours is common.

Without this, pressing Play in either region does nothing visible and looks like
a broken button rather than a rule with no work to do.

Each generation is recomputed from the composite rather than mutated in place,
so the generation count is just a number: editing a layer mid-run stays
consistent instead of leaving a stale automaton behind. The cost is that a run
is O(generations) per render — twelve passes take about 1 ms at 128² and 25 ms
at 32³, and the full 42-pass 3D run about 90 ms, so the tail of a 3D playback is
visibly slower than its start.

On the default stack at 64² the coastline perimeter falls about 11% and then
stops changing. The effect is milder than it looks on paper because an fBm stack
thresholds into a single connected landmass to begin with; on a speckled
two-layer stack the same rule merged four separate fragments into one and cut
the perimeter by 21%. Smoothing has more to do when there is more to smooth.

### Erosion

Droplet-based hydraulic erosion, run over the height field between the automaton
and the output shaping. Each droplet lands at random, follows the downhill
gradient, and trades material with the terrain: it cuts where it runs fast down
a steep slope and drops its load where it slows or climbs. Thousands of them
carve the dendritic valley networks that noise alone never produces.

| Control | Effect |
| --- | --- |
| Preset | A measured starting point; nudging any slider below switches it to Custom |
| Rain per tick | Droplets **per cell**, with the resulting count shown beside it |
| Erosion rate | Fraction of the shortfall a droplet cuts per step |
| Carry capacity | Sediment a droplet can hold per unit of slope and speed |
| Deposition | Fraction of the excess it drops once over capacity |
| Inertia | How much of its previous direction it keeps; 0 is pure gradient descent |
| Gravity | Converts drop in height into speed |
| Evaporation | Water lost per step, so a droplet carries less as it dries |
| Droplet life | Steps before it expires and drops what it still holds |
| Erosion radius | Cells the cut is spread over |
| Colour by cut / fill | Tints the surface warm where material was removed, cool where it was added |
| Rain / Step / Reset | Run continuously, add one tick, or return to the uneroded terrain |
| New rainfall | A different set of droplets, from the uneroded terrain |

**More erosion is not better.** Channel concentration — the share of all erosion
landing in the busiest 10% of cells, against 0.10 for perfectly even wear —
peaks early and decays as the rain keeps falling:

| rain (droplets/cell, 128²) | relief kept | channel concentration |
| --- | --- | --- |
| 0.3 | 94% | **0.485** |
| 3 | 81% | 0.355 |
| 24 | 57% | 0.262 |

The structure is cut in the first few ticks and worn away afterwards, so every
preset is deliberately restrained and the readout reports the **relief left**
rather than only the droplet count. Once that figure has fallen far, the run is
lowering the whole field rather than carving it. The rain is capped at 12
droplets per cell for the same reason.

#### Presets

All four measured at the same 1.2 droplets/cell, so only the parameters differ:

| Preset | relief kept | channel conc. | volume moved | what it is for |
| --- | --- | --- | --- | --- |
| **River valleys** | 83% | **0.435** | 61 | The default. Broad, shallow wear — the best structure per unit of terrain spent. |
| **Gorges** | 79% | 0.373 | 121 | Cuts *fewer* cells than River valleys but each 2.3× deeper: a tight radius and a long droplet life. |
| **Badlands** | 58% | 0.281 | **301** | Deliberately destructive. Moves five times the material and is the *least* selective — a teaching demo for erosion going too far. |
| **Floodplain** | 92% | 0.404 | 26 | The gentlest. Droplets drop their whole load at once, so deposits are thicker than cuts are deep. |

Every preset cuts over a wide area and deposits into a narrow one, which is how
valleys form — broad hillslope wear feeding concentrated valley-floor fill.
Badlands flattening toward an even ratio is the numeric signature of mush: when
material comes off everywhere and goes back everywhere, the run is lowering the
field rather than sculpting it.

#### Rain is measured per cell, never as a droplet count

A flat count means something entirely different at each resolution — 5,000
droplets is 0.3 per cell at 128² but 1.2 at 64². Held at a fixed count, the same
setting that carves valleys on one grid strips the relief off another; measured
as density, it behaves:

| resolution | relief kept, fixed 5,000 | relief kept, 0.3 /cell |
| --- | --- | --- |
| 32² | 40% | 83% |
| 64² | 69% | 83% |
| 128² | 87% | 88% |

A 47-point spread becomes 5. The residual is real rather than a leftover bug:
per-cell gradients genuinely get shallower as the grid gets finer, so a droplet
does less work per step on a larger grid.

#### Limits worth knowing

- **Height field only.** A volume has no "down", and the planet is displaced
  from the 3D field precisely so that it needs no surface grid — there is no
  lattice to run droplets on. Eroding the planet would mean running the
  simulation over the icosphere's vertex adjacency instead, which is a separate
  and much larger job. The panel says so rather than greying out silently.
- **The automaton's sea is perfectly flat.** Dead cells are exactly 0, so the
  gradient there is exactly 0 and a droplet landing on it has nowhere to go. It
  drops what it carries and stops.
- **Channels need scales to bite into.** Erosion cuts hardest where the terrain
  already has structure across a range of sizes, which is why the default stack
  is six octaves rather than two — on the old pair the result was closer to
  uniform wear. Raising persistence gives it more to work with; flattening the
  stack gives it less.

### Shaping operations

Applied per layer, and again to the finished composite under **Output**.
In height-field mode these reshape the terrain directly — Terrace turns it
into stepped mesas, Threshold into flat plateaus:

| Operation | Parameters | Effect |
| --- | --- | --- |
| None | — | Raw samples |
| Power | Exponent | `x^k` — above 1 darkens, below 1 brightens |
| Gain | Strength | S-curve about 0.5; above 1 adds contrast |
| Smoothstep | Edge 0, Edge 1 | Hermite ramp between the edges, flat outside |
| Terrace | Steps | Quantises into bands |
| Threshold | Cutoff | Binary cut |

### Reading the volumetric mode

A dense field is opaque — from outside you see a noisy shell, which is what a
uniform-density volume genuinely looks like. Shaping is what opens it up:
**Threshold** around 0.75 leaves only the brightest cells and the interior
structure becomes visible. Lightening blends such as Screen push the other way
and fill the volume in.

Cells below a visibility floor are omitted from the geometry rather than drawn
black, because that is the only way to see into the volume at all.

Resolution is capped at 128 for a height field and 32 for a volume, since a
volume costs the cube of the value; switching modes clamps it on the way in.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server with hot module replacement |
| `npm run build` | Typecheck and produce a production build in `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the production build locally |

## Project structure

```
src/
├── main.tsx                  Entry point
├── App.tsx                   Week nav shell and page switching
├── Slider.tsx                Labelled range input, shared by both pages
├── LayerPanel.tsx            Layer stack editor (Week 2)
├── pages/
│   ├── ObjectViewerPage.tsx  Week 1 — viewer and its control panel
│   └── NoisePage.tsx         Week 2 — viewport, sidebar, and noise state
├── SceneCanvas.tsx           Week 1 Three.js scene, render loop, disposal
├── RotationGizmo.tsx         Draggable XYZ orientation widget
├── shapes.ts                 Shape definitions and geometry factory
├── theme.ts                  Shared accent colour and hex parsing
├── NoiseMapPreview.tsx       Sidebar source map, click to inspect a cell
├── NoiseViewport.tsx         3D scene — height field, point cloud, or planet
├── noise.ts                  PRNG, sampling, shaping ops, blend modes, compositing
├── automata.ts               Cellular automaton over the composited field
├── erosion.ts                Droplet hydraulic erosion over the height field
├── App.css                   Shell, panel, and canvas styling
└── index.css                 Global reset
```

Adding a week is one page component plus one entry in the `PAGES` array in
`App.tsx`; the shell opens on the last entry.

## Architecture notes

**Scenes are built once and mutated in place.** Geometry swaps replace
`mesh.geometry` rather than the mesh itself, so the render loop never loses the
object it closed over. Changing resolution rebuilds the point cloud's geometry
without tearing down the renderer.

**Values are routed by how they behave.** Continuous ones (rotation, spin,
scale) reach the render loop through refs, keeping pointer-rate updates out of
React. Discrete ones (material properties) are applied in effects, since
writing them every frame would be wasted work.

**Noise sampling is deterministic.** A seeded PRNG (mulberry32) feeds a
Box–Muller transform. `Math.random()` would resample on every re-render, so
dragging a slider would look like static rather than a parameter change — the
seed is what draws a new field.

**The composite and the output shaping are memoised separately**, so dragging
an Output slider reshapes the existing composite rather than resampling. Any
change *within* a layer does resample the whole stack; at these sizes (197k
samples for the six-octave default at 32³) that is about 5 ms, and not worth a
per-layer cache.

**Out-of-range samples are clamped, not rescaled.** Raising the spread piles
mass onto pure black and white rather than quietly renormalising the field —
at σ = 0.5 roughly a third of cells land on an end. Rescaling would look
smoother but would misrepresent the distribution.

**Layer lattices wrap, and so do the automaton and the droplets.** Interpolated indices wrap
rather than clamping, so a low-frequency layer tiles instead of flattening
against the edges of the field. The automaton wraps for a sharper reason: with
clamped borders the edge cells would be permanently short of neighbours, so the
field would erode inward from its edges whatever rule was set. Droplets wrap for
the same reason: clamped, they would pool against the borders and wear a rim
into the field.

**Erosion is the one stage that is not a pure function of its controls.**
Sampling, shaping and the automaton all recompute from scratch, so their state
is just the controls. Erosion accumulates — "0.6 droplets per cell" means a
second tick landing on the terrain the first one carved — so it is carried as an
`ErosionRun` in state instead. Validity is checked by comparing the run's stored
source against the current automaton output during render: a layer edit changes
that identity and the run is dropped. Resetting from an effect instead would
cost an extra render every time a slider moved.

**Each erosion tick allocates a new height buffer rather than mutating one.**
`applyShaping` returns its input unchanged when shaping is None, so an in-place
buffer would keep the same identity the whole way to the viewport and the
geometry effect — which compares `field` by reference — would never re-run. A
128² copy is 65 KB against roughly 15 ms of droplet work, so the safety costs
nothing measurable.

**The erosion brush divides its falloff by `radius + 1`.** With the textbook
`1 - distance / radius`, a cell exactly `radius` away weighs zero and drops out,
so radius 1 collapses to the centre cell alone and the brush stops spreading
anything. That is the single-cell cutting the brush exists to prevent: it carves
pinpoint pits, a pit steepens its own walls, steeper walls raise the droplet's
carrying capacity, and the field runs away until it hits the clamp — internally
reaching −15 and +17 before being clamped back to a terrain that looked merely
odd. Over 40 seeds at radius 1 the degenerate brush blew up 8 times and the
corrected one never, at the same cost and with channel concentration unchanged.

**Compositing is done once, in the page.** The map preview and the 3D viewport
both receive a finished `Float32Array` and only draw it, so neither holds
sampling logic and they cannot drift apart. A volume slice is a `subarray`, not
a copy — index `z·R² + (y·R + x)` makes each slice contiguous.

**The surface grid is built per resolution, then written into.** X and Z are
fixed by the lattice; only Y and vertex colour change with the field, so a
slider drag rewrites two attributes and recomputes normals rather than
rebuilding 32k triangles. The planet works the same way: its unit-sphere
directions are cached once and an update only rewrites radii, about 7 ms for
10,242 vertices.

**The icosphere is welded before use.** `IcosahedronGeometry` returns
non-indexed geometry — every triangle owns its three vertices — so the same
point would be displaced repeatedly and `computeVertexNormals` could only
produce flat facets. `mergeVertices` cuts 61k vertices to 10k and makes the
normals continuous. Note also that `PolyhedronGeometry` splits each edge into
`detail + 1` segments, so detail 31 means 20·32² = 20,480 faces, not 4³¹.

**The map is painted at one device pixel per cell** on an offscreen canvas and
scaled up with smoothing off. Filling cell rectangles directly would mean a
`fillStyle` change per cell, which is far slower at the top of the resolution
range.

## Built with

React 19 · TypeScript · Vite · Three.js
