import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * One mouse convention for every 3D view in the app:
 *
 *   left-drag    rotate (orbit)
 *   right-drag   move (pan) — or ⌘ / Ctrl / Shift with a left-drag, for trackpads
 *   scroll       zoom
 *   touch        one finger rotates, two pinch to zoom and move
 *
 * The web's 3D default — three.js's own, and most model viewers' — and what
 * nine of the app's eleven views already did. Explore and Site once dragged
 * "like a map" instead (left-drag moved, right-drag rotated), so a gesture
 * meant opposite things on neighbouring pages; Build's own click-to-place
 * also wants the plain left gesture to be the one that never moves the scene
 * away. Every view calls this, so the convention can't drift again.
 *
 * `ground`: for scenes that are places — the island, a building, a town —
 * moving slides along the ground plane rather than the screen, so a drag
 * never lifts the view up a tower or sinks it under the ground. Objects
 * turned over in the Playground move in screen space, the default.
 */
export function applyViewControls(controls: OrbitControls, { ground = false }: { ground?: boolean } = {}) {
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
  controls.screenSpacePanning = !ground
}

/**
 * Keeps the orbit target inside a box on the ground, moving the camera by the
 * same amount so a clamp never turns into a rotation. Without it a long drag
 * slides the scene out of view with nothing to drag back on.
 */
export function clampTarget(
  controls: OrbitControls,
  camera: THREE.Camera,
  box: { x0: number; x1: number; z0: number; z1: number },
) {
  const t = controls.target
  const dx = Math.min(box.x1, Math.max(box.x0, t.x)) - t.x
  const dz = Math.min(box.z1, Math.max(box.z0, t.z)) - t.z
  if (dx === 0 && dz === 0) return
  t.x += dx
  t.z += dz
  camera.position.x += dx
  camera.position.z += dz
}
