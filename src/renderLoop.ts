/**
 * The render loop every viewport runs on.
 *
 * Two things it does that a bare `requestAnimationFrame` chain does not.
 *
 * **It stops when nothing is changing.** Each viewport's frame function
 * returns whether the view is still in motion — an auto-spin turning, a camera
 * still settling under damping, a simulation stepping. When it returns false
 * the loop goes idle and schedules nothing at all, and the next `wake()`
 * starts it again. Measured before this existed: a paused simulation and a
 * motionless shading study both still issued a full-screen pass every frame,
 * drawing an image identical to the one already on screen.
 *
 * **It has a frame budget.** `requestAnimationFrame` fires at the display's
 * refresh rate, which on a recent Mac is 120 Hz — twice the work for motion
 * none of these views resolve. 60 is the cap.
 *
 * The risk in going idle is a view that never wakes, so waking is deliberately
 * over-eager: any pointer movement anywhere wakes every loop. A frame that
 * finds nothing to do costs one `render` and goes straight back to sleep,
 * which is far cheaper than the alternative of being wrong.
 */

export type RenderLoop = {
  /** Draw at least one more frame, restarting the loop if it had stopped. */
  wake(): void
  dispose(): void
}

const DEFAULT_FPS = 60

export function startRenderLoop(
  /** Advances and draws one frame. Returns true while the view is still moving. */
  frame: (delta: number) => boolean,
  maxFps = DEFAULT_FPS,
): RenderLoop {
  // A millisecond under the exact interval: a frame that arrives a fraction
  // early would otherwise be skipped, halving 60 Hz to 30.
  const minInterval = 1000 / maxFps - 1
  let handle = 0
  let last = 0
  let disposed = false

  const schedule = () => {
    if (handle === 0 && !disposed) handle = requestAnimationFrame(tick)
  }

  const tick = (now: number) => {
    handle = 0
    if (disposed) return
    if (last !== 0 && now - last < minInterval) {
      schedule()
      return
    }
    // Clamped so a tab resuming after minutes in the background does not
    // advance a simulation by one enormous step.
    const delta = last === 0 ? 1 / maxFps : Math.min((now - last) / 1000, 0.1)
    last = now
    // Not scheduling is the whole point: when the frame reports nothing is
    // moving, the chain ends here and `wake` is the only thing that restarts it.
    if (frame(delta)) schedule()
  }

  schedule()

  return {
    wake() {
      // `schedule` is a no-op while a frame is already pending, so this is
      // safe to call as often as input arrives.
      schedule()
    },
    dispose() {
      disposed = true
      if (handle !== 0) cancelAnimationFrame(handle)
      handle = 0
    },
  }
}

/**
 * Wakes a loop on the input that can move a camera or drag a control.
 *
 * Listened for on the window rather than the canvas on purpose. Topic 1's
 * orientation gizmo is a second canvas that mutates the quaternion the main
 * scene reads, so a drag there has to wake a loop it knows nothing about.
 * These events only fire while a pointer is actually moving.
 */
export function wakeOnInput(loop: RenderLoop): () => void {
  const wake = () => loop.wake()
  const names = ['pointermove', 'pointerup', 'wheel'] as const
  for (const name of names) window.addEventListener(name, wake, { passive: true })
  return () => {
    for (const name of names) window.removeEventListener(name, wake)
  }
}

type Vec3 = { x: number; y: number; z: number }

/**
 * Whether a camera moved enough to be worth another frame.
 *
 * `OrbitControls.update()` reports movement down to its own 1e-6 epsilon, and
 * with damping the residual decays by 5% per frame — so trusting it keeps a
 * loop awake for roughly 250 frames after a drag, rendering motion several
 * orders of magnitude below one pixel. Measured: an orbit on the shading study
 * was still reporting movement four seconds after the pointer was released.
 *
 * This gates on a threshold the eye can actually resolve. The default is
 * scaled to these scenes: cameras sit three to ten units out across a viewport
 * roughly a thousand pixels wide, which puts one pixel at a few thousandths of
 * a world unit. Tighter than that and the gate never closes; looser and an
 * orbit visibly stutters to a halt.
 *
 * The first call always reports movement, so a fresh viewport draws at least
 * once.
 */
export function createCameraGate(threshold = 3e-3) {
  let px = NaN, py = NaN, pz = NaN
  let tx = NaN, ty = NaN, tz = NaN
  return (position: Vec3, target: Vec3): boolean => {
    const moved =
      !(Math.hypot(position.x - px, position.y - py, position.z - pz) <= threshold) ||
      !(Math.hypot(target.x - tx, target.y - ty, target.z - tz) <= threshold)
    px = position.x; py = position.y; pz = position.z
    tx = target.x; ty = target.y; tz = target.z
    return moved
  }
}
