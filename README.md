# Procedural World Building

Coursework for a weekly design course, built with React, TypeScript, and
Three.js. Each week's work lives on its own page behind a nav shell, so the app
accumulates as the course goes rather than replacing what came before.

Each week has its own write-up in [`docs/`](docs/); this page is the map.

## Weeks

### [Week 1 — 3D Objects](docs/week-1-objects.md)

A real-time WebGL object viewer. Five primitives swapped in place, a draggable
XYZ gizmo storing orientation as a quaternion so the object never gimbal-locks,
and material controls lit by a generated `RoomEnvironment` cubemap.

### [Week 2 — Noise](docs/week-2-noise.md)

A field of values in `[0, 1]`, built and then progressively shaped:

- **Layers** — a stack of value-noise fields, composited bottom-up with nine
  blend modes. Opens on a six-octave fBm stack, which measures at a Hurst
  exponent of 0.75 with R² 0.990 — inside the band real topography occupies.
- **Warp** — looks the field up at coordinates displaced by another noise
  field, so strata fold and ridges curve.
- **Automata** — a 3×3(×3) neighbour rule run to its fixed point, turning
  speckled noise into connected landmasses and caves.
- **Erosion** — droplet hydraulic erosion plus thermal slippage, which is what
  cuts dendritic valley networks that noise alone never produces.
- **Output** — eight per-cell shaping ops, five colour ramps interpolated in
  OKLab, and three geometry modes: height field, point cloud, or planet.

### [Week 3 — Voxels](docs/week-3-voxels.md)

Placeholder — the page, nav entry, and styling exist; the work has yet to land.

## Keyboard

| Key | Effect |
| --- | --- |
| `H` | Hide every panel and give the whole window to the object. Press again to bring them back |
| `Esc` | Always restores the panels, never hides them |

Focus mode works on every week — it hides the week nav, Week 2's sidebar and
Week 1's floating control widget. `Esc` only ever restores, which is what makes
hiding the UI safe to try, and a small clickable reminder stays in the corner.
The shortcut is ignored while a select or text field has focus, since a letter
key means something there, but it still works from a slider or checkbox, which
is where focus usually sits after changing a value.

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

```
src/
├── main.tsx                  Entry point
├── App.tsx                   Week nav shell, page switching, focus mode
├── Slider.tsx                Labelled range input, shared by both pages
├── InfoTip.tsx               Hover explanation, portalled out of the scrolling panel
├── LayerPanel.tsx            Layer stack editor (Week 2)
├── pages/
│   ├── ObjectViewerPage.tsx  Week 1 — viewer and its control panel
│   ├── NoisePage.tsx         Week 2 — viewport, sidebar, and noise state
│   └── VoxelPage.tsx         Week 3 — placeholder, no content yet
├── SceneCanvas.tsx           Week 1 Three.js scene, render loop, disposal
├── RotationGizmo.tsx         Draggable XYZ orientation widget
├── shapes.ts                 Shape definitions and geometry factory
├── theme.ts                  Shared accent colour and hex parsing
├── palette.ts                Colour ramps, OKLab interpolation, ramp fitting
├── NoiseMapPreview.tsx       Sidebar source map, click to inspect a cell
├── NoiseViewport.tsx         3D scene — height field, point cloud, or planet
├── noise.ts                  PRNG, sampling, shaping ops, blend modes, compositing
├── automata.ts               Cellular automaton over the composited field
├── erosion.ts                Droplet hydraulic erosion over the height field
├── App.css                   Shell, panel, and canvas styling
└── index.css                 Global reset

docs/
├── week-1-objects.md         Week 1 write-up
├── week-2-noise.md           Week 2 write-up — the long one
└── week-3-voxels.md          Week 3 write-up
```

Adding a week is one page component plus one entry in the `PAGES` array in
`App.tsx`, which carries its own `render` — the shell opens on the last entry.

Adding a week is one page component, one entry in the `PAGES` array in
`App.tsx`, and one file in `docs/`.

## Conventions

Decisions specific to a week live in that week's write-up. These hold
everywhere.

**Scenes are built once and mutated in place.** Geometry swaps replace
`mesh.geometry` rather than the mesh itself, so the render loop never loses the
object it closed over. Changing resolution rebuilds the point cloud's geometry
without tearing down the renderer.

**Values are routed by how they behave.** Continuous ones (rotation, spin,
scale) reach the render loop through refs, keeping pointer-rate updates out of
React. Discrete ones (material properties) are applied in effects, since
writing them every frame would be wasted work.

**Panels are hidden with `display: none`, not made transparent.** Their
controls leave the tab order with them, so tabbing while the UI is hidden
cannot land inside a panel you cannot see. Both canvases watch their container
with a `ResizeObserver`, so the view reflows to the full width rather than
stretching.

**Work for a week happens on its own branch** — `week-3-voxels` and so on —
and lands on `main` collapsed into one to three commits. A merge would replay
every branch commit onto main and only `git log --first-parent` would hide
them; compressing first means the log is short however it is read, and the
reasoning survives in the commit messages rather than being discarded.

## Built with

React 19 · TypeScript · Vite · Three.js
