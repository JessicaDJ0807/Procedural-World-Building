import { useMemo, useState } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { Workspace } from '../Workspace'
import {
  DEBUG_VIEWS,
  DENSITY_SPEC,
  RULE_SPECS,
  SEED_RANGE,
  defaultDistributionSettings,
  distributionSpec,
  type DistributionSettings,
} from '../config/distributionConfig'
import {
  DistributionViewport,
  type DebugView,
  type Probe,
  type ScatterReport,
} from '../distributions/DistributionViewport'
import { ASSETS, KINDS, defaultRules, type AssetKind, type Rule, type Rules } from '../distributions/rules'
import '../study/study.css'

const INITIAL = defaultDistributionSettings()

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

export function DistributionPage() {
  const [terrainSeed, setTerrainSeed] = useState(INITIAL.terrainSeed)
  const [scatterSeed, setScatterSeed] = useState(INITIAL.scatterSeed)
  const [debug, setDebug] = useState<DebugView>(INITIAL.debug)
  const [rules, setRules] = useState<Rules>(INITIAL.rules)
  const [editing, setEditing] = useState<AssetKind>('tree')
  const [showAssets, setShowAssets] = useState(true)
  const [showWater, setShowWater] = useState(true)
  const [report, setReport] = useState<ScatterReport | null>(null)
  const [probe, setProbe] = useState<Probe>(null)

  const setRule = (kind: AssetKind, key: keyof Rule, value: number) =>
    setRules((current) => ({ ...current, [kind]: { ...current[kind], [key]: value } }))

  const settings = useMemo<DistributionSettings>(
    () => ({ terrainSeed, scatterSeed, debug, rules }),
    [terrainSeed, scatterSeed, debug, rules],
  )

  const applySettings = (next: DistributionSettings) => {
    setTerrainSeed(next.terrainSeed)
    setScatterSeed(next.scatterSeed)
    setDebug(next.debug)
    setRules(next.rules)
  }

  const view = DEBUG_VIEWS.find((v) => v.value === debug)
  const rule = rules[editing]

  return (
    <Workspace
      topic="distributions"
      library={<ConfigPanel spec={distributionSpec} settings={settings} onLoad={applySettings} />}
      view={
        <ViewControls>
          <label className="control control-toggle">
            <span className="control-label">Show assets</span>
            <input type="checkbox" checked={showAssets} onChange={(e) => setShowAssets(e.target.checked)} />
          </label>
          <label className="control control-toggle">
            <span className="control-label">Show water</span>
            <input type="checkbox" checked={showWater} onChange={(e) => setShowWater(e.target.checked)} />
          </label>
          <p className="hint">Drag to orbit, scroll to zoom. Hover the ground to probe it.</p>
        </ViewControls>
      }
      inspector={
        <aside className="control-sidebar" aria-label="Distribution controls">
          <h3 className="control-group">
            <InfoTip text="Each asset type is a layer with its own rule. A rule turns the ground at a point — elevation, slope, distance to water — into a probability, and the scatter keeps a candidate when a seeded random draw falls under it.">
              Layers
            </InfoTip>
          </h3>
          {KINDS.map((kind) => (
            <Slider
              key={kind}
              label={`${ASSETS[kind].plural} density`}
              info={`Multiplies every ${ASSETS[kind].label.toLowerCase()} probability. Above 1 the best ground saturates first, so the layer thickens where it already was rather than spreading. ${ASSETS[kind].summary}`}
              value={rules[kind].density}
              display={rules[kind].density.toFixed(2)}
              min={DENSITY_SPEC.min}
              max={DENSITY_SPEC.max}
              step={DENSITY_SPEC.step}
              onChange={(v) => setRule(kind, 'density', v)}
            />
          ))}

          <h3 className="control-group">
            <InfoTip text="The environmental constraints for one layer. Every edge is soft — a smoothstep a few degrees or a few hundredths wide — so a threshold reads as a thinning rather than a line where instances stop dead.">
              Rule
            </InfoTip>
          </h3>
          <div className="segmented" role="tablist" aria-label="Layer to edit">
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={editing === kind}
                className={`segmented-option${editing === kind ? ' is-active' : ''}`}
                onClick={() => setEditing(kind)}
              >
                <span className="swatch" style={{ background: hex(ASSETS[kind].mask) }} />
                {ASSETS[kind].plural}
              </button>
            ))}
          </div>
          <p className="hint">{ASSETS[editing].summary}</p>
          {RULE_SPECS.map((spec) => (
            <Slider
              key={spec.key}
              label={spec.label}
              info={spec.info}
              value={rule[spec.key]}
              display={spec.format(rule[spec.key])}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              onChange={(v) => setRule(editing, spec.key, v)}
            />
          ))}
          {editing === 'rock' && (
            <p className="hint">
              Rocks carry one more factor: 1 − 0.75 × the stronger of the tree and bush
              probabilities at that point, so they take over where vegetation thins.
            </p>
          )}

          <h3 className="control-group">
            <InfoTip text="What the terrain is painted with. The probability views evaluate the same function the scatter sampled, at every vertex, so an instance off a lit patch would be a bug.">
              Debug view
            </InfoTip>
          </h3>
          <label className="control">
            <span className="control-label">Show</span>
            <select value={debug} onChange={(e) => setDebug(e.target.value as DebugView)}>
              {DEBUG_VIEWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {view && <p className="hint">{view.hint}</p>}

          <h3 className="control-group">
            <InfoTip text="Both are deterministic: the same two seeds and the same rules always give the same scatter, on any machine.">
              Seeds
            </InfoTip>
          </h3>
          <Slider
            label="Terrain seed"
            info="Rebuilds the ground — noise and erosion — in about 100 ms. The waterline is re-set to the same 16% of the ground for every seed."
            value={terrainSeed}
            display={String(terrainSeed)}
            min={SEED_RANGE.min}
            max={40}
            step={1}
            onChange={setTerrainSeed}
          />
          <Slider
            label="Scatter seed"
            info="The random draws: candidate jitter, acceptance, and per-instance variation, plus the cluster noise. Same rules, different roll of the dice."
            value={scatterSeed}
            display={String(scatterSeed)}
            min={SEED_RANGE.min}
            max={SEED_RANGE.max}
            step={1}
            onChange={setScatterSeed}
          />
          <div className="button-row">
            <button
              type="button"
              className="reset-button is-primary"
              onClick={() => setScatterSeed((s) => (s % SEED_RANGE.max) + 1)}
            >
              Regenerate
            </button>
            <button type="button" className="reset-button" onClick={() => setRules(defaultRules())}>
              Reset rules
            </button>
          </div>

          {report && (
            <p className="readout">
              {KINDS.map((kind) => (
                <span key={kind}>
                  {ASSETS[kind].plural}: <strong>{report.counts[kind].toLocaleString()}</strong> of{' '}
                  {report.candidates[kind].toLocaleString()} candidates
                  <br />
                </span>
              ))}
              <InfoTip text="Wall-clock time on the main thread. The scatter evaluates all three rules at every candidate — 11,640 points; the mask evaluates them at every one of the 16,641 terrain vertices.">
                scatter <strong>{report.scatterMs.toFixed(0)} ms</strong> · mask{' '}
                <strong>{report.maskMs.toFixed(0)} ms</strong> · terrain{' '}
                <strong>{report.terrainMs.toFixed(0)} ms</strong>
              </InfoTip>
              <br />5 instanced meshes, 5 draw calls
            </p>
          )}
        </aside>
      }
    >
      <DistributionViewport
        terrainSeed={terrainSeed}
        scatterSeed={scatterSeed}
        rules={rules}
        debug={debug}
        showAssets={showAssets}
        showWater={showWater}
        onReport={setReport}
        onProbe={setProbe}
      />
      <ProbePanel probe={probe} />
      {debug !== 'natural' && <Legend view={debug} />}
    </Workspace>
  )
}

