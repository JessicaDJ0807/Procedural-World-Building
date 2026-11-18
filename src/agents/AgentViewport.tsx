import { useEffect, useRef } from 'react'
import { startRenderLoop, wakeOnInput } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import type { AgentSettings } from '../config/agentConfig'
import { MAX_PLACED } from '../config/agentConfig'
import {
  PLACED_RADIUS,
  WALL_X1,
  WORLD_H,
  WORLD_W,
  buildEnvironment,
  canPlace,
  cellOf,
  gapClosedBy,
  snapToGap,
  type Circle,
} from './environment'
import { STATE_COLOURS } from './colours'
import { DT, SENSE_DISTANCE, Simulation, type AgentState, type Decision } from './simulation'

export type Tool = 'inspect' | 'block'

/** What the page shows about one agent, copied out of the simulation — never computed for display. */
export type AgentSnapshot = {
  id: number
  state: AgentState
  stateTime: number
  origin: string
  target: string
  velocity: number
  walkSpeed: number
  influence: number
  exploration: number
  decision: Decision
  trips: number
  tripTime: number
  tripDistance: number
  /** Shortest walkable distance from where it stands to its target. */
  remaining: number
}

export type AgentReport = {
  time: number
  fps: number
  stepMs: number
  counts: Record<AgentState, number>
  agents: number
  trips: number
  summary: ReturnType<Simulation['tripSummary']>
  gapShares: number[]
  crossings: number
  concentration: number
  history: number[]
  selected: AgentSnapshot | null
}

type Props = {
  settings: AgentSettings
  running: boolean
  /** Changing it restarts the run from the seed. */
  resetToken: number
  /** Changing it zeroes the trail field and nothing else. */
  clearToken: number
  tool: Tool
  selected: number
  onSelect: (id: number) => void
  onPlacedChange: (placed: Circle[]) => void
  onNotice: (notice: string) => void
  onReport: (report: AgentReport) => void
}

const TRAIL_RGB = [232, 160, 72]
/** Trail value at which the heatmap is 63% of the way to full: a well-used path, not a single pass. */
const TRAIL_DISPLAY = 6
const GROUND = '#202326'
const OBSTACLE = '#3d424a'
const OBSTACLE_EDGE = '#555b64'
const PLACED = '#5a4c40'
const DESTINATION = '#e6e8ea'
const REPORT_INTERVAL = 250
/** Never more than this many steps in one frame: after a stall, the run slows rather than freezing the tab to catch up. */
const MAX_STEPS = 6

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/**
 * Canvas 2D rather than three.js.
 *
 * Every other topic draws with WebGL because it has a surface to light or
 * tens of thousands of particles. This one has a 160 × 100 field, a few
 * hundred triangles and some lines, and needs to answer "which agent is under
 * the pointer" — which in 2D is a distance test in world units. The trail is
 * written into a 160 × 100 image once per frame and scaled up with smoothing,
 * so the heatmap costs the same at any canvas size.
 */
