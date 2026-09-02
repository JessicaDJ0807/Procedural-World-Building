# Procedural World Building

An interactive 3D object viewer built with React, TypeScript, and Three.js.
Coursework project for a design course.

The app renders a real-time WebGL scene with a control panel for shaping,
orienting, and re-materialising the object in view.

## Features

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
├── App.tsx            UI shell and control panel state
├── SceneCanvas.tsx    Main Three.js scene, render loop, and disposal
├── RotationGizmo.tsx  Draggable XYZ orientation widget
├── shapes.ts          Shape definitions and geometry factory
├── App.css            Panel and canvas styling
└── index.css          Global reset
```

## Architecture notes

The scene is built once in a mount effect and then mutated in place — geometry
swaps replace `mesh.geometry` rather than the mesh itself, so the render loop
never loses the object it closed over.

Values are routed by how they behave. Continuous ones (rotation, spin, scale)
reach the render loop through refs, keeping pointer-rate updates out of React.
Discrete ones (material properties) are applied in effects, since writing them
every frame would be wasted work.

## Built with

React 19 · TypeScript · Vite · Three.js
