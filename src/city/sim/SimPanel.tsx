import type { ReactNode } from 'react'
import { InfoTip } from '../../InfoTip'
import '../../agents/agents.css'
import type { CitySpec } from '../../config/cityConfig'
import { MINUTES_PER_DAY, isTravelling, type Task } from './inhabitants'
import { RESOURCES, type Policy, type ResourceId } from './resources'
import { RESOURCE_COLOURS, TASK_COLOURS } from './simMeshes'
import { CLOSE_BELOW, OPEN_ABOVE, REFERENCE_POPULATION, clockText, type CitySim, type SimMode, type SimStats } from './urban'

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

const TASK_LABELS: Record<Task, string> = {
  home: 'At home',
  toWork: 'Going to work',
  work: 'At work',
  toPark: 'Going to the park',
  park: 'In the park',
  toHome: 'Going home',
}

const RESOURCE_LABELS: Record<ResourceId, string> = { water: 'Water', energy: 'Energy', waste: 'Waste' }

const time = (m: number) => {
  const d = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`
}

const num = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))

export function SimControls({
  mode,
  running,
  onToggle,
  onStep,
  onReset,
  stats,
  slider,
  resource,
  onResource,
  policy,
  onPolicy,
}: {
  mode: SimMode
  running: boolean
  onToggle: () => void
  onStep: () => void
  onReset: () => void
  stats: SimStats | null
  slider: (key: CitySpec['key']) => ReactNode
  resource: ResourceId
  onResource: (r: ResourceId) => void
  policy: Policy
  onPolicy: (p: Policy) => void
}) {
  return (
    <>
      <h3 className="control-group">
        <InfoTip text="A fixed step of one simulated minute. Play runs as many steps per frame as the speed asks; Step runs exactly one and pauses; Reset rebuilds the simulation from the seed, back to 06:30 on day 1. The same seed and settings replay the same day.">
          Simulation
        </InfoTip>
      </h3>
      <div className="sim-clock" aria-live="off">
        {stats ? clockText(stats.minute) : '—'}
        <span className="city-dim">{running ? ' · running' : ' · paused'}</span>
      </div>
      <div className="sim-transport">
        <button type="button" className="reset-button is-primary" onClick={onToggle}>
          {running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="reset-button" onClick={onStep} title="Advance one simulated minute, and pause">
          Step
        </button>
        <button type="button" className="reset-button" onClick={onReset} title="Rebuild from the seed: 06:30, day 1">
          Reset
        </button>
      </div>
      {slider('simSpeed')}
      {mode !== 'resources' && slider('population')}
      {mode !== 'resources' && slider('walkSpeed')}
      {mode !== 'agents' && (
        <>
          <div className="segmented city-segmented" role="radiogroup" aria-label="Resource shown">
            {RESOURCES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={resource === r} className={`segmented-option${resource === r ? ' is-active' : ''}`} onClick={() => onResource(r)}>
                <span className="swatch" style={{ background: hex(RESOURCE_COLOURS[r]) }} />
                {RESOURCE_LABELS[r]}
              </button>
            ))}
          </div>
          {slider('supply')}
          {slider('demand')}
          {slider('capacity')}
          <span className="control-label sim-policy-label">
            <InfoTip text="Who goes short when the plant cannot meet demand. Nearest first: buildings are served in order of distance along the network, and the end of the line gets what is left — possibly nothing. Shared: every building is rationed to the same fraction, supply over demand. Pipes limit both the same way, since a full pipe is full whoever is downstream.">
              When supply runs short
            </InfoTip>
          </span>
          <div className="segmented city-segmented" role="radiogroup" aria-label="Shortage policy">
            {(
              [
                ['nearest', 'Nearest first'],
                ['shared', 'Shared equally'],
              ] as [Policy, string][]
            ).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={policy === v} className={`segmented-option${policy === v ? ' is-active' : ''}`} onClick={() => onPolicy(v)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {mode === 'dynamics' && <Rules stats={stats} />}
    </>
  )
}

function Rules({ stats }: { stats: SimStats | null }) {
  const people = stats ? stats.population - stats.travelling : 0
  const r = stats?.resources
  const rows: [string, ReactNode][] = [
    ['Each person inside a building asks for 1 water, 1 energy and ½ waste a minute, plus a standing 10% of its full load', <>{people} indoors</>],
    ['Plants share supply out by the chosen policy, and pipes limit what reaches each branch', r ? <>{num(r.energy.given)} of {num(r.energy.demand)} energy</> : '—'],
    ['Activity drifts toward the worst-supplied share of water and energy (waste counts half), over about an hour', stats ? <>mean {stats.meanActivity.toFixed(2)}</> : '—'],
    [`Under ${CLOSE_BELOW} a building closes; over ${OPEN_ABOVE} it reopens. Workers at a closed workplace go to the park`, stats ? <>{stats.closed} closed · {stats.turnedAway} turned away</> : '—'],
    [`Supply 100% is sized for ${REFERENCE_POPULATION} inhabitants`, stats ? <>{stats.population} now</> : '—'],
  ]
  return (
    <ol className="city-rules sim-rules" aria-label="The urban dynamics rules">
      {rows.map(([text, value], i) => (
        <li key={i}>
          <span className="city-rule-text">{text}</span>
          <span className="city-rule-count">{value}</span>
        </li>
      ))}
    </ol>
  )
}

/** The compact statistics panel. Every figure is counted from the running simulation. */
export function SimPanel({ mode, sim, stats, resource }: { mode: SimMode; sim: CitySim; stats: SimStats | null; resource: ResourceId }) {
  if (!stats) return <>Starting…</>
  const r = stats.resources?.[resource]
  const shortage = r ? r.shortSupply + r.shortNetwork + r.unreachable : 0
  return (
    <>
      <div className="sim-stats">
        {mode !== 'resources' && (
          <>
            <Stat label="Population" value={stats.population} />
            <Stat label="Travelling" value={stats.travelling} info="Active agents: inhabitants on the road now." />
            <Stat label="At work" value={stats.counts.work} />
            <Stat label="In parks" value={stats.counts.park} />
          </>
        )}
        {r && (
          <>
            <Stat label={`${RESOURCE_LABELS[resource]} supply`} value={num(r.supply)} info="What the plant makes per minute." />
            <Stat label="Demand" value={num(r.demand)} info="What every building is asking for, this minute." />
            <Stat label="Shortage" value={num(shortage)} tone={shortage > 0.5 ? 'bad' : undefined} info="Demand not delivered: the plant ran out, or a pipe was full." />
            <Stat label="Unused supply" value={num(Math.max(0, r.supply - r.given))} info="Made and not delivered — to anyone. Spare capacity at the plant." />
          </>
        )}
      </div>
      {r && (
        <p className="sim-detail">
          Short for <strong>supply</strong> {num(r.shortSupply)} · for <strong>network</strong> {num(r.shortNetwork)}
          {r.unreachable > 0 ? ` · unreachable ${num(r.unreachable)}` : ''}
          <br />
          <strong>{r.shortBuildings}</strong> of {sim.places.filter((p) => p.kind !== 'park').length} buildings short ·{' '}
          <InfoTip text="Pipes carrying anything, how full they run on average, and how many are at capacity — the bottlenecks. Spare capacity is everything else.">
            pipes {r.used} in use, {Math.round(r.utilisation * 100)}% full on average, <strong>{r.saturated}</strong> at capacity
          </InfoTip>
        </p>
      )}
      {mode === 'dynamics' && (
        <>
          <p className="sim-detail">
            Buildings <strong>{stats.open}</strong> open, <strong>{stats.closed}</strong> closed · mean activity <strong>{stats.meanActivity.toFixed(2)}</strong>
            <br />
            <strong>{stats.working}</strong> working · <strong>{stats.turnedAway}</strong> turned away at a closed door since the start
          </p>
          <History sim={sim} />
        </>
      )}
      <p className="sim-detail city-dim">
        {stats.stepMs.toFixed(3)} ms a step
        {mode !== 'resources' ? ` · ${stats.searches} routes found by A*` : ''}
      </p>
    </>
  )
}

function Stat({ label, value, info, tone }: { label: string; value: ReactNode; info?: string; tone?: 'bad' }) {
  return (
    <div className={`sim-stat${tone === 'bad' ? ' is-bad' : ''}`}>
      <span className="sim-stat-value">{value}</span>
      <span className="sim-stat-label">{info ? <InfoTip text={info}>{label}</InfoTip> : label}</span>
    </div>
  )
}

/** The last day, sampled every ten minutes: energy demand against supply, and the share of buildings open. */
function History({ sim }: { sim: CitySim }) {
  const h = sim.history
  const w = 240
  const hh = 54
  if (h.length < 2) return <div className="agents-spark is-empty">Collecting…</div>
  const max = Math.max(...h.map((s) => Math.max(s.demand, s.supply))) * 1.05
  const x = (i: number) => (w - (h.length - 1 - i) * (w / 143)).toFixed(1)
  const y = (v: number) => (hh - 2 - (v / max) * (hh - 4)).toFixed(1)
  const line = (f: (s: (typeof h)[number]) => number) => h.map((s, i) => `${x(i)},${y(f(s))}`).join(' ')
  const open = h.map((s, i) => `${x(i)},${(hh - 2 - s.open * (hh - 4)).toFixed(1)}`).join(' ')
  return (
    <>
      <svg className="sim-history" viewBox={`0 0 ${w} ${hh}`} preserveAspectRatio="none" role="img" aria-label="Energy demand, supply and buildings open over the last day">
        <polyline points={line((s) => s.supply)} className="sim-line is-supply" />
        <polyline points={line((s) => s.demand)} className="sim-line is-demand" />
        <polyline points={open} className="sim-line is-open" />
      </svg>
      <div className="sim-history-key">
        <span><i className="is-demand" />energy demand</span>
        <span><i className="is-supply" />supply</span>
        <span><i className="is-open" />share open</span>
      </div>
    </>
  )
}

export function SimInspector({ sim, id, stats, onClose }: { sim: CitySim; id: number; stats: SimStats | null; onClose: () => void }) {
  // `stats` is here to re-render on every report; the agent is read live.
  void stats
  const a = sim.population.agents[id]
  const place = (i: number) => {
    if (i < 0) return '—'
    const p = sim.places[i]
    return `${p.kind === 'park' ? 'Park' : p.kind === 'tower' ? 'Tower' : p.kind === 'apartment' ? 'Apartment block' : 'House'} #${p.id}`
  }
  const destination = a.task === 'toWork' || a.task === 'work' ? a.work : a.task === 'toPark' || a.task === 'park' ? a.park : a.home
  const travelling = isTravelling(a.task)
  const total = travelling ? a.cum[a.cum.length - 1] : 0
  const speed = sim.params.walkSpeed
  return (
    <div className="study-overlay agents-inspector sim-inspector" role="region" aria-label={`Inhabitant ${id}`}>
      <div className="agents-inspector-head">
        <span>
          <span className="swatch" style={{ background: hex(TASK_COLOURS[a.task]) }} />
          Inhabitant <strong>#{a.id}</strong> · <strong>{TASK_LABELS[a.task]}</strong>
        </span>
        <button type="button" className="agents-close" onClick={onClose} aria-label="Stop inspecting">
          ×
        </button>
      </div>
      <p className="agents-decision">{a.note}</p>
      <table className="probe-table agents-table">
        <tbody>
          <tr>
            <th>Destination</th>
            <td>
              <strong>{place(destination)}</strong>
            </td>
          </tr>
          {travelling && (
            <tr>
              <th>Route</th>
              <td>
                {a.along.toFixed(0)} of {total.toFixed(0)} u · about {Math.ceil((total - a.along) / (speed * a.pace))} min to go
              </td>
            </tr>
          )}
          {!travelling && a.task !== 'home' && (
            <tr>
              <th>Until</th>
              <td>{time(a.until)}</td>
            </tr>
          )}
          <tr>
            <th>Schedule</th>
            <td>
              leaves {time(a.leave)} · {Math.round(a.shift / 60)} h shift · {a.parkStay} min in the park
            </td>
          </tr>
          <tr>
            <th>Home · work</th>
            <td>
              {place(a.home)} · {place(a.work)}
            </td>
          </tr>
          <tr>
            <th>Trips</th>
            <td>
              {a.trips}
              {a.turnedAway ? ` · turned away ${a.turnedAway}×` : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function SimLegend({ mode, resource }: { mode: SimMode; resource: ResourceId }) {
  return (
    <div className="study-overlay study-legend city-legend" aria-hidden="true">
      {mode !== 'resources' &&
        (['toWork', 'toPark', 'toHome'] as Task[]).map((t) => (
          <span key={t} className="legend-key">
            <span className="swatch" style={{ background: hex(TASK_COLOURS[t]) }} />
            {TASK_LABELS[t]}
          </span>
        ))}
      {mode !== 'agents' && (
        <>
          <span className="legend-key">
            <span className="swatch" style={{ background: hex(RESOURCE_COLOURS[resource]) }} />
            {RESOURCE_LABELS[resource]} pipe
          </span>
          <span className="legend-key">
            <span className="swatch" style={{ background: '#c4736a' }} />
            Full / short
          </span>
          <span className="legend-key">
            <span className="swatch" style={{ background: '#8fbf7f' }} />
            Served
          </span>
          {mode === 'dynamics' && (
            <span className="legend-key">
              <span className="swatch" style={{ background: '#3a3d40', outline: '1px solid #777' }} />
              Closed
            </span>
          )}
        </>
      )}
    </div>
  )
}
