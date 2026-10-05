import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { fieldUvFromNdc } from './gpu/core'
import { createSimulation } from './gpu'
import { startRenderLoop, wakeOnInput, type RenderLoop } from './renderLoop'
import type { Pointer, Simulation, Stat } from './gpu/simulation'

type ShaderViewportProps = {
  simulationId: string
  params: Record<string, number>
  running: boolean
  /** Changing this value reseeds the simulation. */
  resetToken: number
  /** Changing this value advances exactly one frame while paused. */
  stepToken: number
  onReport: (report: { stats: Stat[]; fps: number; ms: number }) => void
}

export function ShaderViewport({
  simulationId,
  params,
  running,
  resetToken,
  stepToken,
  onReport,
}: ShaderViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Everything the render loop reads lives in a ref. A simulation accumulates
  // state across frames, so rebuilding it whenever a slider moved would throw
  // away the thing the page exists to show. The refs are synced in an effect
  // rather than assigned during render, which is what the same pattern in
  // Topic 2's and Topic 3's viewports does — and that effect is declared after
  // the one that builds the loop, so the loop exists before anything wakes it.
  const paramsRef = useRef(params)
  const runningRef = useRef(running)
  const reportRef = useRef(onReport)

  const pointerRef = useRef<Pointer>({ x: -1, y: -1, ndcX: 0, ndcY: 0, active: false })
  const simRef = useRef<Simulation | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const stepOnceRef = useRef(0)
  const loopRef = useRef<RenderLoop | null>(null)

  // The renderer and the loop outlive every simulation switch: creating a
  // WebGL context per strategy would leak contexts, and browsers cap how many
  // may exist at once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    // Float render targets are what every simulation here stores its state in.
    renderer.getContext().getExtension('EXT_color_buffer_float')
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      renderer.setSize(clientWidth, clientHeight)
      simRef.current?.resize(clientWidth, clientHeight)
      loopRef.current?.wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    let frames = 0
    let since = performance.now()
    let cost = 0

    const loop = startRenderLoop(() => {
      const sim = simRef.current
      if (!sim) return false

      const advance = runningRef.current || stepOnceRef.current > 0
      if (stepOnceRef.current > 0) stepOnceRef.current -= 1

      const started = performance.now()
      if (advance) sim.step(paramsRef.current, pointerRef.current)
      sim.draw(renderer, paramsRef.current)
      cost += performance.now() - started

      frames += 1
      const now = performance.now()
      if (now - since > 500) {
        reportRef.current({
          stats: sim.stats(),
          fps: (frames * 1000) / (now - since),
          ms: cost / frames,
        })
        frames = 0
        cost = 0
        since = now
      }

      // Keep going while the simulation is accumulating state, or while the
      // view is still moving on its own. Both false means this was the last
      // frame until something wakes the loop.
      const stepping = advance && (sim.accumulates ?? true)
      return stepping || (sim.animating?.(paramsRef.current) ?? false)
    })
    loopRef.current = loop
    const stopWaking = wakeOnInput(loop)

    return () => {
      stopWaking()
      loop.dispose()
      loopRef.current = null
      observer.disconnect()
      simRef.current?.dispose()
      simRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    paramsRef.current = params
    runningRef.current = running
    reportRef.current = onReport
    // A parameter moved, or the run was started: the view is out of date even
    // if nothing is animating.
    loopRef.current?.wake()
  }, [params, running, onReport])

  // Swapping the strategy: tear the old one down completely, including its
  // render targets, before the new one allocates its own.
  useEffect(() => {
    const renderer = rendererRef.current
    const container = containerRef.current
    if (!renderer || !container) return

    simRef.current?.dispose()
    const sim = createSimulation(simulationId)
    sim.init(renderer, renderer.domElement)
    sim.resize(container.clientWidth, container.clientHeight)
    simRef.current = sim
    loopRef.current?.wake()

    return () => {
      sim.dispose()
      if (simRef.current === sim) simRef.current = null
    }
  }, [simulationId])

  useEffect(() => {
    if (resetToken === 0) return
    simRef.current?.reset(paramsRef.current)
    loopRef.current?.wake()
  }, [resetToken])

  useEffect(() => {
    if (stepToken === 0) return
    stepOnceRef.current += 1
    loopRef.current?.wake()
  }, [stepToken])

  // Pointer input is read by the loop rather than pushed through state: a
  // pointermove fires far more often than a frame, and every one of those
  // would otherwise be a React render.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const update = (event: PointerEvent, active: boolean) => {
      const rect = container.getBoundingClientRect()
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      const field = fieldUvFromNdc(ndcX, ndcY, rect.width, rect.height)
      pointerRef.current = { x: field.x, y: field.y, ndcX, ndcY, active }
      loopRef.current?.wake()
    }

    const down = (event: PointerEvent) => {
      container.setPointerCapture(event.pointerId)
      update(event, true)
    }
    const move = (event: PointerEvent) => update(event, pointerRef.current.active)
    const up = (event: PointerEvent) => {
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId)
      }
      update(event, false)
    }

    container.addEventListener('pointerdown', down)
    container.addEventListener('pointermove', move)
    container.addEventListener('pointerup', up)
    container.addEventListener('pointerleave', up)
    return () => {
      container.removeEventListener('pointerdown', down)
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerup', up)
      container.removeEventListener('pointerleave', up)
    }
  }, [])

  return <div ref={containerRef} className="shader-viewport" />
}
