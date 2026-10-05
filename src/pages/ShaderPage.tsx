import { useMemo, useState } from 'react'
import { InfoTip } from '../InfoTip'
import { ShaderViewport } from '../ShaderViewport'
import { Slider } from '../Slider'
import { GROUPS, SIMULATIONS, getSimulation } from '../gpu'
import { defaults, type ParamSpec, type Stat } from '../gpu/simulation'

type Report = { stats: Stat[]; fps: number; ms: number }

const EMPTY: Report = { stats: [], fps: 0, ms: 0 }

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
  const [running, setRunning] = useState(true)
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

  const renderControl = (spec: ParamSpec) => {
    if (spec.options) {
      return (
        <label className="control" key={spec.key}>
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
    <div className="shader-page">
      <ShaderViewport
        simulationId={simulationId}
        params={params}
        running={running}
        resetToken={resetToken}
        stepToken={stepToken}
        onReport={setReport}
      />

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

        <div className="button-row">
          <button type="button" className="reset-button" onClick={() => setRunning((v) => !v)}>
            {running ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="reset-button"
            onClick={() => setStepToken((v) => v + 1)}
            disabled={running}
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

        {meta.params.map(renderControl)}
      </aside>
    </div>
  )
}
