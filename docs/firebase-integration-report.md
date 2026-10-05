# Firebase integration — codebase report

Prepared 2026-09-23 as a handover document for planning a Firebase integration.
Read-only inspection; no source files were modified to produce it.

> **Branch note.** This report describes the working tree of the
> `topic-3-voxels` branch. Topic 3 (`src/density.ts`, `src/mesher.ts`,
> `src/VoxelViewport.tsx`, `src/CsgPanel.tsx`, and the real
> `src/pages/VoxelPage.tsx`) is **not yet merged to `main`** — `main` is at
> `139de57`, where `VoxelPage.tsx` is still an 18-line placeholder. Any Firebase
> work targeting the voxel page must branch from `topic-3-voxels`, or that
> branch must be landed first.

---

## 1. Project overview

| | |
| --- | --- |
| **App type** | Single-page educational coursework app. Three self-contained "topics" (3D object viewer, procedural noise terrain, voxel/CSG modeller) behind a tab shell. Entirely client-side, no backend. |
| **Framework** | React **19.2.8** + **Vite 8.2.2** |
| **3D** | **raw three.js 0.185.1** — **not** react-three-fiber, not drei. Scenes are imperative: a `useEffect` builds the scene, a `requestAnimationFrame` loop renders, cleanup disposes. |
| **Language** | **TypeScript** (`~6.0.2`), `.ts`/`.tsx` throughout. No JS source files. |
| **Package manager** | **npm** (`package-lock.json` only; no yarn/pnpm lockfile) |
| **State management** | **React `useState` only.** No Redux, Zustand, Jotai, or React Context anywhere. |
| **Routing** | **None.** No react-router. Tab switching is a `useState<PageId>` in `App.tsx`. |

`package.json` `name` is still the scaffold default `"design-app"`, `version: "0.0.0"`, `private: true`.

TypeScript config note: `tsconfig.app.json` sets `noUnusedLocals`,
`noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch` — but
**`strict` is never set**, so strict null checks are off. Relevant because
`user` will be `User | null`.

Runtime dependencies are only `react`, `react-dom`, `three`. Everything else is
a devDependency.

## 2. Project structure

```
├── index.html                 Vite entry, mounts #root
├── package.json
├── vite.config.ts             react plugin only — NO base, NO build overrides
├── tsconfig.json              solution file → app + node
├── tsconfig.app.json          src/ compile options
├── tsconfig.node.json
├── eslint.config.js
├── .gitignore
├── CLAUDE.md                  repo working agreements
├── README.md
├── public/
│   └── favicon.svg            the ONLY public asset
├── docs/                      markdown write-ups (not shipped)
└── src/
    ├── main.tsx               entry point
    ├── App.tsx                shell, PAGES array, focus-mode hotkey
    ├── index.css, App.css
    ├── pages/
    │   ├── ObjectViewerPage.tsx   Topic 1
    │   ├── NoisePage.tsx          Topic 2  ← largest state surface (903 lines)
    │   └── VoxelPage.tsx          Topic 3
    ├── SceneCanvas.tsx        Topic 1 three.js scene
    ├── RotationGizmo.tsx      Topic 1 orientation widget (own WebGL canvas)
    ├── NoiseViewport.tsx      Topic 2 three.js scene (583)
    ├── NoiseMapPreview.tsx    Topic 2 sidebar map — 2D canvas
    ├── VoxelViewport.tsx      Topic 3 three.js scene
    ├── LayerPanel.tsx         Topic 2 layer stack editor
    ├── CsgPanel.tsx           Topic 3 shape stack editor
    ├── Slider.tsx, InfoTip.tsx    shared UI
    ├── shapes.ts              Topic 1 geometry factory
    ├── noise.ts               PRNG, sampling, shaping, blending, fBm, warp (532)
    ├── automata.ts            cellular automaton
    ├── erosion.ts             droplet + thermal erosion (431)
    ├── density.ts             SDF primitives, CSG, scenes (548)
    ├── mesher.ts              5 meshing algorithms (795)
    ├── palette.ts             OKLab colour ramps
    └── theme.ts               ACCENT_BLUE + hex parsing
```

**No backend files of any kind.** No `api/`, no serverless functions, no server
entry point.

## 3. App entry points

