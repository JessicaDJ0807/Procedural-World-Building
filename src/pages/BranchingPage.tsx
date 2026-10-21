import { useMemo, useState, type ReactNode } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { ControlSection } from '../ControlSection'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { Workspace } from '../Workspace'
import { BranchingViewport, type BuildReport, type ScatterReport } from '../branching/BranchingViewport'
import { STRATEGIES, type Strategy } from '../branching/distribution'
import type { FrameStats } from '../branching/ForestRenderer'
import { LODS } from '../branching/lod'
import { MAX_SYMBOLS, expand, parseProductions } from '../branching/lsystem'
import type { LeafPlacement } from '../branching/skeleton'
import {
  GRAMMARS,
  PALETTES,
  PRESETS,
  presetSettings,
  type BranchingSettings,
  type DisplaySettings,
  type ForestSettings,
  type LodSettings,
  type PaletteId,
  type PresetId,
  type TreeSettings,
  type View,
} from '../branching/presets'
import { GENERATION_COLOURS, type LeafShape } from '../branching/treeGeometry'
import {
  FOREST_SPECS,
  GEOMETRY_SPECS,
  GRAMMAR_SPECS,
  LOD_SPECS,
  branchingSpec,
  defaultBranchingSettings,
  type NumberSpec,
} from '../config/branchingConfig'
import '../study/study.css'
import '../branching/branching.css'

const VIEWS: { value: View; label: string; hint: string }[] = [
  { value: 'tree', label: 'Tree', hint: 'One tree, close up. Scrub the turtle to watch the grammar draw it.' },
  { value: 'lineup', label: 'LOD lineup', hint: 'The same tree at all four levels of detail, left to right, each pinned to its level.' },
  { value: 'forest', label: 'Forest', hint: 'The tree, instanced across the ground by the distribution, each at the level its distance calls for.' },
]

const LEAF_SHAPES: { value: LeafShape; label: string }[] = [
  { value: 'cluster', label: 'Leaf clumps' },
  { value: 'needles', label: 'Needle tufts' },
  { value: 'bulb', label: 'Bulbs' },
]

const normaliseRules = (rules: string) => rules.replace(/\s+/g, '')

/** Strategy-specific sliders: only the ones the chosen strategy reads are shown. */
const STRATEGY_KEYS = new Set<keyof ForestSettings>(['minSpacing', 'clusterCount', 'clusterRadius', 'jitter'])

const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString()

