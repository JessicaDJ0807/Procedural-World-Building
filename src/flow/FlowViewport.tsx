import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { startRenderLoop, wakeOnInput, type RenderLoop } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import type { FlowSettings } from '../config/flowConfig'
import { FlowField, type Vortex } from './field'
import { MAX_PARTICLES, Particles } from './particles'

export type FlowReport = {
  fps: number
  stepMs: number
  particles: number
  evaluations: number
  stirs: number
  divergence: { maxDiv: number; meanGrad: number }
}

type Props = {
  settings: FlowSettings
  running: boolean
  /** Changing this value respawns every particle and clears the trails. */
  resetToken: number
  onReport: (report: FlowReport) => void
  onVortexMove: (index: number, vortex: Vortex) => void
}

const MAX_ARROWS = 1400
const RING_SEGMENTS = 48
const MAX_STIRS = 48
/** Screen pixels within which a press grabs a vortex centre. */
const GRAB = 16

/**
 * Trails by accumulation rather than by geometry.
 *
 * Each frame draws one short segment per particle — where it was to where it
 * is — into an off-screen buffer that is never cleared, only faded toward the
 * background. A streak is what is left of the last few dozen segments. The
 * alternative, a polyline of history per particle, would need N × trail-length
 * vertices rewritten every frame; this needs N segments and one full-screen
 * quad, at any trail length.
 *
 * The buffer is half-float. In an 8-bit buffer the fade stalls: a channel at 3
 * multiplied by 0.94 rounds back to 3, so faint trails never reach the
 * background and the screen slowly fills with permanent grey ghosts of every
 * path ever taken.
 */
