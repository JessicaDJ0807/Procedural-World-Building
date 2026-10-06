import { Fragment, useMemo, useState } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { ShaderViewport } from '../ShaderViewport'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { Workspace } from '../Workspace'
import { defaultShaderSettings, shaderSpec, type ShaderSettings } from '../config/shaderConfig'
import { GROUPS, SIMULATIONS, getSimulation } from '../gpu'
import { defaults, type ParamSpec, type Stat } from '../gpu/simulation'

type Report = { stats: Stat[]; fps: number; ms: number }

const EMPTY: Report = { stats: [], fps: 0, ms: 0 }

const INITIAL = defaultShaderSettings()

/** Every simulation's defaults, so switching away and back keeps your tuning. */
function initialParams(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const sim of SIMULATIONS) out[sim.id] = defaults(sim.params)
  return out
}

export function ShaderPage() {
  const [simulationId, setSimulationId] = useState(SIMULATIONS[0].id)
  const [allParams, setAllParams] = useState(initialParams)
  const [presetName, setPresetName] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(INITIAL.running)
  const [resetToken, setResetToken] = useState(0)
  const [stepToken, setStepToken] = useState(0)
  const [report, setReport] = useState<Report>(EMPTY)

  const meta = useMemo(() => getSimulation(simulationId), [simulationId])
  const params = allParams[simulationId]
  const preset = meta.presets.find((option) => option.value === presetName[simulationId])

  const setParam = (key: string, value: number) => {
    setAllParams((current) => ({
      ...current,
      [simulationId]: { ...current[simulationId], [key]: value },
    }))
    // A nudged parameter is no longer the preset that was selected, in the same
    // way Topic 2's erosion panel stops claiming a preset it has left behind.
    if (meta.presets.some((option) => option.value === presetName[simulationId])) {
      const changed = preset && preset.params[key] !== undefined && preset.params[key] !== value
      if (changed) setPresetName((current) => ({ ...current, [simulationId]: '' }))
    }
  }

  const applyPreset = (value: string) => {
    setPresetName((current) => ({ ...current, [simulationId]: value }))
    const chosen = meta.presets.find((option) => option.value === value)
    if (!chosen) return
    setAllParams((current) => ({
      ...current,
      [simulationId]: { ...current[simulationId], ...chosen.params },
    }))
  }

  const settings = useMemo<ShaderSettings>(
    () => ({ simulationId, allParams, presetName, running }),
    [simulationId, allParams, presetName, running],
  )

  // resetToken and stepToken are not stored: they are nudges to the viewport,
  // not state a world has. Loading one starts the simulation from its own
  // initial condition, which is what the parameters describe.
  const applySettings = (next: ShaderSettings) => {
    setSimulationId(next.simulationId)
    setAllParams(next.allParams)
    setPresetName(next.presetName)
    setRunning(next.running)
    setResetToken((n) => n + 1)
  }

  // Only a parameter explicitly marked `view` leaves the sidebar. Relief,
  // lighting, the height ramp, Fresnel and haze all change appearance, but on
  // this topic appearance is the subject — they are the study, not the viewing.
  const viewParams = meta.params.filter((spec) => spec.view)
  const studyParams = meta.params.filter((spec) => !spec.view)

  const renderControl = (spec: ParamSpec) => {
    if (spec.options) {
      // A strategy switch is only legible if the page says what changed, so an
      // option that carries its own explanation shows it under the selector.
      const chosen = spec.options.find((option) => option.value === params[spec.key])
      return (
        <Fragment key={spec.key}>
          <label className="control">
            <span className="control-label">
              <InfoTip text={spec.info}>{spec.label}</InfoTip>
            </span>
            <select
              value={String(params[spec.key])}
              onChange={(event) => setParam(spec.key, Number(event.target.value))}
            >
              {spec.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {chosen?.hint && <p className="hint">{chosen.hint}</p>}
        </Fragment>
      )
    }
    return (
      <Slider
        key={spec.key}
        label={spec.label}
        info={spec.info}
        value={params[spec.key]}
        display={spec.format ? spec.format(params[spec.key]) : params[spec.key].toFixed(2)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(value) => setParam(spec.key, value)}
      />
    )
  }

  return (
    <Workspace
      topic="shaders"
      library={<ConfigPanel spec={shaderSpec} settings={settings} onLoad={applySettings} />}
      view={
        <ViewControls>
          {viewParams.length > 0 ? (
            viewParams.map(renderControl)
          ) : (
            <p className="hint">
              Nothing to adjust here for this study — its controls are all part of the
              technique, so they stay in the sidebar.
            </p>
          )}
        </ViewControls>
      }
      inspector={
        <aside className="control-sidebar" aria-label="Shader controls">
        <h3 className="control-group">
          <InfoTip text="Four simulations that run entirely on the GPU. Each keeps its state in a floating-point texture, and one step is a full-screen pass that reads the old state and writes the new one. Swapping here tears the running one down and builds the next.">
            Strategy
          </InfoTip>
        </h3>

        <label className="control">
          <span className="control-label">
            <InfoTip text={meta.blurb}>Study</InfoTip>
          </span>
          <select value={simulationId} onChange={(event) => setSimulationId(event.target.value)}>
            {GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {SIMULATIONS.filter((option) => option.group === group).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <p className="hint">{meta.blurb}</p>

        <label className="control">
          <span className="control-label">
            <InfoTip text="A named point in this simulation's parameter space. Changing any value the preset set drops the name, because it no longer describes what is on screen.">
              Preset
            </InfoTip>
          </span>
          <select
            value={presetName[simulationId] ?? ''}
            onChange={(event) => applyPreset(event.target.value)}
          >
            <option value="">Custom</option>
            {meta.presets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {preset && <p className="hint">{preset.hint}</p>}

        {/* Play and Step advance a simulation. The shading study has none — its
            terrain is built once and held — so on that one they were live
            controls that did nothing. Reset stays: it re-centres the camera. */}
        <div className="button-row">
          <button
            type="button"
            className="reset-button"
            onClick={() => setRunning((v) => !v)}
            disabled={!meta.accumulates}
            title={meta.accumulates ? undefined : 'This study has no simulation to run'}
          >
            {running ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="reset-button"
            onClick={() => setStepToken((v) => v + 1)}
            disabled={running || !meta.accumulates}
            title={meta.accumulates ? undefined : 'This study has no simulation to step'}
          >
            Step
          </button>
          <button
            type="button"
            className="reset-button"
            onClick={() => setResetToken((v) => v + 1)}
          >
            Reset
          </button>
        </div>

        {!meta.accumulates && (
          <p className="hint">
            Nothing is simulated here, so there is nothing to play or step. Reset re-centres
            the camera.
          </p>
        )}

        <p className="readout">
          <strong>{report.fps.toFixed(0)}</strong> frames/s ·{' '}
          <InfoTip text="Wall-clock time this page spends issuing a frame's work, averaged over half a second. It is not GPU kernel time: the driver returns from a draw call long before the GPU has finished it, so this measures how much work the page hands over, not how long the hardware takes to do it.">
            <strong>{report.ms.toFixed(2)} ms</strong> submitted
          </InfoTip>
          {report.stats.map((stat) => (
            <span key={stat.label}>
              <br />
              {stat.label}: <strong>{stat.value}</strong>
            </span>
          ))}
        </p>

        <p className="hint">
          {simulationId === 'shading'
            ? 'Drag to orbit the surface. Nothing here is simulated — the terrain is fixed so the shaders can be compared.'
            : simulationId === 'boids'
              ? 'Drag on the view to interact — the pointer is a predator the school avoids.'
              : 'Drag on the view to interact.'}
        </p>

        <h3 className="control-group">
          <InfoTip text="Everything below feeds the simulation as a uniform. A change takes effect on the next step without restarting, so the state you are looking at carries across.">
            Parameters
          </InfoTip>
        </h3>

        {studyParams.map(renderControl)}
        </aside>
      }
    >
      <ShaderViewport
        simulationId={simulationId}
        params={params}
        running={running}
        resetToken={resetToken}
        stepToken={stepToken}
        onReport={setReport}
      />
    </Workspace>
  )
}
