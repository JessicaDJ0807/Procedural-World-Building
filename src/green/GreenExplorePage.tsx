import { useCallback, useState } from 'react'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import {
  DEFAULT_PARAMS,
  ENVIRONMENT_SLIDERS,
  PRESETS,
  RANDOMNESS_SLIDER,
  SPECIES_SLIDERS,
  presetParams,
  type GrowthParams,
  type PresetId,
} from './params'
import { SPECIES, SPECIES_IDS, SPECIES_LOOK, type SpeciesId, type SpeciesParams } from './species'
import { GreenViewport, STALL_STEPS, type CameraView, type Display, type GrowthReport } from './GreenViewport'
import '../study/study.css'
import './green.css'

const DISPLAYS: { value: Display; label: string; legend: string }[] = [
  { value: 'final', label: 'Final', legend: 'The building as it would look. Walls darken slightly where they are damp; leaves are olive where dry.' },
  { value: 'species', label: 'Species', legend: 'Which species holds each cell. A cell belongs to whichever species reached it first.' },
  { value: 'moisture', label: 'Moisture', legend: 'Rain carried down each wall — pooling on ledges, shed by glass, kept off by balconies — and caught by the roofs, collecting at their edges, minus what the sun dries.' },
  { value: 'sun', label: 'Sunlight', legend: 'How directly each wall and roof faces the sun, with shadows from the balconies, ledges, rooftop units and the building itself.' },
  { value: 'suitability', label: 'Suitability', legend: 'What a tip ranks its neighbours by: moisture × light, weighted toward features by edge preference — for the species selected in the sidebar.' },
  { value: 'geometry', label: 'Geometry', legend: 'Nearness to something a vine can follow: corners (the inside one most), window frames, ledges, roof edges and the foot of the wall above the terrace.' },
]

const SPEEDS = [1, 4, 16]

/**
 * The Project's one driven page: a building, and three plants finding their way up it.
 *
 * The sidebar is split the way the model is. **Environment** is what the world
 * is like; **Species** is who is growing, and the sliders under it are what
 * the selected species needs; **Model** holds the randomness and the switches
 * that turn whole terms off, which is how the Progress page's experiments are
 * reproduced.
 * Display lives in the View popover because it changes nothing about the
 * growth — the field views are ways of looking at the same run.
 */