| Role | Exact path |
| --- | --- |
| HTML entry | `index.html` → `<script type="module" src="/src/main.tsx">` |
| JS entry | `src/main.tsx` — `createRoot(document.getElementById('root')!)`, wrapped in `<StrictMode>` |
| Root component | `src/App.tsx`, `function App()` (default export, line 95) |
| Page registry | `src/App.tsx` lines 10–14, `const PAGES` — entries are `{ id, topic, title, render }` |
| Active page render | `src/App.tsx` — `<main className="app-page">{PAGES.find(e => e.id === page)?.render()}</main>` |

Scene and world renderers:

| Topic | Page component | Scene component | Generation modules |
| --- | --- | --- | --- |
| 1 | `src/pages/ObjectViewerPage.tsx` | `src/SceneCanvas.tsx` | `src/shapes.ts` |
| 2 | `src/pages/NoisePage.tsx` | `src/NoiseViewport.tsx` | `noise.ts`, `automata.ts`, `erosion.ts`, `palette.ts` |
| 3 | `src/pages/VoxelPage.tsx` | `src/VoxelViewport.tsx` | `density.ts`, `mesher.ts` |

All three viewports create their own `THREE.WebGLRenderer` inside a mount-once
`useEffect` and append the canvas to a container div. `RotationGizmo.tsx`
creates a **fourth** WebGL context (Topic 1 only).

## 4. Current application state

**All state is local `useState` inside the page components.** There is no store,
no context, and no props-drilling of configuration. This is the single most
important fact for the integration: *each page owns its own configuration and
nothing is lifted.*

### Topic 2 — `src/pages/NoisePage.tsx` (lines 120–170)

The richest configuration, and the obvious candidate for a save/load feature.

```ts
// Geometry / display
mode: GeometryMode              // 'surface' | 'volume' | 'planet'
resolution: number              // default 128; capped {surface:128, volume:32, planet:32}
heightScale: number             // 1.4
relief: number                  // 0.18
slice: number                   // 0
spin: number                    // 0
wireframe: boolean              // false
tint: string                    // '#6ea8fe' (ACCENT_BLUE)
paletteName: PaletteName        // 'terrain' | 'viridis' | 'magma' | 'grey' | 'hue'
bands: number                   // 0 = continuous, max 48
fitRamp: boolean                // true

// Erosion
presetName: string              // 'gorges'
erosionParams: ErosionParams    // {inertia,capacity,deposition,erosion,evaporation,gravity,lifetime,radius}
density: number                 // droplets per cell
erosionSeed: number             // 1
erosion: ErosionRun | null      // ⚠ holds Float32Arrays — see §10
eroding: boolean
showCutFill: boolean

// Automata
caThreshold: number             // 0.5
survive: number                 // DEFAULT_SURVIVE[2] = 5
generation: number              // 0
playing: boolean

// Warp
warpAmount, warpFrequency, warpSeed: number   // 0, 4, 1

// Thermal
talus, talusStrength, thermalPasses: number   // 0.02, 0.5, 0

// Layer stack
octaves: number                 // 6
persistence: number             // 0.5
layers: NoiseLayer[]            // the core of the config
expandedId: string | null       // UI only
outputShapingName: ShapingName
outputParams: Record<string, number>
```

`NoiseLayer` (`src/noise.ts:253`):

```ts
{ id: string; name: string; enabled: boolean; frequency: number;
  spread: number; seed: number; shapingName: ShapingName;
  shapingParams: Record<string, number>; blendName: BlendName; opacity: number }
```

### Topic 3 — `src/pages/VoxelPage.tsx` (lines 67–77)

```ts
sceneName: string               // preset id
nodes: CsgNode[]                // the CSG stack
expandedId: string | null       // UI only
mode: RenderMode                // 'surface' | 'dual' | 'marching' | 'blocks'
greedy: boolean
resolution: number              // 56, max 96
iso: number                     // 0
spin: number
showBounds: boolean
palette: PaletteName
```

`CsgNode` (`src/density.ts:324`):

```ts
{ id: string; shape: ShapeName; params: Record<string, number>;
  op: CsgOpName; blend: number; offset: {x,y,z}; seed: number; enabled: boolean }
```

### Topic 1 — `src/pages/ObjectViewerPage.tsx` (lines 10–20)

```ts
shape, spinSpeed, scale, color, metalness, roughness, wireframe
rotationRef: useRef<THREE.Quaternion>   // ⚠ a REF, not state — see §14
```

**Recommendation:** Topic 2 or Topic 3 state is what should be saved as a
"configuration". Topic 3 is smaller and cleaner (~10 scalars plus a node array);
Topic 2 is more impressive but drags in the erosion complication.

## 5. Save/load behaviour

