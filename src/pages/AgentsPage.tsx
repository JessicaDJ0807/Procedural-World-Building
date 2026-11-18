import { useCallback, useState } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { Workspace } from '../Workspace'
import { AGENT_SPECS, agentSpec, defaultAgentSettings, type AgentSettings, type AgentSpec } from '../config/agentConfig'
import type { Circle } from '../agents/environment'
import { PRESETS, type PresetId } from '../agents/presets'
import type { AgentParams, AgentState, Decision } from '../agents/simulation'
import { STATE_COLOURS, TRAIL_COLOUR } from '../agents/colours'
import {
  AgentViewport,
  type AgentReport,
  type AgentSnapshot,
  type Tool,
} from '../agents/AgentViewport'
import '../study/study.css'
import '../agents/agents.css'

const byKey = (key: AgentSpec['key']) => AGENT_SPECS.find((s) => s.key === key) as AgentSpec

const STATE_LABELS: Record<AgentState, string> = {
  idle: 'Idle',
  explore: 'Explore',
  navigate: 'Navigate',
  rest: 'Rest',
}

const deg = (radians: number) => `${Math.abs(Math.round((radians * 180) / Math.PI))}°`
const side = (radians: number) => (Math.abs(radians) < 0.01 ? 'straight on' : `${deg(radians)} ${radians > 0 ? 'right' : 'left'}`)

/** The decision the simulation recorded, in words. Every number here is one the agent used. */
function describe(d: Decision, target: string): string {
  switch (d.kind) {
    case 'spawn':
      return `Waiting to set out (${d.remaining.toFixed(1)} s).`
    case 'choose':
      return d.remaining > 0
        ? `Rested; choosing where next (${d.remaining.toFixed(1)} s).`
        : `Chose ${target}, at random among the other destinations.`
    case 'rest':
      return `Resting at the destination, ${d.remaining.toFixed(1)} s left.`
    case 'sight':
      return `${target} is in sight with nothing in the way — walking straight at it.`
    case 'trail':
      return `Following the trail: chose ${side(d.turn)}, where the trail reads ${d.trail.toFixed(2)}.`
    case 'compass':
      return `No trail strong enough to follow — heading ${side(d.turn)}, toward ${target}.`
    case 'wall':
      return `The way toward ${target} is blocked — sliding along the obstacle, ${side(d.turn)}.`
    case 'detour':
      return `Detour: ignoring trails for ${d.remaining.toFixed(1)} s more, to try somewhere less used.`
    case 'unstuck':
      return `Made no progress for 3 s — backing out, and sliding the other way from now on (${d.remaining.toFixed(1)} s).`
    case 'lost':
      return `The trail faded below 0.15 for a second — back to searching by compass.`
    case 'boxed':
      return 'Blocked on every side ahead — turning round.'
  }
}

