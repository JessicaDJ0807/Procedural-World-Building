import * as THREE from 'three'

/**
 * Pointer-locked WASD movement, on the ground or off it.
 *
 * ## Walking by default, flying on request
 *
 * This flew unconditionally at first, with the ground only as a floor it could
 * not drop through. The reasoning was that the most useful thing a viewer can
 * do is rise above a ridge to see what is behind it — which is true, and still
 * why flying exists. What it got wrong is what happens the rest of the time:
 * walk forward off a hill and you simply keep your altitude, hanging in the air
 * over the valley. Nothing about that reads as exploring a world.
 *
 * So the default follows the terrain, and the vertical keys turn that off. No
 * modifier to remember: asking to go up *is* asking to fly, and G puts you back
 * on the ground. Neither mode has collision — walking into a cliff climbs it —
 * because a demo of terrain does not need to be a demo of movement, and a
 * contact test that gets a cliff wrong is worse than no test at all.
 *
 * Height is eased rather than snapped. Pinning the camera exactly to the
 * surface each frame makes a sprint across broken ground jitter, because the
 * eye tracks every lump the feet would absorb.
 *
 * ## Why the keys are tracked by code, not by key
 *
 * `event.code` is the physical key. `event.key` is what it produces, which on
 * an AZERTY keyboard means W and A are somewhere else entirely, and with a
 * modifier held can be a different character again. The physical position is
 * what WASD means.
 */

const EYE = 2.6
/** Ground clearance, so the camera never ends up inside the surface. */
const FLOOR = 1.8

export type ControlState = {
  yaw: number
  pitch: number
  position: THREE.Vector3
  speed: number
  locked: boolean
  /** False while the camera is following the terrain. */
  flying: boolean
}

export type Controls = {
  state: ControlState
  /** Advances the camera. Returns true if anything moved this frame. */
  update(delta: number, camera: THREE.PerspectiveCamera, groundAt: (x: number, z: number) => number): boolean
  request(): void
  release(): void
  dispose(): void
}

/** R and F as asked for, with Space and C kept as the other common pair. */
const UP = new Set(['KeyR', 'Space'])
const DOWN = new Set(['KeyF', 'KeyC', 'ControlLeft', 'ControlRight'])

const BASE_SPEED = 34
const FAST_MULTIPLIER = 3.4
const LOOK = 0.0022
const MAX_PITCH = Math.PI / 2 - 0.04

export function createControls(
  canvas: HTMLElement,
  onLockChange: (locked: boolean) => void,
): Controls {
  const held = new Set<string>()
  const state: ControlState = {
    yaw: 0,
    pitch: 0,
    position: new THREE.Vector3(),
    speed: BASE_SPEED,
    locked: false,
    flying: false,
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!state.locked) return
    held.add(event.code)
    // Space scrolls the page and Tab leaves the canvas; neither is wanted
    // while flying, and both are hard to notice going wrong.
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault()
    }
    // Asking to go up is asking to fly, so there is no separate mode key to
    // find. G is the way back down to the ground.
    if (UP.has(event.code) || DOWN.has(event.code)) state.flying = true
    if (event.code === 'KeyG') state.flying = false
  }
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.code)

  const onMouseMove = (event: MouseEvent) => {
    if (!state.locked) return
    state.yaw -= event.movementX * LOOK
    state.pitch -= event.movementY * LOOK
    state.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, state.pitch))
  }

  const onLock = () => {
    state.locked = document.pointerLockElement === canvas
    // Keys held when the pointer unlocks would otherwise stay held forever,
    // and the camera would drift off on its own the next time it locked.
    if (!state.locked) held.clear()
    onLockChange(state.locked)
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('pointerlockchange', onLock)

  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const move = new THREE.Vector3()

  return {
    state,
    update(delta, camera, groundAt) {
      // Orientation is applied whether or not a key is down, so a mouse-look
      // with no movement still turns the view.
      camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ')

      let moved = false
      if (state.locked) {
        const fast = held.has('ShiftLeft') || held.has('ShiftRight')
        const speed = BASE_SPEED * (fast ? FAST_MULTIPLIER : 1)
        state.speed = speed

        // Forward is the look direction flattened: pitching down should not
        // drive the camera into the ground when W is held.
        forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw))
        right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw))
        move.set(0, 0, 0)

        if (held.has('KeyW')) move.add(forward)
        if (held.has('KeyS')) move.sub(forward)
        if (held.has('KeyD')) move.add(right)
        if (held.has('KeyA')) move.sub(right)
        if (state.flying) {
          for (const code of held) {
            if (UP.has(code)) move.y += 1
            if (DOWN.has(code)) move.y -= 1
          }
        }

        if (move.lengthSq() > 0) {
          // Normalised, or holding W and D would be 1.41× the speed of either.
          move.normalize().multiplyScalar(speed * delta)
          state.position.add(move)
          moved = true
        }
      }

      const ground = groundAt(state.position.x, state.position.z)
      if (state.flying) {
        const floor = ground + FLOOR
        if (state.position.y < floor) {
          state.position.y = floor
          moved = true
        }
      } else {
        // Eased, not pinned: following the surface exactly makes a sprint over
        // broken ground jitter, because the eye tracks every lump. A drop of
        // more than a few units is taken at once, so stepping off a cliff is a
        // fall rather than a long glide.
        const target = ground + EYE
        const gap = target - state.position.y
        if (Math.abs(gap) > 0.001) {
          state.position.y += gap * Math.min(1, delta * (Math.abs(gap) > 12 ? 9 : 14))
          moved = true
        }
      }
      camera.position.copy(state.position)
      return moved
    },
    request() {
      // Chrome returns a promise here and rejects it when the lock cannot be
      // taken — most often because the pointer was released seconds ago and
      // the browser is rate-limiting re-entry. Unhandled, that surfaces as an
      // uncaught error in the console during a presentation. The curtain is
      // still up when this fails, so the recovery is simply to click again.
      const result = canvas.requestPointerLock() as unknown
      if (result instanceof Promise) result.catch(() => {})
    },
    release() {
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLock)
      held.clear()
    },
  }
}

export const EYE_HEIGHT = EYE