export function GreenExplorePage() {
  const [params, setParams] = useState<GrowthParams>(DEFAULT_PARAMS)
  const [preset, setPreset] = useState<PresetId | null>('balanced')
  // Paused on arrival: the page opens on the seeds, and Play is the user's call.
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [stepToken, setStepToken] = useState(0)
  const [resetToken, setResetToken] = useState(0)
  const [display, setDisplay] = useState<Display>('final')
  const [camera, setCamera] = useState<CameraView>('front')
  const [cameraToken, setCameraToken] = useState(0)
  const [showLeaves, setShowLeaves] = useState(true)
  const [report, setReport] = useState<GrowthReport | null>(null)
  const [focus, setFocus] = useState<SpeciesId>('ivy')
  /** Set when Play stopped itself because nothing grew for STALL_STEPS steps. */
  const [stalledAt, setStalledAt] = useState<number | null>(null)
  const onStall = useCallback((step: number) => {
    setRunning(false)
    setStalledAt(step)
  }, [])
  const restart = () => {
    setStalledAt(null)
    setResetToken((t) => t + 1)
  }

  const update = (patch: Partial<GrowthParams>) => {
    setParams((p) => ({ ...p, ...patch }))
    setPreset(null)
  }

  const updateSpecies = (id: SpeciesId, patch: Partial<SpeciesParams>) => {
    setParams((p) => ({ ...p, species: { ...p.species, [id]: { ...p.species[id], ...patch } } }))
    setPreset(null)
  }

  const applyPreset = (id: PresetId) => {
    setParams((p) => presetParams(id, p))
    setPreset(id)
    // A preset is a comparison, so it starts from the seeds rather than on top
    // of whatever the last preset grew.
    restart()
    setRunning(true)
  }

  const view = DISPLAYS.find((d) => d.value === display)!
  const focused = params.species[focus]

  const rule = (key: 'useMoisture' | 'useSunlight' | 'useGeometry', label: string, info: string) => (
    <label className="control control-toggle">
      <span className="control-label">
        <InfoTip text={info}>{label}</InfoTip>
      </span>
      <input type="checkbox" checked={params[key]} onChange={(e) => update({ [key]: e.target.checked })} />
    </label>
  )

  return (
    <div className="workspace green-workspace">
      <div className="workspace-canvas">
        <GreenViewport
          params={params}
          display={display}
          running={running}
          speed={speed}
          stepToken={stepToken}
          resetToken={resetToken}
          camera={camera}
          cameraToken={cameraToken}
          showLeaves={showLeaves}
          focus={focus}
          onStall={onStall}
          onReport={setReport}
        />

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
          <span className="control-label green-view-label">Camera</span>
          <div className="segmented">
            {(['front', 'corner'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`segmented-option${camera === v ? ' is-active' : ''}`}
                onClick={() => {
                  setCamera(v)
                  setCameraToken((t) => t + 1)
                }}
              >
                {v === 'front' ? 'Front' : 'Corner'}
              </button>
            ))}
          </div>
          <label className="control control-toggle">
            <span className="control-label">Show leaves</span>
            <input type="checkbox" checked={showLeaves} onChange={(e) => setShowLeaves(e.target.checked)} />
          </label>
          <p className="hint">Drag to move, right-drag or ⌘-drag to orbit, scroll to zoom.</p>
        </ViewControls>

        {display !== 'final' && (
          <div className="green-legend" aria-live="polite">
            {display === 'species' ? (
              <div className="green-legend-species">
                {SPECIES_IDS.map((id) => (
                  <span key={id}>
                    <span className="green-swatch" style={{ background: SPECIES_LOOK[id].swatch }} aria-hidden="true" />
                    {SPECIES[id].name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="green-legend-head">
                <strong>
                  {view.label}
                  {display === 'suitability' && ` · ${SPECIES[focus].name}`}
                </strong>
                <span className={`green-ramp is-${display}`} aria-hidden="true" />
                <span className="green-legend-ends">
                  <span>low</span>
                  <span>high</span>
                </span>
              </div>
            )}
            <p>{view.legend}</p>
            <p className="green-legend-note">Stems stay drawn, so growth can be read against the field.</p>
          </div>
        )}
      </div>

      <div className="workspace-inspector green-inspector">
        <aside className="control-sidebar" aria-label="Growth controls">
          <h3 className="control-group">
            <InfoTip text="Plays the simulation in steps. Each step, every growing tip looks at its eight neighbouring cells, scores them, and may grow into one. 1× is 8 steps a second.">
              Growth
            </InfoTip>
          </h3>
          <div className="button-row">
            <button
              type="button"
              className="reset-button is-primary"
              onClick={() => {
                setStalledAt(null)
                setRunning((r) => !r)
              }}
            >
              {running ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="reset-button"
              disabled={running}
              title={running ? 'Pause first' : 'Advance one step'}
              onClick={() => setStepToken((t) => t + 1)}
            >
              Step
            </button>
            <button
              type="button"
              className="reset-button"
              title="Replant the same seeds and start again"
              onClick={restart}
            >
              Reset
            </button>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                className={`segmented-option${speed === s ? ' is-active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          {report && (
            <p className="readout green-readout">
              Step <strong>{report.step.toLocaleString()}</strong> ·{' '}
              <strong>{(report.coverage * 100).toFixed(1)}%</strong> covered
              <br />
              <strong>{report.grown.toLocaleString()}</strong> cells · <strong>{report.tips}</strong> growing tips
            </p>
          )}
          {stalledAt !== null && (
            <p className="hint green-stalled">
              Growth stopped: the last new cell grew at step {stalledAt.toLocaleString()}, and nothing
              has grown in the {STALL_STEPS} steps since, so Play paused itself. Play carries on
              anyway; Reset starts again.
            </p>
          )}

          <h3 className="control-group">
            <InfoTip text="Presets set the parameters, switch all three species on and replant — nothing in them is a hand-placed layout. The seed is kept, so each preset grows from the same starting points.">
              Presets
            </InfoTip>
          </h3>
          <div className="green-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`green-preset${preset === p.id ? ' is-active' : ''}`}
                onClick={() => applyPreset(p.id)}
                title={p.blurb}
              >
                {p.name}
              </button>
            ))}
          </div>
          {preset && <p className="hint">{PRESETS.find((p) => p.id === preset)?.blurb}</p>}

          <h3 className="control-group">
            <InfoTip text="What the world is like. These change the moisture and sunlight fields; open View → Display to see them on the walls.">
              Environment
            </InfoTip>
          </h3>
          {ENVIRONMENT_SLIDERS.map((spec) => (
            <Slider
              key={spec.key}
              label={spec.label}
              info={spec.info}
              value={params[spec.key]}
              display={spec.format(params[spec.key])}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              onChange={(v) => update({ [spec.key]: v })}
            />
          ))}

          <h3 className="control-group">
            <InfoTip text="Three plants that compete for the wall: whichever reaches a cell first holds it. The checkbox switches a species on or off (and replants); selecting a row puts its needs in the sliders below.">
              Species
            </InfoTip>
          </h3>
          <div className="green-species" role="radiogroup" aria-label="Species to edit">
            {SPECIES_IDS.map((id, sp) => (
              <div key={id} className={`green-species-row${focus === id ? ' is-active' : ''}`}>
                <input
                  type="checkbox"
                  aria-label={`Grow ${SPECIES[id].name}`}
                  checked={params.species[id].enabled}
                  onChange={(e) => updateSpecies(id, { enabled: e.target.checked })}
                />
                <button
                  type="button"
                  role="radio"
                  aria-checked={focus === id}
                  className="green-species-pick"
                  onClick={() => setFocus(id)}
                  title={SPECIES[id].blurb}
                >
                  <span className="green-swatch" style={{ background: SPECIES_LOOK[id].swatch }} aria-hidden="true" />
                  <span className="green-species-name">{SPECIES[id].name}</span>
                  <span className="green-species-share">
                    {report && params.species[id].enabled ? `${(report.bySpecies[sp] * 100).toFixed(1)}%` : 'off'}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <p className="hint">{SPECIES[focus].blurb}</p>
          {SPECIES_SLIDERS.map((spec) => (
            <Slider
              key={spec.key}
              label={spec.label}
              info={spec.info}
              value={focused[spec.key]}
              display={spec.format(focused[spec.key])}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              onChange={(v) => updateSpecies(focus, { [spec.key]: v })}
            />
          ))}

          <h3 className="control-group">
            <InfoTip text="Randomness applies to every species. The switches turn a whole term of the model off: a rule that is off treats every cell the same, so its influence disappears without anything else changing. Reset after toggling to compare from the seeds.">
              Model
            </InfoTip>
          </h3>
          <Slider
            label={RANDOMNESS_SLIDER.label}
            info={RANDOMNESS_SLIDER.info}
            value={params.randomness}
            display={RANDOMNESS_SLIDER.format(params.randomness)}
            min={RANDOMNESS_SLIDER.min}
            max={RANDOMNESS_SLIDER.max}
            step={RANDOMNESS_SLIDER.step}
            onChange={(v) => update({ randomness: v })}
          />
          {rule('useMoisture', 'Moisture', 'Off: every cell counts as perfectly watered.')}
          {rule('useSunlight', 'Sunlight', 'Off: every cell counts as perfectly lit, for every species.')}
          {rule('useGeometry', 'Geometry', 'Off: corners, frames and ledges stop attracting growth — edge preference has no effect.')}

          <div className="button-row">
            <button
              type="button"
              className="reset-button"
              title="New seed: new starting points for every species"
              onClick={() => update({ seed: (params.seed % 999) + 1 })}
            >
              New seed
            </button>
          </div>
          <p className="hint">Seed {params.seed}. Same seed and settings, same building — cell for cell.</p>

          {report && (
            <p className="readout">
              <strong>{report.fps.toFixed(0)}</strong> frames/s · step <strong>{report.stepMs.toFixed(3)} ms</strong>
              <br />
              <strong>{report.leaves.toLocaleString()}</strong> leaf instances · fields{' '}
              <strong>{report.fieldMs.toFixed(1)} ms</strong>
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