export function AgentViewport(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const simRef = useRef<Simulation | null>(null)
  const wakeRef = useRef<() => void>(() => {})

  useEffect(() => {
    latest.current = props
  })

  // --- one simulation per seed and reset; parameters are pushed into it ---
  const { seed, resetToken } = { seed: props.settings.seed, resetToken: props.resetToken }
  useEffect(() => {
    const s = latest.current.settings
    simRef.current = new Simulation(s.seed, s, s.placed)
    simRef.current.select(latest.current.selected)
    wakeRef.current()
  }, [seed, resetToken])

  const { agents, influence, evaporation, exploration, speed, placed } = props.settings
  useEffect(() => {
    simRef.current?.setParams({ agents, influence, evaporation, exploration, speed })
    wakeRef.current()
  }, [agents, influence, evaporation, exploration, speed])

  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    // A seed change already built this world; only a block edit needs a new one.
    if (sim.env.placed === placed) return
    sim.setEnvironment(buildEnvironment(sim.env.seed, placed))
    wakeRef.current()
  }, [placed])

  useEffect(() => {
    simRef.current?.clearTrails()
    wakeRef.current()
  }, [props.clearToken])

  useEffect(() => {
    simRef.current?.select(props.selected)
    wakeRef.current()
  }, [props.selected])

  useEffect(() => {
    wakeRef.current()
  }, [props.running, props.settings.showTrails, props.settings.showSenses])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const canvas = document.createElement('canvas')
    canvas.className = 'agents-canvas'
    container.appendChild(canvas)
    const ctx = canvas.getContext('2d')!

    // The trail at its own resolution, one pixel per cell.
    const heat = document.createElement('canvas')
    heat.width = WORLD_W
    heat.height = WORLD_H
    const heatCtx = heat.getContext('2d')!
    const heatImage = heatCtx.createImageData(WORLD_W, WORLD_H)

    // Ground and obstacles change only when the world does, so they are drawn once into a layer.
    const ground = document.createElement('canvas')
    const groundCtx = ground.getContext('2d')!
    let groundKey = ''

    let dpr = 1
    let scale = 1
    let ox = 0
    let oy = 0
    const layout = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = container.clientWidth
      const h = container.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      // Letterboxed: the world keeps its 1.6 : 1 and the margin takes the rest.
      const margin = w < 520 ? 8 : 20
      scale = Math.max(0.1, Math.min((w - 2 * margin) / WORLD_W, (h - 2 * margin) / WORLD_H))
      ox = (w - WORLD_W * scale) / 2
      oy = (h - WORLD_H * scale) / 2
      groundKey = ''
    }
    layout()

    const toWorld = (clientX: number, clientY: number) => {
      const box = canvas.getBoundingClientRect()
      return { x: (clientX - box.left - ox) / scale, y: (clientY - box.top - oy) / scale }
    }

    const drawGround = (sim: Simulation) => {
      const key = `${canvas.width}x${canvas.height}:${sim.env.seed}:${sim.env.placed.map((c) => `${c.x},${c.y}`).join(';')}`
      if (key === groundKey) return
      groundKey = key
      ground.width = canvas.width
      ground.height = canvas.height
      const g = groundCtx
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = hex(VIEWPORT_BACKGROUND)
      g.fillRect(0, 0, ground.width, ground.height)
      g.translate(ox, oy)
      g.scale(scale, scale)
      g.fillStyle = GROUND
      g.fillRect(0, 0, WORLD_W, WORLD_H)
      g.fillStyle = OBSTACLE
      g.strokeStyle = OBSTACLE_EDGE
      g.lineWidth = 0.3
      // The border, the wall between its gaps, and the spur: drawn from the
      // raster, so what is drawn is exactly what blocks.
      const blocked = sim.env.blocked
      const inShapes = (x: number, y: number) =>
        [...sim.env.rocks, ...sim.env.placed].some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r)
      for (let j = 0; j < WORLD_H; j++) {
        for (let i = 0; i < WORLD_W; i++) {
          if (!blocked[j * WORLD_W + i] || inShapes(i + 0.5, j + 0.5)) continue
          g.fillRect(i - 0.02, j - 0.02, 1.04, 1.04)
        }
      }
      for (const c of sim.env.rocks) {
        g.beginPath()
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        g.fill()
        g.stroke()
      }
      g.fillStyle = PLACED
      g.setLineDash([0.8, 0.6])
      g.strokeStyle = '#a08870'
      for (const c of sim.env.placed) {
        g.beginPath()
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        g.fill()
        g.stroke()
      }
      g.setLineDash([])
      g.setTransform(1, 0, 0, 1, 0, 0)
    }

    const drawHeat = (sim: Simulation) => {
      const data = sim.trail.data
      const px = heatImage.data
      for (let c = 0; c < data.length; c++) {
        const v = 1 - Math.exp(-data[c] / TRAIL_DISPLAY)
        const o = c * 4
        px[o] = TRAIL_RGB[0]
        px[o + 1] = TRAIL_RGB[1]
        px[o + 2] = TRAIL_RGB[2]
        // Capped below opaque so an agent on the busiest path still reads against it.
        px[o + 3] = Math.round(v * 0.8 * 255)
      }
      heatCtx.putImageData(heatImage, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(heat, 0, 0, WORLD_W, WORLD_H)
    }

    const draw = () => {
      const sim = simRef.current
      if (!sim) return
      const { settings } = latest.current
      drawGround(sim)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(ground, 0, 0)
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)
      if (settings.showTrails) drawHeat(sim)

      // Route usage, written at each gap.
      const shares = sim.gapShares()
      const crossed = sim.recentCrossings.length > 0
      ctx.font = `600 ${11 / scale}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      sim.env.gaps.forEach((g, i) => {
        const y = (g.y0 + g.y1) / 2
        const blockedNow = sim.env.placed.some((c) => gapClosedBy(sim.env, c) === i)
        const label = blockedNow ? 'closed' : crossed ? `${Math.round(shares[i] * 100)}%` : ''
        if (!label) return
        const w = (label.length * 6.4 + 10) / scale
        const h = 15 / scale
        const x = WALL_X1 + 1 + w / 2
        ctx.fillStyle = 'rgba(20, 21, 23, 0.82)'
        ctx.beginPath()
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 4 / scale)
        ctx.fill()
        ctx.fillStyle = blockedNow ? '#c9a27e' : '#d8dadc'
        ctx.fillText(label, x, y + 0.5 / scale)
      })

      // Destinations.
      for (const d of sim.env.destinations) {
        ctx.fillStyle = 'rgba(230, 232, 234, 0.06)'
        ctx.strokeStyle = DESTINATION
        ctx.lineWidth = 1.6 / scale
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = DESTINATION
        ctx.font = `600 ${13 / scale}px system-ui, sans-serif`
        ctx.fillText(d.label, d.x, d.y - d.r - 8 / scale)
      }

      const sel = sim.agents.find((a) => a.id === sim.selected)

      // The selected agent's recent route, under everyone.
      if (sel && sim.path.length > 1) {
        ctx.strokeStyle = 'rgba(244, 241, 234, 0.45)'
        ctx.lineWidth = 1.2 / scale
        ctx.setLineDash([3 / scale, 3 / scale])
        ctx.beginPath()
        sim.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.lineTo(sel.x, sel.y)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Agents: one path per state colour, so four fills however many agents there are.
      // Never smaller than about 7 px long, so a phone-width canvas still shows heading.
      const len = Math.max(1.4, 7 / scale)
      const half = len * 0.36
      for (const state of ['rest', 'idle', 'explore', 'navigate'] as AgentState[]) {
        ctx.beginPath()
        for (const a of sim.agents) {
          if (a.state !== state) continue
          const c = Math.cos(a.heading)
          const s = Math.sin(a.heading)
          ctx.moveTo(a.x + c * len * 0.6, a.y + s * len * 0.6)
          ctx.lineTo(a.x - c * len * 0.4 - s * half, a.y - s * len * 0.4 + c * half)
          ctx.lineTo(a.x - c * len * 0.4 + s * half, a.y - s * len * 0.4 - c * half)
          ctx.closePath()
        }
        ctx.fillStyle = STATE_COLOURS[state]
        ctx.strokeStyle = 'rgba(10, 11, 12, 0.55)'
        ctx.lineWidth = 0.8 / scale
        ctx.stroke()
        ctx.fill()
      }

      if (sel && settings.showSenses) {
        const goal = sim.env.destinations[sel.target]
        if (sel.state === 'explore' || sel.state === 'navigate') {
          ctx.strokeStyle = 'rgba(230, 232, 234, 0.35)'
          ctx.lineWidth = 1 / scale
          ctx.setLineDash([2 / scale, 4 / scale])
          ctx.beginPath()
          ctx.moveTo(sel.x, sel.y)
          ctx.lineTo(goal.x, goal.y)
          ctx.stroke()
          ctx.setLineDash([])
        }
        // The fan it looked along at its last decision, each ray as bright as
        // the chance it was given; struck-out headings in red.
        const probe = sim.probe
        if (probe && sel.decision.kind !== 'sight' && (sel.state === 'explore' || sel.state === 'navigate')) {
          ctx.strokeStyle = 'rgba(230, 232, 234, 0.25)'
          ctx.lineWidth = 1 / scale
          ctx.beginPath()
          ctx.arc(sel.x, sel.y, SENSE_DISTANCE, 0, Math.PI * 2)
          ctx.stroke()
          probe.angles.forEach((angle, k) => {
            const r = probe.blocked[k] ? 3 : SENSE_DISTANCE
            ctx.strokeStyle = probe.blocked[k]
              ? 'rgba(240, 110, 100, 0.85)'
              : `rgba(255, 214, 150, ${0.18 + 0.82 * Math.min(1, probe.probability[k] * 2)})`
            ctx.lineWidth = (k === probe.chosen ? 2.6 : 1.3) / scale
            ctx.beginPath()
            ctx.moveTo(sel.x, sel.y)
            ctx.lineTo(sel.x + Math.cos(angle) * r, sel.y + Math.sin(angle) * r)
            ctx.stroke()
          })
        }
        // Where it is turning to, versus where it faces.
        if (sel.state === 'explore' || sel.state === 'navigate') {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2 / scale
          ctx.beginPath()
          ctx.moveTo(sel.x, sel.y)
          ctx.lineTo(sel.x + Math.cos(sel.desired) * 8, sel.y + Math.sin(sel.desired) * 8)
          ctx.stroke()
        }
      }
      if (sel) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.6 / scale
        ctx.beginPath()
        ctx.arc(sel.x, sel.y, Math.max(2.2, 11 / scale), 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // --- loop ---
    let accumulator = 0
    let frames = 0
    let stepTime = 0
    let steps = 0
    let lastReport = 0
    // Held while paused, when no steps run, so the readout keeps the last real cost.
    let lastStepMs = 0
    const report = (now: number) => {
      const sim = simRef.current
      if (!sim) return
      const elapsed = now - lastReport
      const a = sim.agents.find((x) => x.id === sim.selected)
      const snapshot: AgentSnapshot | null = a
        ? {
            id: a.id,
            state: a.state,
            stateTime: a.stateTime,
            origin: sim.env.destinations[a.origin]?.label ?? '—',
            target: sim.env.destinations[a.target].label,
            velocity: a.velocity,
            walkSpeed: sim.params.speed * a.speedFactor,
            influence: sim.params.influence * a.influenceFactor,
            exploration: Math.min(1, sim.params.exploration * a.curiosityFactor),
            decision: { ...a.decision },
            trips: a.trips,
            tripTime: a.tripTime,
            tripDistance: a.tripDistance,
            remaining: (() => {
              const c = cellOf(a.x, a.y)
              return c >= 0 ? sim.env.distance[a.target][c] : 0
            })(),
          }
        : null
      latest.current.onReport({
        time: sim.time,
        fps: elapsed > 0 ? (frames * 1000) / elapsed : 0,
        stepMs: steps ? (lastStepMs = stepTime / steps) : lastStepMs,
        counts: sim.stateCounts(),
        agents: sim.agents.length,
        trips: sim.tripsCompleted,
        summary: sim.tripSummary(),
        gapShares: sim.gapShares(),
        crossings: sim.recentCrossings.length,
        concentration: sim.history.length ? sim.history[sim.history.length - 1] : 0,
        history: [...sim.history],
        selected: snapshot,
      })
      frames = 0
      steps = 0
      stepTime = 0
      lastReport = now
    }

    const loop = startRenderLoop((delta) => {
      const sim = simRef.current
      const { running } = latest.current
      if (sim && running) {
        // Fixed steps: the run is the same at 30 frames a second and at 60,
        // which is what lets a seed reproduce it.
        accumulator += delta
        const t0 = performance.now()
        let n = 0
        while (accumulator >= DT && n < MAX_STEPS) {
          sim.step()
          accumulator -= DT
          n++
        }
        if (n === MAX_STEPS) accumulator = 0
        stepTime += performance.now() - t0
        steps += n
      } else {
        accumulator = 0
      }
      draw()
      frames++
      const now = performance.now()
      // Paused frames are rare and each one answers a click, so each reports at once.
      if (!running || now - lastReport >= REPORT_INTERVAL) report(now)
      return running
    })
    wakeRef.current = () => loop.wake()

    const observer = new ResizeObserver(() => {
      layout()
      loop.drawNow()
    })
    observer.observe(container)
    const stopWaking = wakeOnInput(loop)

    // --- pointer: pick an agent, or place and remove blocks ---
    const onDown = (event: PointerEvent) => {
      const sim = simRef.current
      if (!sim) return
      const p = toWorld(event.clientX, event.clientY)
      const { tool, settings, onSelect, onPlacedChange, onNotice } = latest.current
      if (tool === 'inspect') {
        // A generous pick radius in screen pixels: agents are small and move.
        const hit = sim.agentAt(p.x, p.y, Math.max(2.5, 14 / scale))
        onSelect(hit ? hit.id : -1)
        return
      }
      if (p.x < 0 || p.y < 0 || p.x > WORLD_W || p.y > WORLD_H) return
      const existing = settings.placed.findIndex((c) => Math.hypot(c.x - p.x, c.y - p.y) <= c.r)
      if (existing >= 0) {
        onPlacedChange(settings.placed.filter((_, i) => i !== existing))
        onNotice('Block removed.')
        return
      }
      if (settings.placed.length >= MAX_PLACED) {
        onNotice(`At most ${MAX_PLACED} blocks. Click one to remove it.`)
        return
      }
      const block = snapToGap(sim.env, { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2, r: PLACED_RADIUS })
      const verdict = canPlace(sim.env, block)
      if (verdict === 'destination') onNotice('Not on a destination.')
      else if (verdict === 'disconnects') onNotice('That would cut a destination off from the others — refused.')
      else {
        onPlacedChange([...settings.placed, block])
        const gap = gapClosedBy(sim.env, block)
        onNotice(gap >= 0 ? 'Gap closed. Click the block again to reopen it.' : 'Block placed. Click it again to remove it.')
      }
    }
    const onMove = (event: PointerEvent) => {
      const sim = simRef.current
      if (!sim) return
      const p = toWorld(event.clientX, event.clientY)
      const { tool, settings } = latest.current
      const over =
        tool === 'inspect'
          ? sim.agentAt(p.x, p.y, Math.max(2.5, 14 / scale)) !== null
          : settings.placed.some((c) => Math.hypot(c.x - p.x, c.y - p.y) <= c.r)
      canvas.style.cursor = tool === 'block' ? (over ? 'pointer' : 'crosshair') : over ? 'pointer' : 'default'
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      observer.disconnect()
      stopWaking()
      loop.dispose()
      wakeRef.current = () => {}
      container.removeChild(canvas)
    }
  }, [])

  return <div ref={containerRef} className="agents-viewport" />
}