**None exists.** Verified by grep across `src/`:

- No `localStorage`, `sessionStorage`, or `indexedDB`
- No `JSON.parse` / `JSON.stringify`
- No export, import, download, or serialization logic
- No save or load buttons

The only buttons that reset state do so in memory: `Reset orientation`
(`ObjectViewerPage.tsx`), `Rebuild as fBm stack` / `Reset` / `New rainfall` /
`New warp` (`NoisePage.tsx`), `+ Add shape` (`CsgPanel.tsx`). Reloading the page
loses everything.

**This is a clean slate — there is no existing persistence to reconcile with.**

## 6. Firebase status

**Nothing. Firebase has never been installed or configured.** Verified:

- `firebase` is **not** in `package.json` dependencies or devDependencies
- Zero matches for `firebase`, `firestore`, `getAuth`, `signIn`, `login`,
  `logout` across `src/`, config files, and `index.html`
- No `firebase.json`, no `.firebaserc`, no `firestore.rules`, no `storage.rules`
- No `.github/workflows`, no `vercel.json`, no `netlify.toml`

## 7. Environment variables

- **No `.env` files exist** (no `.env`, `.env.local`, `.env.production`)
- **No `import.meta.env` usage** anywhere in `src/`
- **No `process.env` usage** anywhere in `src/`

**⚠ `.gitignore` does NOT contain `.env`.** It has `*.local`, which covers
`.env.local` and `.env.development.local` but **not a plain `.env`**. Add `.env`
to `.gitignore` before creating one.

Vite only exposes variables prefixed `VITE_` to client code. Firebase web config
keys are not secrets — they ship in the bundle regardless — so the real security
boundary is Firestore/Storage rules, not env hygiene.

## 8. Authentication / UI architecture

`src/App.tsx` lines 57–76 renders a persistent header:

```tsx
<header className="app-nav">
  <span className="app-brand">Procedural World Building</span>
  <nav className="topic-nav"> …tab buttons… </nav>
</header>
```

**Best fit for login/logout and user display:** the right-hand side of
`.app-nav` in `src/App.tsx`. The nav is currently brand + tabs with nothing on
the right. Styling hook: `.app-nav` in `src/App.css`.

Existing settings panels, either of which could host a "Saved configurations"
list:

| Panel | Class | File |
| --- | --- | --- |
| Topic 1 floating widget | `.control-widget` | `ObjectViewerPage.tsx:34` |
| Topic 2 sidebar | `.control-sidebar` | `NoisePage.tsx:357` |
| Topic 3 sidebar | `.control-sidebar` | `VoxelPage.tsx:129` |

`.control-sidebar` is **shared** by Topics 2 and 3 — styling changes hit both.

**Routing: none.** There are no URLs to protect, so auth must gate by
conditional rendering rather than route guards. A `?config=<id>` share link
would need `URLSearchParams` added from scratch.

**⚠ Focus mode interaction:** `src/App.css` hides `.app-nav`,
`.control-sidebar` and `.control-widget` when `H` is pressed. Auth UI placed in
the nav will disappear in focus mode — probably fine, but intentional.

## 9. Recommended Firebase integration points

All new files unless marked otherwise:

| Concern | Recommended path |
| --- | --- |
| SDK init | `src/firebase/config.ts` — exports `app`, `auth`, `db`, `storage` |
| Auth listener + context | `src/firebase/AuthProvider.tsx` — `onAuthStateChanged`, exposes `useAuth()` |
| Google sign-in/out | `src/firebase/auth.ts` — `signInWithGoogle()`, `signOutUser()` |
| Auth UI | `src/AuthBar.tsx`, rendered inside `.app-nav` in `src/App.tsx` |
| Firestore CRUD | `src/firebase/configs.ts` — `saveConfiguration()`, `loadConfiguration()`, `listConfigurations()`, `deleteConfiguration()` |
| Storage upload | `src/firebase/storage.ts` — `uploadThumbnail()` |
| Serialization | `src/config/voxelConfig.ts` (and/or `noiseConfig.ts`) — `toConfig(state)` / `applyConfig(config, setters)` |
| Save/load UI | `src/ConfigPanel.tsx`, mounted in the `VoxelPage.tsx` sidebar |

Keeping serialization **separate** from the Firestore layer matters here,
because page state is roughly ten individual `useState` calls — `applyConfig`
needs the setters, and mixing that with network code will get ugly fast.

`AuthProvider` should wrap `<App />` in `src/main.tsx`.

## 10. Data model recommendation