export function AgentsPage() {
  const [settings, setSettings] = useState<AgentSettings>(defaultAgentSettings)
  // Running on arrival, as Topic 7 is: a paused page is agents standing on
  // three circles, and the whole subject is what happens once they move.
  const [running, setRunning] = useState(true)
  const [resetToken, setResetToken] = useState(0)
  const [clearToken, setClearToken] = useState(0)
  const [tool, setTool] = useState<Tool>('inspect')
  const [selected, setSelected] = useState(-1)
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<AgentReport | null>(null)

  // A parameter edit makes this a custom world; a display toggle does not.
  const set = (key: keyof AgentParams, value: number) =>
    setSettings((s) => ({ ...s, [key]: value, preset: key === 'agents' || key === 'speed' ? s.preset : 'custom' }))

  const applyPreset = (id: PresetId) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (preset) setSettings((s) => ({ ...s, ...preset.params, preset: id }))
  }

  const restart = () => {
    setResetToken((t) => t + 1)
    setSelected(-1)
  }
  const newSeed = () => {
    setSettings((s) => ({ ...s, seed: (s.seed % 999) + 1 }))
    setSelected(-1)
  }
  const onPlacedChange = useCallback((placed: Circle[]) => setSettings((s) => ({ ...s, placed })), [])

  const slider = (key: AgentSpec['key']) => {
    const spec = byKey(key)
    const value = settings[key]
    return (
      <Slider
        key={key}
        label={spec.label}
        info={spec.info}
        value={value}
        display={spec.format ? spec.format(value) : value.toFixed(2)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(v) => set(key, v)}
      />
    )
  }

  const preset = PRESETS.find((p) => p.id === settings.preset)
  const sel = report?.selected ?? null

  return (
    <Workspace
      topic="agents"
      library={
        <ConfigPanel
          spec={agentSpec}
          settings={settings}
          onLoad={(next) => {
            setSettings(next)
            restart()
          }}
        />
      }
      inspector={
        <aside className="control-sidebar" aria-label="Agent system controls">
          <h3 className="control-group">
            <InfoTip text="Each preset sets trail influence, evaporation and exploration — nothing else. The world, the agents and the code they run are the same under all three, and a preset applied mid-run changes the rule the colony is already following.">
              Presets
            </InfoTip>
          </h3>
          <div className="agents-presets" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`branching-preset${settings.preset === p.id ? ' is-active' : ''}`}
                aria-pressed={settings.preset === p.id}
                onClick={() => applyPreset(p.id)}
                title={`${p.label} — ${p.blurb}`}
              >
                {p.short}
              </button>
            ))}
          </div>
          <p className="hint">
            {preset ? (
              <>
                <span className="branching-preset-name">{preset.label}.</span> {preset.blurb}
              </>
            ) : (
              'Custom — edited from a preset. Pick one to return to it.'
            )}
          </p>

          <h3 className="control-group">
            <InfoTip text="The five numbers the experiment is about. Every agent reads the same values, each scaled by a personal factor between 0.8 and 1.2 drawn from the seed.">
              Parameters
            </InfoTip>
          </h3>
          {slider('agents')}
          {slider('influence')}
          {slider('evaporation')}
          {slider('exploration')}
          {slider('speed')}

          <div className="button-row">
            <button type="button" className="reset-button is-primary" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="reset-button" onClick={restart} title="Start again from the seed: agents back at the destinations, trails and measurements cleared">
              Reset
            </button>
          </div>
          <div className="button-row">
            <button type="button" className="reset-button" onClick={() => setClearToken((t) => t + 1)} title="Zero the trail field; the agents keep walking">
              Clear trails
            </button>
            <button type="button" className="reset-button" onClick={newSeed} title="Next seed: new gap positions, new rocks, new agents">
              New seed
            </button>
          </div>
          <p className="hint">
            Seed {settings.seed}. The run is deterministic: Reset replays it exactly, as long as nothing is changed while it plays.
          </p>

          <h3 className="control-group">
            <InfoTip text="Inspect: click an agent to follow it and see what it saw at its last decision. Blocks: click to drop a block, click a block to lift it. A block that would cut a destination off is refused. Blocks are part of the world, so they are saved with it.">
              Click to
            </InfoTip>
          </h3>
          <div className="segmented" role="tablist" aria-label="Click to">
            {(
              [
                ['inspect', 'Inspect an agent'],
                ['block', 'Place a block'],
              ] as [Tool, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tool === value}
                className={`segmented-option${tool === value ? ' is-active' : ''}`}
                onClick={() => {
                  setTool(value)
                  setNotice('')
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">
            {notice ||
              (tool === 'block'
                ? 'Try closing the busiest gap — the percentages beside the wall — and watch the network move.'
                : 'Click an agent on the map.')}
          </p>
          {settings.placed.length > 0 && (
            <button type="button" className="reset-button" onClick={() => onPlacedChange([])}>
              Remove {settings.placed.length} block{settings.placed.length === 1 ? '' : 's'}
            </button>
          )}

          <h3 className="control-group">Show</h3>
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="The shared trail field as a heatmap. Hiding it changes nothing about the simulation — agents still lay and read it.">
                Trail field
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={settings.showTrails}
              onChange={(e) => setSettings((s) => ({ ...s, showTrails: e.target.checked }))}
            />
          </label>
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="For the selected agent: the nine headings it scored at its last decision, each as bright as the chance it gave it (struck-out headings red), its sensing radius, the heading it is turning toward, and a dashed line to its goal.">
                Selected agent's senses
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={settings.showSenses}
              onChange={(e) => setSettings((s) => ({ ...s, showSenses: e.target.checked }))}
            />
          </label>

          {report && <Measurements report={report} running={running} />}
          <StateDiagram counts={report?.counts} highlight={sel?.state} />
          <Concepts />
        </aside>
      }
    >
      <AgentViewport
        settings={settings}
        running={running}
        resetToken={resetToken}
        clearToken={clearToken}
        tool={tool}
        selected={selected}
        onSelect={setSelected}
        onPlacedChange={onPlacedChange}
        onNotice={setNotice}
        onReport={setReport}
      />
      {sel && <Inspector agent={sel} onClose={() => setSelected(-1)} />}
      <Legend />
      {!running && <div className="study-overlay agents-paused">Paused</div>}
    </Workspace>
  )
}

function Inspector({ agent, onClose }: { agent: AgentSnapshot; onClose: () => void }) {
  const travelling = agent.state === 'explore' || agent.state === 'navigate'
  return (
    <div className="study-overlay agents-inspector" role="region" aria-label={`Agent ${agent.id}`}>
      <div className="agents-inspector-head">
        <span>
          <span className="swatch" style={{ background: STATE_COLOURS[agent.state] }} />
          Agent <strong>#{agent.id}</strong> · <strong>{STATE_LABELS[agent.state]}</strong>{' '}
          <span className="agents-dim">for {agent.stateTime.toFixed(1)} s</span>
        </span>
        <button type="button" className="agents-close" onClick={onClose} aria-label="Stop inspecting">
          ×
        </button>
      </div>
      <p className="agents-decision">{describe(agent.decision, agent.target)}</p>
      <table className="probe-table agents-table">
        <tbody>
          <tr>
            <th>Trip</th>
            <td>
              {agent.origin} → <strong>{agent.target}</strong>
            </td>
          </tr>
          {travelling && (
            <tr>
              <th>So far</th>
              <td>
                {agent.tripDistance.toFixed(0)} u in {agent.tripTime.toFixed(1)} s · {agent.remaining.toFixed(0)} u to go
              </td>
            </tr>
          )}
          <tr>
            <th>Speed</th>
            <td>
              {agent.velocity.toFixed(1)} u/s <span className="agents-dim">(walks at {agent.walkSpeed.toFixed(1)})</span>
            </td>
          </tr>
          <tr>
            <th>Trail influence</th>
            <td>{agent.influence.toFixed(2)}</td>
          </tr>
          <tr>
            <th>Exploration</th>
            <td>{Math.round(agent.exploration * 100)}%</td>
          </tr>
          <tr>
            <th>Trips done</th>
            <td>{agent.trips}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Legend() {
  return (
    <div className="study-overlay study-legend agents-legend" aria-hidden="true">
      {(Object.keys(STATE_LABELS) as AgentState[]).map((s) => (
        <span key={s} className="legend-key">
          <span className="swatch" style={{ background: STATE_COLOURS[s] }} />
          {STATE_LABELS[s]}
        </span>
      ))}
      <span className="legend-key">
        <span className="swatch" style={{ background: TRAIL_COLOUR }} />
        Trail
      </span>
    </div>
  )
}

/** A sparkline of trail concentration over the last three minutes. */
function Sparkline({ values }: { values: number[] }) {
  const w = 240
  const h = 36
  if (values.length < 2) return <div className="agents-spark is-empty">Collecting…</div>
  const max = Math.max(0.5, ...values)
  const step = w / 179
  const x0 = w - (values.length - 1) * step
  const points = values.map((v, i) => `${(x0 + i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ')
  return (
    <svg className="agents-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Trail concentration over the last three minutes">
      <line x1="0" x2={w} y1={h - (0.05 / max) * (h - 2) - 1} y2={h - (0.05 / max) * (h - 2) - 1} className="agents-spark-floor" />
      <polyline points={points} className="agents-spark-line" />
    </svg>
  )
}

function Measurements({ report, running }: { report: AgentReport; running: boolean }) {
  const s = report.summary
  const minutes = Math.floor(report.time / 60)
  const seconds = Math.floor(report.time % 60)
  return (
    <>
      <h3 className="control-group">
        <InfoTip text="Everything here is counted from the running simulation. Trip figures are over the last 40 completed trips, route shares over the last 60 crossings of the wall, so both follow a change of settings within a minute or so.">
          Measurements
        </InfoTip>
      </h3>
      <p className="readout">
        <strong>{report.counts.explore + report.counts.navigate}</strong> of {report.agents} agents travelling ·{' '}
        <strong>{report.trips.toLocaleString()}</strong> trips in {minutes}:{String(seconds).padStart(2, '0')}
        <br />
        {s ? (
          <>
            trip <strong>{s.time.toFixed(1)} s</strong> · <strong>{s.distance.toFixed(0)} u</strong> walked ·{' '}
            <InfoTip text="Total distance walked over the last 40 trips, against the shortest walkable route from where each trip began. 0% would mean every agent took the best route available. The shortest routes are computed by the page with Dijkstra's algorithm for this measurement only; no agent can see them.">
              <strong>+{Math.max(0, s.excess * 100).toFixed(0)}%</strong> over shortest
            </InfoTip>
          </>
        ) : (
          'No trips finished yet.'
        )}
        <br />
        <InfoTip text="Which gap in the wall agents crossed through, over the last 60 crossings. Even use is about a third each; one gap near 100% is a colony that has agreed on a route. The same percentages are written beside the gaps on the map.">
          gaps
        </InfoTip>{' '}
        {report.crossings > 0
          ? report.gapShares.map((v, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <strong>{Math.round(v * 100)}%</strong>
              </span>
            ))
          : '—'}
        <br />
        <InfoTip text="Share of all trail held by the busiest 5% of walkable ground. Trail spread evenly would score 5%; all of it on a few narrow paths approaches 100%. It is independent of how much trail there is, so it compares fairly across agent counts and evaporation rates.">
          trail concentration
        </InfoTip>{' '}
        <strong>{Math.round(report.concentration * 100)}%</strong>
      </p>
      <Sparkline values={report.history} />
      <p className="readout agents-perf">
        {running ? `${report.fps.toFixed(0)} frames/s · ` : ''}
        <InfoTip text="Main-thread time for one 1/30 s simulation step of every agent and the trail field, averaged over a quarter second. Drawing is not included.">
          step {report.stepMs.toFixed(2)} ms
        </InfoTip>
      </p>
    </>
  )
}

/**
 * The state machine every agent runs, drawn with the live count in each state.
 * The edges are labelled with the actual conditions in simulation.ts.
 */
function StateDiagram({ counts, highlight }: { counts?: Record<AgentState, number>; highlight?: AgentState }) {
  const node = (state: AgentState, x: number, y: number) => (
    <g className={`fsm-node${highlight === state ? ' is-active' : ''}`} transform={`translate(${x} ${y})`}>
      <rect x="-46" y="-16" width="92" height="32" rx="8" />
      <rect x="-42" y="-8" width="3" height="16" rx="1.5" style={{ fill: STATE_COLOURS[state] }} />
      <text x="-34" y="0" className="fsm-name">
        {STATE_LABELS[state]}
      </text>
      <text x="39" y="0" className="fsm-count">
        {counts ? counts[state] : ''}
      </text>
    </g>
  )
  return (
    <>
      <h3 className="control-group">
        <InfoTip text="Every agent runs this one machine. The number in each state is how many agents are in it now; the outlined state is the selected agent's.">
          State machine
        </InfoTip>
      </h3>
      <svg className="fsm" viewBox="0 0 280 200" role="img" aria-label="The agent state machine: Idle, Explore, Navigate and Rest, with the conditions that move an agent between them">
        <defs>
          <marker id="fsm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className="fsm-arrowhead" />
          </marker>
        </defs>
        {/* Explore and Navigate are both travelling, and either ends in Rest on arrival. */}
        <rect x="176" y="6" width="102" height="188" rx="10" className="fsm-group" />
        <path d="M94 30 H180" className="fsm-edge" markerEnd="url(#fsm-arrow)" />
        <text x="136" y="21" className="fsm-label">choose a goal</text>
        <path d="M214 46 V153" className="fsm-edge" markerEnd="url(#fsm-arrow)" />
        <path d="M242 154 V47" className="fsm-edge" markerEnd="url(#fsm-arrow)" />
        <text x="168" y="80" className="fsm-label is-right">↓ trail ≥ 0.35</text>
        <text x="168" y="91" className="fsm-label is-right">or goal in sight</text>
        <text x="168" y="112" className="fsm-label is-right">↑ trail &lt; 0.15 for 1 s</text>
        <text x="168" y="123" className="fsm-label is-right">or a detour</text>
        <path d="M176 170 H96" className="fsm-edge" markerEnd="url(#fsm-arrow)" />
        <text x="136" y="161" className="fsm-label">arrive</text>
        <path d="M48 154 V47" className="fsm-edge" markerEnd="url(#fsm-arrow)" />
        <text x="54" y="70" className="fsm-label is-left">2–5 s</text>
        {node('idle', 48, 30)}
        {node('explore', 228, 30)}
        {node('navigate', 228, 170)}
        {node('rest', 48, 170)}
      </svg>
    </>
  )
}

function Concepts() {
  return (
    <section className="agents-concepts" aria-label="How it works">
      <h3 className="control-group">How it works</h3>
      <p>
        <strong>A state machine</strong> decides <em>what</em> an agent is doing. Each state is a different behaviour —
        Explore walks by compass and wanders more, Navigate commits to a trail — and the arrows above are the only ways
        between them.
      </p>
      <p>
        <strong>Stigmergy</strong> is how agents coordinate without talking. Every step lays a little trail; every
        decision reads it five units ahead. Nobody knows where anyone else is going — only where people have been.
      </p>
      <p>
        <strong>Emergence</strong> is the result. Each agent wants to go straight to its goal, bends toward worn ground,
        and wears it further. Shared routes appear that no one planned, and evaporation lets them move when they stop
        being useful.
      </p>
      <p className="hint">
        In Wildform, the same loop could let inhabitants wear their own paths across living architecture as it grows —
        routes that follow how the building is actually used.
      </p>
    </section>
  )
}
