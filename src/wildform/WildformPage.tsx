import { useState } from 'react'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { INTRO, MUTATION_NAMES, SPECIES_NAMES, TAGLINE, TITLE } from './names'
import { DEFAULT_SETTINGS, DEMO, type Settings } from './sim'
import { WILD_SPECIES } from './species'
import { WildViewport, type CameraView, type Display, type WildReport } from './WildViewport'
import '../study/study.css'
import '../green/green.css'
import './wildform.css'

const DISPLAYS: { value: Display; label: string; legend: string; ramp?: string }[] = [
  { value: 'final', label: 'Final', legend: '' },
  { value: 'layers', label: 'Layers', legend: 'The stack of plants in each cell, coloured by the species on top — Climber green, Spreader olive — and warmer and brighter for each layer beneath it: amber-tinted two deep, more so three deep.' },
  { value: 'sun', label: 'Sunlight', ramp: 'sun', legend: 'How directly each surface faces the sun, with shadows from the building — and from any Living Platform. Shade a platform added is marked in slate blue.' },
  { value: 'moisture', label: 'Moisture', ramp: 'moisture', legend: 'Rain running down the walls, held by ledges, shed by glass, dried by the sun. Under a platform it dries less.' },
  { value: 'suitability', label: 'Suitability', ramp: 'suitability', legend: 'What a growing tip ranks its neighbours by: moisture × light, weighted toward support — for the species chosen above.' },
  { value: 'architecture', label: 'Architecture', ramp: 'geometry', legend: 'Support to follow: corners, window frames, ledges, roof edges — and the roots under a Living Platform.' },
  { value: 'interaction', label: 'Interaction', legend: 'Climber dark green, Spreader olive, where one has grown over the other amber, active tips white. Slate blue: the site the grammar is weighing, and shade a platform made.' },
]

const SPEEDS = [1, 4, 16]

/**
 * Explore, for the midterm: Wildform — two plant species whose meeting builds
 * architecture, which then changes the environment they grow in.
 *
 *   plants grow → plants meet → architecture emerges → the world changes → growth responds
 *
 * The sidebar is the presentation: environment, play controls, the two
 * species, the mutations so far with what the grammar is waiting for, the
 * last few events, and jumps between the milestones. Everything technical is
 * under Advanced.
 */