export function FlowViewport({ settings, running, resetToken, onReport, onVortexMove }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ settings, running, onReport, onVortexMove })
  const engineRef = useRef<{
    field: FlowField
    particles: Particles
    loop: RenderLoop
    clear: () => void
    /** Pushes the latest settings into the running field and particles. */
    apply: () => void
  } | null>(null)

  useEffect(() => {
    latest.current = { settings, running, onReport, onVortexMove }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.autoClear = false
    container.appendChild(renderer.domElement)

    let aspect = container.clientWidth / Math.max(container.clientHeight, 1)
    const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, -1, 1)

    const field = new FlowField()
    field.aspect = aspect
    const particles = new Particles(latest.current.settings.seed)
    particles.resize(latest.current.settings.particles, aspect)

    // --- accumulation ---
    const size = new THREE.Vector2()
    const makeTarget = () => {
      renderer.getDrawingBufferSize(size)
      return new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false })
    }
    let target = makeTarget()
    const background = new THREE.Color(VIEWPORT_BACKGROUND)
    const clear = () => {
      renderer.setRenderTarget(target)
      renderer.setClearColor(background, 1)
      renderer.clear()
      renderer.setRenderTarget(null)
    }
    clear()

    const quad = new THREE.PlaneGeometry(2, 2)
    const fadeMaterial = new THREE.MeshBasicMaterial({ color: background, transparent: true, opacity: 0.06, depthTest: false })
    const fadeScene = new THREE.Scene()
    const fadeQuad = new THREE.Mesh(quad, fadeMaterial)
    fadeScene.add(fadeQuad)
    const unitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)

    const segmentPositions = new Float32Array(MAX_PARTICLES * 6)
    const segmentColours = new Float32Array(MAX_PARTICLES * 6)
    const segmentGeometry = new THREE.BufferGeometry()
    segmentGeometry.setAttribute('position', new THREE.BufferAttribute(segmentPositions, 3).setUsage(THREE.DynamicDrawUsage))
    segmentGeometry.setAttribute('color', new THREE.BufferAttribute(segmentColours, 3).setUsage(THREE.DynamicDrawUsage))
    const segmentMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
    })
    const segments = new THREE.LineSegments(segmentGeometry, segmentMaterial)
    segments.frustumCulled = false
    const particleScene = new THREE.Scene()
    particleScene.add(segments)

    const displayMaterial = new THREE.MeshBasicMaterial({ map: target.texture, depthTest: false })
    const displayScene = new THREE.Scene()
    displayScene.add(new THREE.Mesh(quad, displayMaterial))

    // --- overlays: the field's arrows, and the vortex handles ---
    const arrowPositions = new Float32Array(MAX_ARROWS * 6 * 3)
    const arrowGeometry = new THREE.BufferGeometry()
    arrowGeometry.setAttribute('position', new THREE.BufferAttribute(arrowPositions, 3).setUsage(THREE.DynamicDrawUsage))
    const arrows = new THREE.LineSegments(
      arrowGeometry,
      new THREE.LineBasicMaterial({ color: 0xe6e8ea, transparent: true, opacity: 0.9, depthTest: false }),
    )
    arrows.frustumCulled = false

    // Per vortex: half the ring segments (dashed), two chevron strokes, two
    // for the cross — 28 segments at 48, sized with room to spare.
    const ringPositions = new Float32Array(12 * (RING_SEGMENTS + 4) * 6)
    const ringGeometry = new THREE.BufferGeometry()
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3).setUsage(THREE.DynamicDrawUsage))
    const rings = new THREE.LineSegments(
      ringGeometry,
      new THREE.LineBasicMaterial({ color: 0xc4d4ea, transparent: true, opacity: 0.85, depthTest: false }),
    )
    rings.frustumCulled = false
    const overlayScene = new THREE.Scene()
    overlayScene.add(arrows, rings)

    let dragVortex = -1
    let divergence = field.divergence()

    const applySettings = () => {
      const s = latest.current.settings
      field.params = { current: s.current, vortexStrength: s.vortexStrength, vortexRadius: s.vortexRadius, noise: s.noise }
      // While a vortex is being dragged the field holds the live position;
      // the page's copy catches up on release.
      if (dragVortex < 0) field.vortices = s.vortices.map((v) => ({ ...v }))
      field.noiseSeed = s.seed
      particles.resize(s.particles, aspect)
    }
    applySettings()

    let frames = 0
    let since = performance.now()
    let stepCost = 0
    let evaluations = 0
    let lastFps = 0
    let lastStep = 0

    const loop = startRenderLoop((delta) => {
      const { settings: s, running: run } = latest.current
      const dt = delta * s.speed

      field.aspect = aspect
      field.prepare()
      if (run) {
        const started = performance.now()
        field.time += dt
        evaluations = particles.step(field, dt, aspect)
        field.decay(delta)
        particles.writeSegments(segmentPositions, segmentColours, 1 / Math.max(s.current + s.vortexStrength, 0.2))
        segmentGeometry.setDrawRange(0, particles.count * 2)
        segmentGeometry.attributes.position.needsUpdate = true
        segmentGeometry.attributes.color.needsUpdate = true
        stepCost += performance.now() - started

        // Persistence is per sixtieth of a second, raised to the real frame
        // time, so a 30 fps laptop draws trails the same length as a 120 Hz
        // display rather than half as long.
        fadeMaterial.opacity = 1 - Math.pow(s.persistence, delta * 60)
        renderer.setRenderTarget(target)
        renderer.render(fadeScene, unitCamera)
        renderer.render(particleScene, camera)
      }

      renderer.setRenderTarget(null)
      renderer.clear()
      // The trails step back while the arrows are up: at full brightness the
      // arrows were lost in them, and the point of the overlay is to compare
      // the two.
      displayMaterial.color.setScalar(s.showField ? 0.4 : 1)
      renderer.render(displayScene, unitCamera)
      arrows.visible = s.showField
      rings.visible = s.showHandles
      if (s.showField) writeArrows(field, aspect, arrowPositions, arrowGeometry)
      if (s.showHandles) writeRings(field, ringPositions, ringGeometry)
      renderer.render(overlayScene, camera)

      frames += 1
      const now = performance.now()
      if (now - since > 500 || !run) {
        // Averaged before the counters reset. The first version divided by
        // the frame count after zeroing it, and reported the half-second's
        // total — 381.9 ms per step beside 38 frames/s.
        if (now - since > 500) {
          lastFps = (frames * 1000) / (now - since)
          lastStep = stepCost / frames
          frames = 0
          stepCost = 0
          since = now
        }
        latest.current.onReport({
          fps: lastFps,
          stepMs: run ? lastStep : 0,
          particles: particles.count,
          evaluations: run ? evaluations : 0,
          stirs: field.stirs.length,
          divergence,
        })
      }
      return run
    })

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      aspect = w / h
      camera.left = -aspect
      camera.right = aspect
      camera.updateProjectionMatrix()
      field.aspect = aspect
      // The old buffer is the wrong size and its pixels are in the wrong
      // places; starting the trails over is honest, stretching them is not.
      target.dispose()
      target = makeTarget()
      displayMaterial.map = target.texture
      clear()
      loop.wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const stopWaking = wakeOnInput(loop)

    // A settings change re-measures the divergence: the check runs over a
    // 48 × 32 grid, so it is done when the field changes, not every frame.
    const apply = () => {
      applySettings()
      divergence = field.divergence()
      loop.wake()
    }
    engineRef.current = { field, particles, loop, clear, apply }

    // --- pointer: drag a vortex centre, or stir the fluid ---
    const toWorld = (event: PointerEvent): [number, number, number, number] => {
      const rect = container.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      return [(sx / rect.width) * 2 * aspect - aspect, 1 - (sy / rect.height) * 2, sx, sy]
    }
    const vortexAt = (sx: number, sy: number) => {
      const rect = container.getBoundingClientRect()
      let best = -1
      let bestD = GRAB
      field.vortices.forEach((v, i) => {
        const d = Math.hypot(v.u * rect.width - sx, (1 - v.v) * rect.height - sy)
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best
    }

    let stirring = false
    let lastX = 0
    let lastY = 0
    let lastT = 0
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      const [x, y, sx, sy] = toWorld(event)
      container.setPointerCapture(event.pointerId)
      dragVortex = latest.current.settings.showHandles ? vortexAt(sx, sy) : -1
      stirring = dragVortex < 0
      lastX = x
      lastY = y
      lastT = performance.now()
      loop.wake()
    }
    const move = (event: PointerEvent) => {
      const [x, y, sx, sy] = toWorld(event)
      if (dragVortex >= 0) {
        const v = field.vortices[dragVortex]
        v.u = Math.min(0.98, Math.max(0.02, (x + aspect) / (2 * aspect)))
        v.v = Math.min(0.98, Math.max(0.02, (y + 1) / 2))
        loop.wake()
        return
      }
      if (!stirring) {
        container.style.cursor = latest.current.settings.showHandles && vortexAt(sx, sy) >= 0 ? 'grab' : ''
        return
      }
      const now = performance.now()
      const dt = (now - lastT) / 1000
      if (dt < 0.03) return
      // The drag's own velocity, clamped: a flick should stir hard, not
      // launch every particle in the frame across it in one step.
      let ux = (x - lastX) / dt
      let uy = (y - lastY) / dt
      const speed = Math.hypot(ux, uy)
      const cap = 3
      if (speed > cap) {
        ux *= cap / speed
        uy *= cap / speed
      }
      field.stirs.push({ x, y, ux, uy, radius: 0.16, life: 1 })
      if (field.stirs.length > MAX_STIRS) field.stirs.shift()
      lastX = x
      lastY = y
      lastT = now
      loop.wake()
    }
    const up = (event: PointerEvent) => {
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
      if (dragVortex >= 0) {
        const index = dragVortex
        dragVortex = -1
        latest.current.onVortexMove(index, { ...field.vortices[index] })
        divergence = field.divergence()
      }
      stirring = false
    }
    container.addEventListener('pointerdown', down)
    container.addEventListener('pointermove', move)
    container.addEventListener('pointerup', up)
    container.addEventListener('pointercancel', up)

    return () => {
      container.removeEventListener('pointerdown', down)
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerup', up)
      container.removeEventListener('pointercancel', up)
      stopWaking()
      loop.dispose()
      observer.disconnect()
      target.dispose()
      quad.dispose()
      fadeMaterial.dispose()
      segmentGeometry.dispose()
      segmentMaterial.dispose()
      displayMaterial.dispose()
      arrowGeometry.dispose()
      ;(arrows.material as THREE.Material).dispose()
      ringGeometry.dispose()
      ;(rings.material as THREE.Material).dispose()
      engineRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // Settings reach the running engine without rebuilding it: the particles and
  // the trails they have drawn are the state worth keeping.
  useEffect(() => {
    engineRef.current?.apply()
  }, [settings])

  useEffect(() => {
    engineRef.current?.loop.wake()
  }, [running])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || resetToken === 0) return
    const count = engine.particles.count
    engine.particles.reseed(latest.current.settings.seed)
    engine.particles.count = 0
    engine.particles.resize(count, engine.field.aspect)
    engine.field.stirs = []
    engine.field.time = 0
    engine.clear()
    engine.loop.wake()
  }, [resetToken])

  return <div ref={containerRef} className="shader-viewport flow-viewport" />
}

