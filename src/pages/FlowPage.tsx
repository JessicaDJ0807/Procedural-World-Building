import { useCallback, useState } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { Workspace } from '../Workspace'
import { FLOW_SPECS, defaultFlowSettings, flowSpec, type FlowSettings, type FlowSpec } from '../config/flowConfig'
import { generateVortices, type Vortex } from '../flow/field'
import { FlowViewport, type FlowReport } from '../flow/FlowViewport'
import '../study/study.css'

const byKey = (key: FlowSpec['key']) => FLOW_SPECS.find((s) => s.key === key) as FlowSpec

export function FlowPage() {
  const [settings, setSettings] = useState<FlowSettings>(defaultFlowSettings)
  // Running on arrival, unlike Topic 4's simulations. There the first frame
  // is a meaningful initial condition; here a paused page is an empty dark
  // rectangle, because the trails only exist once particles have moved.
  const [running, setRunning] = useState(true)
  const [resetToken, setResetToken] = useState(0)
  const [report, setReport] = useState<FlowReport | null>(null)

  const set = (key: FlowSpec['key'], value: number) =>
    setSettings((s) => {
      if (key !== 'vortexCount') return { ...s, [key]: value }
      // More vortices: the seed's next ones are appended, and the ones already
      // there — including any that were dragged — stay where they are.
      const generated = generateVortices(s.seed, value)
      return { ...s, vortexCount: value, vortices: generated.map((v, i) => s.vortices[i] ?? v) }
    })

  const regenerate = () =>
    setSettings((s) => {
      const seed = (s.seed % 999) + 1
      return { ...s, seed, vortices: generateVortices(seed, s.vortexCount) }
    })

  const onVortexMove = useCallback(
    (index: number, vortex: Vortex) =>
      setSettings((s) => ({ ...s, vortices: s.vortices.map((v, i) => (i === index ? vortex : v)) })),
    [],
  )

  const slider = (key: FlowSpec['key']) => {
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

  const ratio = report ? report.divergence.maxDiv / Math.max(report.divergence.meanGrad, 1e-9) : 0

  return (
    <Workspace
      topic="flow"
      library={<ConfigPanel spec={flowSpec} settings={settings} onLoad={(next) => setSettings(next)} />}
      inspector={
        <aside className="control-sidebar" aria-label="Vector field controls">
          <h3 className="control-group">
            <InfoTip text="One 2D velocity field, v(p) = current + vortices + curl noise + stirs. Every particle asks this same function for its velocity; none of them has any motion of its own.">
              Field
            </InfoTip>
          </h3>
          {slider('current')}
          {slider('vortexCount')}
          {slider('vortexStrength')}
          {slider('vortexRadius')}
          {slider('noise')}

          <h3 className="control-group">
            <InfoTip text="The particles only make the field visible. Each is a position, last frame's position, an age and a lifetime — advected by the midpoint method and drawn as one segment per frame into a buffer that fades.">
              Particles
            </InfoTip>
          </h3>
          {slider('particles')}
          {slider('speed')}
          {slider('persistence')}

          <h3 className="control-group">Show</h3>
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="A sparse grid of arrows, each the field's velocity at that point. Turn it on over a strong vortex and the particles can be seen doing exactly what the arrows say.">
                Show vector field
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={settings.showField}
              onChange={(e) => setSettings((s) => ({ ...s, showField: e.target.checked }))}
            />
          </label>
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="A dashed ring at each vortex's radius of peak speed, with a chevron for its spin. Drag the cross at the centre to move the vortex; anywhere else, a drag stirs the fluid.">
                Vortex handles
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={settings.showHandles}
              onChange={(e) => setSettings((s) => ({ ...s, showHandles: e.target.checked }))}
            />
          </label>

          <div className="button-row">
            <button type="button" className="reset-button is-primary" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="reset-button"
              onClick={regenerate}
              title="New seed: new vortex layout and new noise"
            >
              Regenerate
            </button>
            <button
              type="button"
              className="reset-button"
              onClick={() => setResetToken((t) => t + 1)}
              title="Respawn every particle and clear the trails; the field is unchanged"
            >
              Reset
            </button>
          </div>
          <p className="hint">
            Drag on the flow to stir it. Drag a vortex's centre cross to move it. Seed{' '}
            {settings.seed}.
          </p>

          {report && (
            <p className="readout">
              <strong>{report.fps.toFixed(0)}</strong> frames/s ·{' '}
              <InfoTip text="Main-thread time to advance every particle one step and write its segment, averaged over half a second. Rendering is not included.">
                step <strong>{report.stepMs.toFixed(1)} ms</strong>
              </InfoTip>
              <br />
              <strong>{report.particles.toLocaleString()}</strong> particles ·{' '}
              <strong>{report.evaluations.toLocaleString()}</strong> field samples/frame
              <br />
              {report.stirs > 0 && (
                <>
                  <strong>{report.stirs}</strong> stirs decaying
                  <br />
                </>
              )}
              <InfoTip text="Largest |∇·v| found on a 48 × 32 grid, as a fraction of the mean velocity gradient. Every term of the field is divergence-free on paper; this checks it numerically. What remains is finite-difference error — mostly at the lattice lines of the value noise, whose fade is only once-differentiable.">
                divergence <strong>{ratio.toExponential(1)}</strong> of the gradient
              </InfoTip>
            </p>
          )}
        </aside>
      }
    >
      <FlowViewport
        settings={settings}
        running={running}
        resetToken={resetToken}
        onReport={setReport}
        onVortexMove={onVortexMove}
      />
      {!running && <div className="study-overlay study-paused">Paused</div>}
    </Workspace>
  )
}