export function WildformPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [stepToken, setStepToken] = useState(0)
  const [resetToken, setResetToken] = useState(0)
  const [jump, setJump] = useState<{ step: number; token: number } | null>(null)
  const [display, setDisplay] = useState<Display>('final')
  const [focus, setFocus] = useState(1)
  const [camera, setCamera] = useState<CameraView>('perspective')
  const [cameraToken, setCameraToken] = useState(0)
  const [report, setReport] = useState<WildReport | null>(null)
  /** Milestones seen in this run, kept so the timeline can jump back to them after a jump. */
  const [known, setKnown] = useState<{ met: number | null; formed: number | null }>({ met: null, formed: null })

  const view = DISPLAYS.find((d) => d.value === display)!
  const onReport = (r: WildReport) => {
    setReport(r)
    setKnown((k) => ({ met: k.met ?? r.milestones.met, formed: k.formed ?? r.milestones.formed }))
  }
  const update = (patch: Partial<Settings>) => {
    // Preset, seed or mutations restart the run; rain and sun carry it on.
    if (patch.preset !== undefined || patch.seed !== undefined || patch.mutations !== undefined) setKnown({ met: null, formed: null })
    setSettings((s) => ({ ...s, ...patch }))
  }
  const demo = () => {
    setRunning(false)
    setKnown({ met: null, formed: null })
    setSettings((s) => ({ ...s, preset: 'demo', seed: DEMO.seed, rain: DEMO.rain, sunAzimuth: DEMO.sunAzimuth, mutations: true }))
    setResetToken((t) => t + 1)
  }
  const goTo = (step: number) => {
    setRunning(false)
    setJump({ step, token: (jump?.token ?? 0) + 1 })
  }
  const milestones: { label: string; step: number | null }[] = [
    { label: 'Start', step: 0 },
    { label: 'Growth', step: known.formed !== null ? Math.round(known.formed / 2) : null },
    { label: 'Before', step: known.formed !== null ? Math.max(0, known.formed - 10) : null },
    { label: 'Mutation', step: known.formed },
    { label: 'After', step: known.formed !== null ? known.formed + 800 : null },
  ]

  return (
    <div className="workspace green-workspace wild-workspace">
      <div className="workspace-canvas">
        <WildViewport
          settings={settings}
          display={display}
          focus={focus}
          running={running}
          speed={speed}
          stepToken={stepToken}
          resetToken={resetToken}
          jump={jump}
          camera={camera}
          cameraToken={cameraToken}
          onReport={onReport}
        />

        <div className="wild-intro">
          <strong>{TITLE}</strong>
          <span>{TAGLINE}</span>
        </div>

        <ViewControls>
          <span className="control-label green-view-label">Display</span>
          <div className="green-display" role="radiogroup" aria-label="Display">
            {DISPLAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={display === d.value}
                className={`segmented-option${display === d.value ? ' is-active' : ''}`}
                onClick={() => setDisplay(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
          {display === 'suitability' && (
            <div className="segmented" role="radiogroup" aria-label="Suitability for">
              {SPECIES_NAMES.map((name, k) => (
                <button key={name} type="button" role="radio" aria-checked={focus === k} className={`segmented-option${focus === k ? ' is-active' : ''}`} onClick={() => setFocus(k)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          <span className="control-label green-view-label">Camera</span>
          <div className="segmented">
            {(['perspective', 'front'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`segmented-option${camera === v ? ' is-active' : ''}`}
                onClick={() => {
                  setCamera(v)
                  setCameraToken((t) => t + 1)
                }}
              >
                {v === 'perspective' ? 'Perspective' : 'Front'}
              </button>
            ))}
          </div>
          <p className="hint">Drag to rotate, right-drag or ⌘-drag to move, scroll to zoom.</p>
        </ViewControls>

        {display !== 'final' && (
          <div className="green-legend" aria-live="polite">
            <div className="green-legend-head">
              <strong>
                {view.label}
                {display === 'suitability' && ` · ${SPECIES_NAMES[focus]}`}
              </strong>
              {view.ramp ? <span className={`green-ramp is-${view.ramp}`} aria-hidden="true" /> : <span />}
              {view.ramp && (
                <span className="green-legend-ends">
                  <span>low</span>
                  <span>high</span>
                </span>
              )}
            </div>
            <p>{view.legend}</p>
          </div>
        )}
      </div>

      <div className="workspace-inspector green-inspector">
        <aside className="control-sidebar" aria-label="Wildform controls">
          <div className="wild-head">
            <h2>{TITLE}</h2>
            <p>{INTRO}</p>
          </div>

          <h3 className="control-group">
            <InfoTip text="The Midterm Demo plants the same seeds in the same place every time, so the two species are sure to meet where a Living Platform can form — the simulation still runs every step. Random plants seeds from a seed number.">
              Start
            </InfoTip>
          </h3>
          <div className="segmented" role="radiogroup" aria-label="Start">
            <button type="button" role="radio" aria-checked={settings.preset === 'demo'} className={`segmented-option${settings.preset === 'demo' ? ' is-active' : ''}`} onClick={demo}>
              Midterm Demo
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.preset === 'random'}
              className={`segmented-option${settings.preset === 'random' ? ' is-active' : ''}`}
              onClick={() => update({ preset: 'random', seed: settings.preset === 'random' ? settings.seed : 1 })}
            >
              Random
            </button>
          </div>
          {settings.preset === 'random' && (
            <div className="button-row">
              <button type="button" className="reset-button" onClick={() => update({ seed: settings.seed + 1 })}>
                New seed
              </button>
              <span className="hint wild-seed">Seed {settings.seed}</span>
            </div>
          )}

          <h3 className="control-group">
            <InfoTip text="Change these mid-run and the fields change under the growth: plants that lose their conditions wither, and new growth goes where it now can.">
              Environment
            </InfoTip>
          </h3>
          <Slider label="Rain" value={settings.rain} display={`${Math.round(settings.rain * 100)}%`} min={0} max={1} step={0.01} onChange={(v) => update({ rain: v })} />
          <Slider label="Sun direction" value={settings.sunAzimuth} display={`${Math.round(settings.sunAzimuth)}°`} min={-90} max={90} step={1} onChange={(v) => update({ sunAzimuth: v })} />

          <h3 className="control-group">
            <InfoTip text="Each step, every growing tip looks at its eight neighbouring cells, scores them, and may grow into one. 1× is 8 steps a second.">
              Simulation
            </InfoTip>
          </h3>
          <div className="button-row">
            <button type="button" className="reset-button is-primary" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="reset-button" disabled={running} onClick={() => setStepToken((t) => t + 1)}>
              Step
            </button>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setRunning(false)
                setKnown({ met: null, formed: null })
                setResetToken((t) => t + 1)
              }}
            >
              Reset
            </button>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={speed === s} className={`segmented-option${speed === s ? ' is-active' : ''}`} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          {report && (
            <p className="readout">
              Step <strong>{report.step.toLocaleString()}</strong> · <strong>{report.tips}</strong> growing tips
            </p>
          )}

          <h3 className="control-group">Species</h3>
          <div className="wild-species">
            {SPECIES_NAMES.map((name, k) => (
              <div className="wild-species-row" key={name}>
                <span className="green-swatch" style={{ background: WILD_SPECIES[k].look.swatch }} aria-hidden="true" />
                <span className="wild-species-name">{name}</span>
                <span className="wild-species-note">{k === 0 ? 'climbs, follows edges' : 'spreads, seeks light'}</span>
                <span className="wild-species-share">{report ? `${(report.bySpecies[k] * 100).toFixed(1)}%` : '—'}</span>
              </div>
            ))}
            <div className="wild-species-row">
              <span className="green-swatch" style={{ background: '#e0a352' }} aria-hidden="true" />
              <span className="wild-species-name">Layered</span>
              <span className="wild-species-note">one over the other</span>
              <span className="wild-species-share">{report ? `${(report.layered * 100).toFixed(1)}%` : '—'}</span>
            </div>
          </div>

          <h3 className="control-group">
            <InfoTip text="Where the Climber and the Spreader grow over each other, a Living Platform forms if every condition holds: both mature and layered there, on a facade above the ground floor, with free space outward, not across a window, and supported by plants below. Its shade then changes the sunlight field.">
              Mutations
            </InfoTip>
          </h3>
          <p className="readout">
            {MUTATION_NAMES['living-platform']}s: <strong>{report?.platforms ?? 0}</strong>
          </p>
          {report?.candidate && (
            <ul className="wild-checks" aria-label="Conditions">
              {report.candidate.checks.map((c) => (
                <li key={c.label} className={c.ok ? 'is-ok' : ''} title={c.detail}>
                  <span aria-hidden="true">{c.ok ? '✓' : '○'}</span>
                  {c.label}
                </li>
              ))}
            </ul>
          )}

          <h3 className="control-group">Events</h3>
          {report && report.events.length ? (
            <ol className="wild-events">
              {report.events.map((e) => (
                <li key={`${e.step}-${e.text}`}>
                  <span className="wild-event-step">{e.step}</span>
                  {e.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">Press Play.</p>
          )}

          <h3 className="control-group">
            <InfoTip text="Jumps re-run the simulation from the start to that step — it is deterministic, so it lands on exactly the same state. Milestones unlock once the run has reached them.">
              Timeline
            </InfoTip>
          </h3>
          <div className="wild-timeline">
            {milestones.map((m) => (
              <button key={m.label} type="button" className="reset-button" disabled={m.step === null} onClick={() => m.step !== null && goTo(m.step)}>
                {m.label}
              </button>
            ))}
          </div>

          <details className="wild-advanced">
            <summary>Advanced</summary>
            <label className="control control-toggle">
              <span className="control-label">
                <InfoTip text="Off, the grammar never fires: the same run with no architecture emerging, to compare with. Restarts the run.">Mutations</InfoTip>
              </span>
              <input type="checkbox" checked={settings.mutations} onChange={(e) => update({ mutations: e.target.checked })} />
            </label>
            {report && (
              <p className="hint">
                {report.stepMs.toFixed(3)} ms a step · fields {report.fieldMs.toFixed(1)} ms · withered: Climber {report.withered[0]}, Spreader {report.withered[1]} ({report.smothered} smothered by a layer above)
              </p>
            )}
          </details>
        </aside>
      </div>
    </div>
  )
}