export function BranchingPage() {
  const [settings, setSettings] = useState<BranchingSettings>(defaultBranchingSettings)
  const [frameToken, setFrameToken] = useState(0)
  const [build, setBuild] = useState<BuildReport | null>(null)
  const [scatter, setScatter] = useState<ScatterReport | null>(null)
  const [stats, setStats] = useState<FrameStats | null>(null)

  const { tree, forest, lod, display } = settings

  // The grammar is expanded here rather than in the viewport so the page can
  // show the string itself — the one stage of the pipeline that is text.
  const expansion = useMemo(
    () => expand(tree.axiom, parseProductions(tree.rules), tree.iterations),
    [tree.axiom, tree.rules, tree.iterations],
  )

  // Any edit to what is generated makes this a custom world; display toggles do not.
  const setTree = <K extends keyof TreeSettings>(key: K, value: TreeSettings[K]) =>
    setSettings((s) => ({ ...s, preset: 'custom', tree: { ...s.tree, [key]: value } }))
  const setForest = <K extends keyof ForestSettings>(key: K, value: ForestSettings[K]) =>
    setSettings((s) => ({ ...s, preset: 'custom', forest: { ...s.forest, [key]: value } }))
  const setLod = <K extends keyof LodSettings>(key: K, value: LodSettings[K]) =>
    setSettings((s) => ({ ...s, lod: { ...s.lod, [key]: value } }))
  const setDisplay = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) =>
    setSettings((s) => ({ ...s, display: { ...s.display, [key]: value } }))

  const applyPreset = (id: PresetId) => {
    setSettings((s) => presetSettings(id, s.display))
    setFrameToken((t) => t + 1)
  }
  const setView = (view: View) => {
    setDisplay('view', view)
    setFrameToken((t) => t + 1)
  }

  const grammarId =
    GRAMMARS.find((g) => g.axiom === tree.axiom && normaliseRules(g.rules) === normaliseRules(tree.rules))?.id ?? 'custom'
  const pickGrammar = (id: string) => {
    const g = GRAMMARS.find((entry) => entry.id === id)
    if (!g) return
    setSettings((s) => ({
      ...s,
      preset: 'custom',
      tree: { ...s.tree, axiom: g.axiom, rules: g.rules, angle: g.angle, iterations: g.iterations },
    }))
    setFrameToken((t) => t + 1)
  }

  const treeSlider = (spec: NumberSpec<keyof TreeSettings>) => {
    const value = tree[spec.key] as number
    return (
      <Slider
        key={spec.key}
        label={spec.label}
        info={spec.info}
        value={value}
        display={spec.format ? spec.format(value) : String(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(v) => setTree(spec.key, v as never)}
      />
    )
  }
  const forestSlider = (spec: NumberSpec<keyof ForestSettings>) => {
    const value = forest[spec.key] as number
    return (
      <Slider
        key={spec.key}
        label={spec.label}
        info={spec.info}
        value={value}
        display={spec.format ? spec.format(value) : String(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(v) => setForest(spec.key, v as never)}
      />
    )
  }

  const strategy = STRATEGIES.find((s) => s.value === forest.strategy) ?? STRATEGIES[0]
  const view = VIEWS.find((v) => v.value === display.view) ?? VIEWS[0]
  const inForest = display.view === 'forest'

  return (
    <Workspace
      topic="branching"
      library={
        <ConfigPanel
          spec={branchingSpec}
          settings={settings}
          onLoad={(next) => {
            setSettings(next)
            setFrameToken((t) => t + 1)
          }}
        />
      }
      inspector={
        <aside className="control-sidebar" aria-label="Branching controls">
          <h3 className="control-group">
            <InfoTip text="Each preset is a complete setting of the same pipeline — grammar, turtle, leaves, colours and forest. Nothing in the code branches on which one is chosen.">
              Presets
            </InfoTip>
          </h3>
          <div className="branching-presets" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`branching-preset${settings.preset === p.id ? ' is-active' : ''}`}
                aria-pressed={settings.preset === p.id}
                onClick={() => applyPreset(p.id)}
                title={`${p.label} — ${p.blurb}`}
              >
                <span className="swatch" style={{ background: PALETTES[p.id as PaletteId].leafHigh }} />
                {p.short}
              </button>
            ))}
          </div>
          <p className="hint">
            {settings.preset === 'custom'
              ? 'Custom — edited from a preset. Pick one to start again.'
              : (() => {
                  // The buttons carry one word each; the full name lives here.
                  const preset = PRESETS.find((p) => p.id === settings.preset)
                  return preset && (
                    <>
                      <span className="branching-preset-name">{preset.label}.</span> {preset.blurb}
                    </>
                  )
                })()}
          </p>

          <h3 className="control-group">View</h3>
          <div className="segmented" role="tablist" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={display.view === v.value}
                className={`segmented-option${display.view === v.value ? ' is-active' : ''}`}
                onClick={() => setView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="hint">{view.hint}</p>

          <ControlSection
            title="L-System"
            info="A string rewritten in parallel. Every symbol is replaced by its production at once, every iteration; symbols with no production copy themselves. The turtle then reads the result: F draws, + and − turn, [ and ] save and restore."
          >
            <label className="control">
              <span className="control-label">Grammar</span>
              <select value={grammarId} onChange={(e) => pickGrammar(e.target.value)}>
                {grammarId === 'custom' && <option value="custom">Custom (edited)</option>}
                {GRAMMARS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              <span className="control-label">
                <InfoTip text="The string the rewriting starts from.">Axiom</InfoTip>
              </span>
              <input
                type="text"
                className="grammar-input"
                value={tree.axiom}
                spellCheck={false}
                onChange={(e) => setTree('axiom', e.target.value)}
              />
            </label>
            <label className="control">
              <span className="control-label">
                <InfoTip text="One production per line, symbol = replacement. F draws forward, f moves without drawing, + − turn, & ^ pitch, / \ roll, [ ] push and pop. Any other letter is a placeholder the grammar rewrites but the turtle ignores — X and A are growing tips.">
                  Rules
                </InfoTip>
              </span>
              <textarea
                className="grammar-input"
                rows={Math.max(2, tree.rules.split('\n').length)}
                value={tree.rules}
                spellCheck={false}
                onChange={(e) => setTree('rules', e.target.value)}
              />
            </label>
            {GRAMMAR_SPECS.map(treeSlider)}
            <Derivation expansion={expansion} />
            {display.view === 'tree' && (
              <Slider
                label="Turtle progress"
                info="Draw only the first part of the turtle's walk, in the order it walked. Watch it climb a limb, branch at each [, and jump back at each ]. Shown at LOD 0, the only level that keeps every segment."
                value={display.progress}
                display={`${Math.round(display.progress * 100)}%`}
                min={0}
                max={1}
                step={0.005}
                onChange={(v) => setDisplay('progress', v)}
              />
            )}
          </ControlSection>

          <ControlSection
            title="Tree Geometry"
            info="The skeleton becomes tapered tubes and leaf clumps, written directly into one wood mesh and one leaf mesh per level of detail."
          >
            {GEOMETRY_SPECS.map(treeSlider)}
            <label className="control">
              <span className="control-label">Leaf shape</span>
              <select value={tree.leafShape} onChange={(e) => setTree('leafShape', e.target.value as LeafShape)}>
                {LEAF_SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              <span className="control-label">
                <InfoTip text="Which segments carry leaves. Twigs: every segment of the last two generations, plus every limb's tip. Tips only: the end of each limb and nothing else — polyps, flowers, buds.">
                  Leaves on
                </InfoTip>
              </span>
              <select value={tree.leafPlacement} onChange={(e) => setTree('leafPlacement', e.target.value as LeafPlacement)}>
                <option value="twigs">Twigs and tips</option>
                <option value="tips">Limb tips only</option>
              </select>
            </label>
            {forestSlider(FOREST_SPECS.find((s) => s.key === 'treeScale')!)}
            {build && (
              <p className="readout">
                <strong>{build.segments.toLocaleString()}</strong> segments ·{' '}
                <strong>{build.maxGeneration + 1}</strong> generations ·{' '}
                <strong>{build.leaves.toLocaleString()}</strong> leaves
                <br />
                height <strong>{(build.height * forest.treeScale).toFixed(1)}</strong> · turtle{' '}
                <strong>{build.turtleMs.toFixed(1)} ms</strong> · meshes{' '}
                <strong>{build.geometryMs.toFixed(0)} ms</strong>
                {build.types > 1 && <> for {build.types} types</>}
                {build.truncated && (
                  <>
                    <br />
                    <span className="readout-warn">Stopped at the segment limit — lower the iterations.</span>
                  </>
                )}
              </p>
            )}
          </ControlSection>

          <ControlSection
            title="Distribution"
            info="Where the trees go. The ground is flat on purpose: the only difference between two forests here is how their points were drawn."
          >
            {!inForest && (
              <p className="hint">
                Shown in the Forest view.{' '}
                <button type="button" className="link-button" onClick={() => setView('forest')}>
                  Switch to it
                </button>
              </p>
            )}
            <label className="control">
              <span className="control-label">Strategy</span>
              <select value={forest.strategy} onChange={(e) => setForest('strategy', e.target.value as Strategy)}>
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{strategy.hint}</p>
            {FOREST_SPECS.filter(
              (s) => s.key !== 'treeScale' && (!STRATEGY_KEYS.has(s.key) || (strategy.uses as string[]).includes(s.key)),
            ).map(forestSlider)}
            <div className="button-row">
              <button
                type="button"
                className="reset-button is-primary"
                onClick={() => setForest('scatterSeed', (forest.scatterSeed % 999) + 1)}
              >
                Regenerate
              </button>
            </div>
            {scatter && inForest && (
              <p className="readout">
                <strong>{scatter.placed.toLocaleString()}</strong> placed
                {scatter.refused > 0 && (
                  <>
                    {' '}· <strong>{scatter.refused.toLocaleString()}</strong> would not fit
                  </>
                )}{' '}
                · {scatter.ms.toFixed(1)} ms
                <br />
                <InfoTip text="Clark–Evans ratio: the mean distance from each tree to its nearest neighbour, divided by what uniform random placement at the same density would give. About 1 is random; below 1, clustered; above 1, evenly spaced. A perfect hexagonal lattice is 2.15.">
                  nearest-neighbour ratio <strong>{scatter.ratio.toFixed(2)}</strong>
                </InfoTip>{' '}
                · closest pair <strong>{scatter.minNearest.toFixed(2)}</strong>
              </p>
            )}
          </ControlSection>

          <ControlSection
            title="Level of Detail"
            info="Every tree is built four times. Auto picks a level per tree from its distance to the camera; off, every tree uses the level chosen below. Changing these touches no geometry — a tree changing level only moves its matrix to another instanced mesh."
          >
            <label className="control control-toggle">
              <span className="control-label">Auto LOD by distance</span>
              <input type="checkbox" checked={lod.auto} onChange={(e) => setLod('auto', e.target.checked)} />
            </label>
            {lod.auto &&
              LOD_SPECS.map((spec) => (
                <Slider
                  key={spec.key}
                  label={spec.label}
                  info={spec.info}
                  value={lod[spec.key]}
                  display={spec.format ? spec.format(lod[spec.key]) : String(lod[spec.key])}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  onChange={(v) => setLod(spec.key, v)}
                />
              ))}
            {(!lod.auto || !inForest) && (
              <>
                <div className="segmented" role="tablist" aria-label="Manual level">
                  {LODS.map((l, i) => (
                    <button
                      key={l.short}
                      type="button"
                      role="tab"
                      aria-selected={lod.manual === i}
                      className={`segmented-option${lod.manual === i ? ' is-active' : ''}`}
                      onClick={() => setLod('manual', i)}
                    >
                      <span className="swatch" style={{ background: l.colour }} />
                      {i}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  {inForest
                    ? `Every tree is held at ${LODS[lod.manual].short}, ${LODS[lod.manual].name.toLowerCase()}, whatever its distance.`
                    : display.view === 'tree'
                      ? `The tree is shown at ${LODS[lod.manual].short}, ${LODS[lod.manual].name.toLowerCase()}. Auto LOD applies in the Forest view.`
                      : 'The lineup pins each tree to its own level; this sets the Tree view.'}
                </p>
              </>
            )}
            {build && <LodTable build={build} showLeaves={display.showLeaves} />}
          </ControlSection>

          <ControlSection title="Display" info="How the trees are drawn. None of these change where a tree is or what its grammar says.">
            <Toggle
              label="Show skeleton"
              info="Every F as a thin rod of one width — the branch graph the turtle drew, before any thickness was given to it."
              checked={display.showSkeleton}
              onChange={(v) => setDisplay('showSkeleton', v)}
            />
            <Toggle
              label="Colour by generation"
              info="Colour each segment by how many brackets were open when it was drawn: the trunk, the branches off it, the branches off those."
              checked={display.colourByGeneration}
              onChange={(v) => setDisplay('colourByGeneration', v)}
            />
            <Toggle label="Show leaves" checked={display.showLeaves} onChange={(v) => setDisplay('showLeaves', v)} />
            <Toggle
              label="Show LOD colours"
              info="Paint every tree in the colour of the level it is drawn at."
              checked={display.showLodColours}
              onChange={(v) => setDisplay('showLodColours', v)}
            />
            <Toggle
              label="Show LOD rings"
              info="In the forest with auto LOD: a ring on the ground where the distance from the camera crosses each threshold, coloured for the level a tree switches to. Measured from the camera, so the rings follow it."
              checked={display.showRings}
              onChange={(v) => setDisplay('showRings', v)}
            />
          </ControlSection>
        </aside>
      }
    >
      <BranchingViewport
        settings={settings}
        text={expansion.text}
        frameToken={frameToken}
        onBuild={setBuild}
        onScatter={setScatter}
        onStats={setStats}
      />
      {stats && <StatsOverlay stats={stats} view={display.view} build={build} />}
      {display.colourByGeneration && build && <GenerationLegend generations={build.maxGeneration + 1} />}
    </Workspace>
  )
}

function Toggle({ label, info, checked, onChange }: { label: string; info?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="control control-toggle">
      <span className="control-label">{info ? <InfoTip text={info}>{label}</InfoTip> : label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/**
 * The grammar at work: the string's length after each rewrite, and the start
 * of the final string with its symbols coloured by role.
 */
function Derivation({ expansion }: { expansion: ReturnType<typeof expand> }) {
  const preview = expansion.text.slice(0, 360)
  const spans: ReactNode[] = []
  for (let i = 0; i < preview.length; i++) {
    const c = preview[i]
    const role = c === 'F' || c === 'f' ? 'draw' : '+-&^/\\|'.includes(c) ? 'turn' : c === '[' || c === ']' ? 'bracket' : 'other'
    spans.push(
      <span key={i} className={`sym-${role}`}>
        {c}
      </span>,
    )
  }
  return (
    <div className="derivation">
      <table className="derivation-table">
        <thead>
          <tr>
            <th>n</th>
            <th>symbols</th>
            <th>F</th>
          </tr>
        </thead>
        <tbody>
          {expansion.lengths.map((length, n) => (
            <tr key={n}>
              <td>{n}</td>
              <td>{length.toLocaleString()}</td>
              <td>{expansion.draws[n].toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {expansion.truncated && (
        <p className="readout-warn">
          Iteration {expansion.iterations + 1} would pass {MAX_SYMBOLS.toLocaleString()} symbols and was not run.
        </p>
      )}
      <div className="derivation-string" aria-label="Expanded string">
        {spans}
        {expansion.text.length > preview.length && <span className="sym-more"> … +{(expansion.text.length - preview.length).toLocaleString()}</span>}
      </div>
      <p className="hint">expanded in {expansion.ms.toFixed(1)} ms</p>
    </div>
  )
}

function LodTable({ build, showLeaves }: { build: BuildReport; showLeaves: boolean }) {
  const full = build.lods[0].branchTris + (showLeaves ? build.lods[0].leafTris : 0)
  return (
    <table className="lod-table">
      <thead>
        <tr>
          <th />
          <th>segments</th>
          <th>leaves</th>
          <th>triangles</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {build.lods.map((l, i) => {
          const tris = l.branchTris + (showLeaves ? l.leafTris : 0)
          return (
            <tr key={i}>
              <th>
                <span className="swatch" style={{ background: LODS[i].colour }} />
                {i}
              </th>
              <td>{l.segments.toLocaleString()}</td>
              <td>{l.blobs ? `${l.leaves} blobs` : l.leaves.toLocaleString()}</td>
              <td>{tris.toLocaleString()}</td>
              <td className="lod-share">{full ? `${((tris / full) * 100).toFixed(tris / full < 0.1 ? 1 : 0)}%` : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function StatsOverlay({ stats, view, build }: { stats: FrameStats; view: View; build: BuildReport | null }) {
  if (view === 'lineup' && build) {
    return (
      <div className="study-overlay branching-lineup">
        {LODS.map((l, i) => (
          <span key={l.short} className="lineup-label">
            <span className="swatch" style={{ background: l.colour }} />
            <strong>{l.short}</strong> {l.name.toLowerCase()} · {compact(build.lods[i].triangles)} tris
          </span>
        ))}
      </div>
    )
  }
  const saved = stats.fullTriangles ? 1 - stats.triangles / stats.fullTriangles : 0
  return (
    <div className="study-overlay branching-stats">
      {view === 'forest' ? (
        <>
          <strong>{stats.visible.toLocaleString()}</strong> of {stats.total.toLocaleString()} trees in view
          <div className="lod-counts">
            {LODS.map((l, i) => (
              <span key={l.short} className="legend-key">
                <span className="swatch" style={{ background: l.colour }} />
                {stats.perLod[i].toLocaleString()}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          drawn at{' '}
          <strong>
            <span className="swatch" style={{ background: LODS[stats.perLod.findIndex((n) => n > 0)]?.colour ?? 'transparent' }} />
            {LODS[stats.perLod.findIndex((n) => n > 0)]?.short ?? '—'}
          </strong>
          <br />
        </>
      )}
      <strong>{compact(stats.triangles)}</strong> triangles
      {stats.fullTriangles > stats.triangles && (
        <>
          {' '}of {compact(stats.fullTriangles)} at full detail (<strong>−{(saved * 100).toFixed(0)}%</strong>)
        </>
      )}
      <br />
      {/* The overlay takes no pointer events, so this cannot carry a hover
          tip; the LOD section's own tip says what the pass does. */}
      {stats.drawCalls} draw calls · LOD pass {stats.updateMs.toFixed(2)} ms
    </div>
  )
}

function GenerationLegend({ generations }: { generations: number }) {
  const names = ['trunk', 'primary', 'secondary', 'tertiary']
  return (
    <div className="study-overlay study-legend branching-generations">
      {Array.from({ length: Math.min(generations, GENERATION_COLOURS.length) }, (_, g) => (
        <span key={g} className="legend-key">
          <span className="swatch" style={{ background: GENERATION_COLOURS[g] }} />
          {g === GENERATION_COLOURS.length - 1 && generations > GENERATION_COLOURS.length ? `${g}+` : g}
          {names[g] ? ` ${names[g]}` : ''}
        </span>
      ))}
    </div>
  )
}
