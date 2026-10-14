import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * Drag like a map: left-drag slides the view across the ground, right-drag
 * (or ⌘, Ctrl or Shift with the left button) orbits, the wheel zooms.
 *
 * For the Project's two scenes that are places rather than objects — the
 * building and the island. A Playground topic orbits on left-drag because its
 * subject sits at the centre and the point is to turn it over; here the point
 * is to move around, and on a trackpad a right-drag is the awkward gesture, so
 * the common one gets the common gesture. The modifier fallback is
 * OrbitControls' own: a left-drag mapped to pan rotates while one is held.
 *
 * Panning stays on the ground plane rather than the screen's, so dragging
 * never lifts the view up a tower or sinks it under the island.
 */
export function applyMapDrag(controls: OrbitControls) {
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
  controls.screenSpacePanning = false
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