/**
 * The rule's working, at the point under the pointer.
 *
 * The whole argument of the page in one table: each column is a question the
 * rule asks about the ground, and the last is their product. A zero anywhere
 * says exactly why nothing grows here.
 */
function ProbePanel({ probe }: { probe: Probe }) {
  if (!probe) {
    return (
      <div className="study-overlay study-probe is-idle">
        Hover the terrain to see why each asset can or cannot grow there.
      </div>
    )
  }
  const { ground, factors } = probe
  const pct = (v: number) => (v >= 0.995 ? '1' : v <= 0.005 ? '0' : v.toFixed(2))
  return (
    <div className="study-overlay study-probe">
      <div className="probe-ground">
        {ground.underwater ? (
          <strong>Under water — nothing is placed</strong>
        ) : (
          <>
            elevation <strong>{ground.elevation.toFixed(2)}</strong> · slope{' '}
            <strong>{ground.slope.toFixed(0)}°</strong> · water{' '}
            <strong>{ground.waterDist.toFixed(2)}</strong> away
          </>
        )}
      </div>
      <table className="probe-table">
        <thead>
          <tr>
            <th />
            <th>elev</th>
            <th>slope</th>
            <th>water</th>
            <th>patch</th>
            <th>sparse</th>
            <th>p</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map((kind) => {
            const f = factors[kind]
            return (
              <tr key={kind}>
                <th>
                  <span className="swatch" style={{ background: hex(ASSETS[kind].mask) }} />
                  {ASSETS[kind].plural}
                </th>
                <td className={f.elevation < 0.05 ? 'is-veto' : ''}>{pct(f.elevation)}</td>
                <td className={f.slope < 0.05 ? 'is-veto' : ''}>{pct(f.slope)}</td>
                <td>{pct(f.water)}</td>
                <td>{pct(f.cluster)}</td>
                <td>{kind === 'rock' ? pct(f.sparse) : '—'}</td>
                <td className="probe-p">{pct(f.p)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Legend({ view }: { view: DebugView }) {
  const label =
    view === 'elevation' ? ['shore', 'summit'] : view === 'slope' ? ['0°', '45°+'] : view === 'water' ? ['far', 'at water'] : ['p = 0', 'p = 1']
  const gradient =
    view === 'tree' || view === 'bush' || view === 'rock'
      ? `linear-gradient(90deg, #2b2d31, ${hex(ASSETS[view].mask)})`
      : view === 'water'
        ? 'linear-gradient(90deg, #30343a, #7d9cc9)'
        : view === 'all'
          ? null
          : 'linear-gradient(90deg, #30343a, #e6e0d4)'
  return (
    <div className="study-overlay study-legend">
      {gradient ? (
        <>
          <span>{label[0]}</span>
          <span className="legend-bar" style={{ background: gradient }} />
          <span>{label[1]}</span>
        </>
      ) : (
        KINDS.map((kind) => (
          <span key={kind} className="legend-key">
            <span className="swatch" style={{ background: hex(ASSETS[kind].mask) }} />
            {ASSETS[kind].plural}
          </span>
        ))
      )}
    </div>
  )
}