```
users/{uid}                          ← profile doc (displayName, photoURL, createdAt)
users/{uid}/configs/{configId}       ← saved configurations
```

A subcollection under `uid` makes the security rule a one-liner and satisfies
the "data linked to the logged-in user" requirement.

Suggested document, using Topic 3 (recommended — smallest and cleanest):

```ts
{
  name: string,              // user-entered
  topic: 'voxels',
  schemaVersion: 1,          // strongly recommended — see §14
  createdAt: Timestamp,
  updatedAt: Timestamp,
  ownerUid: string,          // denormalised, simplifies rules
  thumbnailPath: string,     // Storage path, NOT a download URL
  settings: {
    sceneName, mode, greedy, resolution, iso, spin, showBounds, palette,
    nodes: CsgNode[]         // id, shape, params, op, blend, offset{x,y,z}, seed, enabled
  }
}
```

A three-node stack is well under 2 KB, so Firestore's 1 MiB document limit is
not a risk.

### What must NOT go into Firestore

| Data | Where it lives | Why not |
| --- | --- | --- |
| `volume.field` | `VoxelPage.tsx:82` | `Float32Array` of `resolution³` — 884 KB at 96³. Regenerate from settings. |
| `mesh.positions/normals/indices` | `VoxelPage.tsx:84` | Megabytes of typed arrays. Regenerate. |
| `ErosionRun` | `NoisePage.tsx:148` | Holds **three** `Float32Array`s (`source`, `height`, `cut`). Store `erosionSeed` + `rain`/`droplets` + params and replay instead. |
| `composite`, `warped`, `automata.field`, `field` | `NoisePage.tsx:211–250` | All derived `Float32Array`s. |
| `lut` / `ramp` | `NoisePage.tsx:139` | Derived from `paletteName` / `tint` / `bands`. |
| `expandedId` | both pages | Pure UI state. |

**Critical:** Firestore cannot store `Float32Array`. It silently coerces typed
arrays into objects with numeric string keys, which will bloat or corrupt the
document. Never pass raw field data.

## 11. Procedural generation and determinism

**Generation is fully deterministic.** This is the strongest asset for the
assignment.

- **`Math.random()` appears nowhere in `src/`.** Verified by grep. The only
  nondeterministic calls are `performance.now()` (timing readouts only) and
  `useId()` (React tooltip ids).
- **Seeded PRNG:** `mulberry32(seed)` at `src/noise.ts:11`, used by
  `createNoiseField` (`noise.ts:40`), `erodeStep` (`erosion.ts:339`), and the
  `density.ts` terrain lattices.
- **No external noise library** — value noise is hand-written with a Hermite fade.

Per-stage seeds:

| Stage | Seed source |
| --- | --- |
| Noise layers | `layer.seed`, one per layer (`NoiseLayer.seed`) |
| Domain warp | `warpSeed` → `warpField(..., {amount, frequency, seed})` |
| Cellular automaton | none needed — a pure function of input plus rule |
| Erosion | `erosionSeed * 7919`, then `mulberry32(seed + previous.droplets)` (`erosion.ts:339`) |
| Topic 3 terrain | `node.seed` → `terrainHeight(octaves, seed)` (`density.ts:72`) |

**Would parameters plus seed recreate the same world? Yes**, with one nuance.

Topic 3 is unconditionally reproducible: `sampleVolume(nodes, resolution)` is a
pure function.

Topic 2's **erosion accumulates**. The PRNG is seeded `seed + previous.droplets`
(`erosion.ts:339`), so tick *N* depends on the cumulative droplets so far.
Replaying `erosionSeed` plus the same per-tick `density` and the same tick count
reproduces it exactly — but if the user changed `density` mid-run, the tick
boundaries differ and the result will not match. **Store cumulative `droplets`
and replay in equal-sized ticks**, or scope the save feature to Topic 3 and
avoid the problem entirely.

**⚠ Module-level id counters:** `layerCounter` (`NoisePage.tsx:69`) and `nextId`
(`VoxelPage.tsx:62`) reset to 0 on every page load. Loading a config containing
`node-7` and then clicking "Add shape" will mint a duplicate id. Loading must
advance the counter past the highest restored id, or the code should switch to
`crypto.randomUUID()`.

## 12. Firebase Storage use case

**Recommendation: a PNG thumbnail of the Topic 2 sidebar map
(`NoiseMapPreview`), or a JSON export as the fallback.**

**⚠ The WebGL canvases cannot be screenshotted as they stand.** All four
renderers are constructed without `preserveDrawingBuffer`:

