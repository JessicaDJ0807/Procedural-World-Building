import { useState } from 'react'
import { DEBUG_COLOURS, type DebugOptions } from '../build/debugLayer'

/**
 * Play's Debug controls: a small disclosure under the season card, collapsed by default.
 * Everything here is display or timing — none of it is saved with a world, and none of it
 * changes what grows (the overlays only read; Pause, Step and Speed only meter time).
 */

const VEGETATION: { key: keyof DebugOptions; label: string; hint: string; swatch: string[] }[] = [
  { key: 'nodes', label: 'Growth nodes', hint: 'Every layer of growth, by plant, linked to the layer it grew from; the Draper’s strand nodes.', swatch: [DEBUG_COLOURS.climber, DEBUG_COLOURS.spreader, DEBUG_COLOURS.draper] },
  { key: 'directions', label: 'Growth direction', hint: 'Each active tip’s direction — the one the growth scores its next cell by.', swatch: [DEBUG_COLOURS.climber, DEBUG_COLOURS.spreader] },
  { key: 'suitability', label: 'Surface suitability', hint: 'The selected plant’s suitability per cell. Grey: never entered (≤ 0.1, glass, blocked).', swatch: [DEBUG_COLOURS.high, DEBUG_COLOURS.moderate, DEBUG_COLOURS.low, DEBUG_COLOURS.none] },
  { key: 'radius', label: 'Interaction radius', hint: 'Where both plants overlap (white), the 1.2 radius a node counts within (blue), and the 5 no other node may form inside (violet).', swatch: ['#ffffff', DEBUG_COLOURS.radius, DEBUG_COLOURS.spacing] },
  { key: 'mutations', label: 'Mutation points', hint: 'What the node rules find: gathering, qualifying, the next to form, too near a structure — and the structures already formed.', swatch: [DEBUG_COLOURS.gathering, DEBUG_COLOURS.meets, DEBUG_COLOURS.ready, DEBUG_COLOURS.formed] },
]
const INHABITANTS: typeof VEGETATION = [
  { key: 'inhabitants', label: 'State & target', hint: 'Each one’s state machine state and goal, and a line to where it’s going.', swatch: ['#ffffff', DEBUG_COLOURS.target] },
  { key: 'paths', label: 'Navigation paths', hint: 'Its planned A* route, cell by cell; where it has been since this was turned on (grey).', swatch: [DEBUG_COLOURS.path, DEBUG_COLOURS.trail] },
]
const SPEEDS = [0.25, 0.5, 1, 2, 4]

export function DebugPanel({ value, onChange, suitabilityFor, step }: { value: DebugOptions; onChange: (v: DebugOptions) => void; suitabilityFor: string; step: number }) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<DebugOptions>) => onChange({ ...value, ...patch })
  const on = VEGETATION.concat(INHABITANTS).filter((r) => value[r.key]).length
  const row = (r: (typeof VEGETATION)[number]) => (
    <label key={r.key} className="debug-row" title={r.hint}>
      <input type="checkbox" checked={!!value[r.key]} onChange={(e) => set({ [r.key]: e.target.checked } as Partial<DebugOptions>)} />
      <span>{r.label}</span>
      <span className="debug-swatches" aria-hidden="true">
        {r.swatch.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
      </span>
    </label>
  )
  return (
    <div className={`debug-panel${open ? ' is-open' : ''}`}>
      <button type="button" className="debug-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> Debug
        {(on > 0 || value.paused || value.timeScale !== 1) && (
          <span className="debug-badge">
            {[on ? `${on} on` : '', value.paused ? 'paused' : '', value.timeScale !== 1 ? `${value.timeScale}×` : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>
      {open && (
        <div className="debug-body">
          <fieldset>
            <legend>Vegetation</legend>
            {VEGETATION.map(row)}
            {value.suitability && <p className="debug-note">Suitability shown for the {suitabilityFor}.</p>}
          </fieldset>
          <fieldset>
            <legend>Inhabitants</legend>
            {INHABITANTS.map(row)}
          </fieldset>
          <fieldset>
            <legend>Simulation</legend>
            <div className="debug-sim">
              <button type="button" onClick={() => set({ paused: !value.paused })} aria-pressed={value.paused}>
                {value.paused ? '▶ Resume' : '❚❚ Pause'}
              </button>
              <button type="button" disabled={!value.paused} onClick={() => set({ stepToken: value.stepToken + 1 })} title="One growth step; inhabitants and weather move on by the time a step takes">
                Step 1 tick
              </button>
              <span className="debug-step">step {step.toLocaleString()}</span>
            </div>
            <label className="debug-speed">
              <span>Speed</span>
              <input type="range" min={0} max={SPEEDS.length - 1} step={1} value={SPEEDS.indexOf(value.timeScale)} onChange={(e) => set({ timeScale: SPEEDS[Number(e.target.value)] })} aria-valuetext={`${value.timeScale}×`} />
              <span className="debug-speed-value">{value.timeScale}×</span>
            </label>
            <p className="debug-note">Pause freezes growth, inhabitants and weather; the camera still moves. Speed scales them all, on top of ⏩.</p>
          </fieldset>
        </div>
      )}
    </div>
  )
}