const sample = new Float32Array(2)

/**
 * A sparse grid of arrows, each the field's velocity at its tail.
 *
 * Length saturates (tanh) rather than scaling linearly: the core of a strong
 * vortex is several times faster than the current, and linear arrows would
 * either be invisible in the current or overlap their neighbours at the core.
 */
function writeArrows(field: FlowField, aspect: number, out: Float32Array, geometry: THREE.BufferGeometry) {
  const rows = 18
  const cols = Math.max(1, Math.round(rows * aspect))
  const spacing = 2 / rows
  const ref = Math.max(field.params.current, 0.25)
  let n = 0
  for (let j = 0; j < rows && n < MAX_ARROWS; j++) {
    for (let i = 0; i < cols && n < MAX_ARROWS; i++) {
      const x = ((i + 0.5) / cols) * 2 * aspect - aspect
      const y = ((j + 0.5) / rows) * 2 - 1
      field.sample(x, y, sample)
      const speed = Math.hypot(sample[0], sample[1])
      if (speed < 1e-5) continue
      const len = spacing * 0.85 * Math.tanh(speed / (ref * 1.5))
      const dx = sample[0] / speed
      const dy = sample[1] / speed
      // Centred on the grid point, so the grid stays a grid.
      const x0 = x - dx * len * 0.5
      const y0 = y - dy * len * 0.5
      const x1 = x + dx * len * 0.5
      const y1 = y + dy * len * 0.5
      const head = len * 0.32
      const c = Math.cos(2.6)
      const s = Math.sin(2.6)
      const o = n * 18
      out.set([x0, y0, 0, x1, y1, 0], o)
      out.set([x1, y1, 0, x1 + (dx * c - dy * s) * head, y1 + (dx * s + dy * c) * head, 0], o + 6)
      out.set([x1, y1, 0, x1 + (dx * c + dy * s) * head, y1 + (-dx * s + dy * c) * head, 0], o + 12)
      n++
    }
  }
  geometry.setDrawRange(0, n * 6)
  geometry.attributes.position.needsUpdate = true
}