- `NoiseViewport.tsx:371` — `new THREE.WebGLRenderer({ antialias: true })`
- `VoxelViewport.tsx:73` — same
- `SceneCanvas.tsx:56` — same
- `RotationGizmo.tsx:56` — `{ antialias: true, alpha: true }`

`canvas.toDataURL()` on these returns a blank image, because the drawing buffer
is cleared after compositing. Fixing it means either setting
`preserveDrawingBuffer: true` (a persistent memory and performance cost on every
frame) or calling `renderer.render()` and `toDataURL()` back-to-back inside a
single `requestAnimationFrame`.

By contrast, `src/NoiseMapPreview.tsx` uses a **plain 2D canvas**
(`canvas.getContext('2d')`, line 30). `toDataURL('image/png')` works on it with
zero changes. That is by far the lowest-risk option.

If the save feature targets Topic 3 (which has no 2D preview), the simplest
honest option is **uploading the configuration JSON as a `.json` blob** to
Storage alongside the Firestore document. It satisfies the requirement, needs no
rendering changes, and doubles as an export/download feature.

## 13. Hosting and deployment status

- **No deployment config exists** — no Vercel, Netlify, GitHub Pages, or
  Firebase Hosting.
- `npm run build` = **`tsc -b && vite build`**. It typechecks first, so **any
  type error fails the deploy**.
- Output directory: **`dist/`** (Vite default; no `build.outDir` override).
  Present locally and gitignored.
- The build produces `dist/index.html`, `dist/assets/*`, `dist/favicon.svg`.
  Build time is around 200 ms.
- **This is a textbook Vite SPA.** Nothing server-rendered, no dynamic imports,
  no code splitting configured.

For `firebase.json`: `"public": "dist"`, and the SPA rewrite to `/index.html` is
harmless since there is only one route. Run `firebase init hosting` with `dist`
as the public directory and **decline** the "overwrite index.html" prompt.

**⚠ `vite.config.ts` sets no `base`**, so asset paths are absolute
(`/assets/...`). Correct for Firebase Hosting at a domain root; it would break
on a GitHub Pages subpath, which is not a concern here.

## 14. Potential problems

### High priority

1. **`preserveDrawingBuffer` absent** — see §12. Blocks WebGL screenshots.
2. **`.env` not in `.gitignore`** — add it before creating one.
3. **React `StrictMode` is on** (`main.tsx:7`). Effects run twice in
   development. An `onAuthStateChanged` subscription without a cleanup return
   will double-subscribe and fire duplicate callbacks *in dev only*. Always
   return the unsubscribe function.
4. **`Float32Array` → Firestore** — see §10. Must be stripped before any write.
5. **Module-level id counters** — see §11.

### Medium

6. **`strict` is not enabled in `tsconfig.app.json`**, so `User | null` will not
   be flagged. Since `npm run build` runs `tsc -b`, a null-safety mistake
   surfaces at runtime rather than at build time.
7. **Popup sign-in**: `signInWithPopup` is blocked unless called directly from a
   user gesture — wire it to `onClick`, not to an effect. `signInWithRedirect`
   is the fallback, but it loses in-memory page state on return, and since
   **nothing is persisted** the user's whole configuration would vanish.
   **Prefer popup.**
8. **Auth domain**: Google sign-in requires the deployed domain in Firebase
   Console → Authentication → Authorized domains. `localhost` is authorized by
   default and the `*.web.app` domain is added automatically, but a custom
   domain is not.
9. **Storage CORS**: `getDownloadURL()` plus an `<img>` tag works without CORS
   configuration. Fetching bytes via `fetch()`/XHR from a different origin
   requires a bucket CORS config via `gsutil`. Prefer download URLs.

### Low

10. **Bundle size**: three.js is around 600 KB minified and currently unsplit —
    Vite already warns about the 500 KB chunk limit. The Firebase SDK will grow
    it further. Use modular imports (`firebase/auth`, `firebase/firestore`) and
    consider `build.rollupOptions.output.manualChunks`. Hosting serves it fine
    either way.
11. **Four WebGL contexts** (three viewports plus the gizmo). Browsers cap at
    roughly 16. Not a Firebase issue, but worth knowing if more canvases appear.
12. **No routing** means no rewrite edge cases — a genuine simplification.
13. **`rotationRef` is a ref, not state** (`ObjectViewerPage.tsx:20`). If Topic 1
    is ever made saveable, the quaternion will not trigger re-renders and must be
    read imperatively at save time.