/** A ring at each vortex's radius of peak speed, and a chevron giving its spin. */
function writeRings(field: FlowField, out: Float32Array, geometry: THREE.BufferGeometry) {
  let k = 0
  const push = (x0: number, y0: number, x1: number, y1: number) => {
    out.set([x0, y0, 0, x1, y1, 0], k)
    k += 6
  }
  for (const v of field.vortices.slice(0, 12)) {
    const cx = (v.u * 2 - 1) * field.aspect
    const cy = v.v * 2 - 1
    const r = field.params.vortexRadius * v.radius
    for (let i = 0; i < RING_SEGMENTS; i++) {
      // Dashed: every other segment, so the ring reads as a guide, not an object.
      if (i % 2 === 1) continue
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2
      const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
      push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
    }
    // Chevron at the top of the ring, pointing the way the fluid turns there:
    // left for counter-clockwise, right for clockwise.
    const tip = r * 0.35 * -v.spin
    const h = r * 0.22
    push(cx + tip, cy + r, cx - tip * 0.2 + 0, cy + r + h)
    push(cx + tip, cy + r, cx - tip * 0.2 + 0, cy + r - h)
    // The grab point.
    const d = 0.018
    push(cx - d, cy, cx + d, cy)
    push(cx, cy - d, cx, cy + d)
  }
  geometry.setDrawRange(0, k / 3)
  geometry.attributes.position.needsUpdate = true
}