## 15. Recommended implementation order

Adjusted for this codebase. The serialization layer is pulled early because the
state is spread across many `useState` calls, and getting that shape wrong is
the expensive mistake.

1. **Add `.env` to `.gitignore`**, then create the Firebase project and a `.env`
   with `VITE_FIREBASE_*` keys.
2. **`npm install firebase`**, create `src/firebase/config.ts`.
3. **Pick the target page — recommend Topic 3 (`VoxelPage.tsx`)** for its
   compact, fully deterministic state. Write `src/config/voxelConfig.ts` with
   `toConfig()` / `applyConfig()` and verify round-tripping in memory *before
   any network code*. This de-risks everything downstream.
4. **Auth**: `AuthProvider` plus `useAuth()`, wrap `<App/>` in `main.tsx`, add
   `AuthBar` to `.app-nav`. Use `signInWithPopup`.
5. **Firestore save/load**: `users/{uid}/configs/{configId}`, plus a list UI in
   the Topic 3 sidebar.
6. **Storage**: upload either a JSON blob or, if the target switches to Topic 2,
   a map-preview PNG.
7. **Security rules** for both Firestore and Storage —
   `request.auth.uid == uid`. Do this *before* deploying publicly.
8. **Hosting**: `firebase init hosting` → public directory `dist`, SPA rewrite,
   then `npm run build && firebase deploy`.
9. Add the deployed domain to Authorized domains and re-test sign-in in
   production.

## 16. Files likely to be modified or created

| File | Current purpose | Firebase-related change |
| --- | --- | --- |
| `package.json` | deps, scripts | **Modify** — add `firebase`; optionally a `deploy` script |
| `.gitignore` | ignore rules | **Modify** — add `.env` ⚠ |
| `.env` | — | **Create** — `VITE_FIREBASE_*` (never committed) |
| `firebase.json` | — | **Create** — hosting `public: "dist"`, SPA rewrite |
| `.firebaserc` | — | **Create** — project alias |
| `firestore.rules` | — | **Create** — uid-scoped access |
| `storage.rules` | — | **Create** — uid-scoped access |
| `firestore.indexes.json` | — | **Create** — likely empty; needed if sorting by `updatedAt` |
| `src/firebase/config.ts` | — | **Create** — init `app`, `auth`, `db`, `storage` |
| `src/firebase/AuthProvider.tsx` | — | **Create** — `onAuthStateChanged` plus context |
| `src/firebase/auth.ts` | — | **Create** — `signInWithGoogle`, `signOutUser` |
| `src/firebase/configs.ts` | — | **Create** — save/load/list/delete |
| `src/firebase/storage.ts` | — | **Create** — upload plus `getDownloadURL` |
| `src/config/voxelConfig.ts` | — | **Create** — `toConfig` / `applyConfig` |
| `src/AuthBar.tsx` | — | **Create** — sign-in button, avatar, sign-out |
| `src/ConfigPanel.tsx` | — | **Create** — save/load UI for the sidebar |
| `src/main.tsx` | mounts `<App/>` in StrictMode | **Modify** — wrap in `<AuthProvider>` |
| `src/App.tsx` | shell, nav, page switching | **Modify** — render `<AuthBar/>` in `.app-nav` |
| `src/App.css` | all styling | **Modify** — auth bar and config list styles |
| `src/pages/VoxelPage.tsx` | Topic 3 state and UI | **Modify** — expose state to `toConfig`, accept `applyConfig`, mount `<ConfigPanel/>`, fix `nextId` after load ⚠ |
| `src/VoxelViewport.tsx` | Topic 3 three.js scene | **Modify only if** WebGL screenshots are needed (`preserveDrawingBuffer`) ⚠ |
| `src/NoiseMapPreview.tsx` | Topic 2 2D map canvas | **Modify only if** used as the thumbnail source (expose a ref) |
| `src/pages/NoisePage.tsx` | Topic 2 state and UI | **Modify only if** Topic 2 is the save target — larger job, erosion replay ⚠ |
| `README.md` / `CLAUDE.md` | docs | **Modify** — setup steps, env var names, deploy URL |

---

## Two decisions to make first

**Which topic the save feature targets.** Topic 3 is materially easier and
fully deterministic; Topic 2 is more impressive but drags in erosion replay.

**Whether Storage holds a PNG or a JSON blob.** A PNG is only cheap if you use
the 2D map canvas, which lives on Topic 2 — so these two choices are coupled.
