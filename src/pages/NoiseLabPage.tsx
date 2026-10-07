import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ControlSection } from '../ControlSection'
import { InfoTip } from '../InfoTip'
import { NoiseViewport } from '../NoiseViewport'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { Workspace } from '../Workspace'
import { CONTINUOUS, FULL_DOMAIN, PALETTES, buildLut, type PaletteName } from '../palette'
import { VIZ_ACCENT } from '../theme'
import { LabMap } from '../maplab/LabMap'
import { LabProfile } from '../maplab/LabProfile'
import {
  LAB_MAX_AMPLITUDE,
  LAB_PRESETS,
  LAB_RESOLUTION,
  MAX_LAB_LAYERS,
  applyPreset,
  createLabLayer,
  describePipeline,
  matchPreset,
  type CellularMode,
  type LabBlend,
  type LabField,
  type LabFold,
  type LabLayer,
  type LabSettings,
  type LabShaping,
  type NoiseType,
} from '../maplab/noiseLab'
import '../study/study.css'
import '../maplab/maplab.css'

type Option<T> = { value: T; label: string; hint: string }

const NOISE_TYPES: Option<NoiseType>[] = [
  {
    value: 'white',
    label: 'White',
    hint: 'Every sample independent of its neighbours. No scale, nothing to stack — and as terrain, a bed of nails. It is the baseline the other two exist to fix.',
  },
  {
    value: 'perlin',
    label: 'Perlin',
    hint: 'Gradient noise: a random slope at each lattice point, blended with a smooth fade. Features have one characteristic size, so it can be stacked into octaves.',
  },
  {
    value: 'cellular',
    label: 'Cellular',
    hint: 'Worley noise: scatter one point per cell and measure the distance to the nearest. Produces cells, cracks and craters rather than hills.',
  },
]

const CELLULAR_MODES: Option<CellularMode>[] = [
  { value: 'distance', label: 'F1', hint: 'Distance to the nearest point: 0 at every point, rising to the cell walls — round basins.' },
  { value: 'edges', label: 'F2 − F1', hint: 'How much closer the nearest point is than the second nearest: 0 exactly on the walls, so it draws the cell outlines.' },
]

const FOLDS: Option<LabFold>[] = [
  { value: 'none', label: 'None', hint: 'Each octave as it comes.' },
  { value: 'ridged', label: 'Ridged', hint: 'Folds each octave about its middle, so smooth crests become sharp creases. Per octave, not on the sum — that is what puts ridges at every scale.' },
  { value: 'billow', label: 'Billow', hint: 'The opposite fold: creases point down and the tops round off. Reads as dunes, clouds or rounded hills.' },
]

const BLENDS: Option<LabBlend>[] = [
  { value: 'add', label: 'Add', hint: 'Adds this layer on top — detail riding on the shapes below.' },
  { value: 'subtract', label: 'Subtract', hint: 'Takes this layer away — its high points become pits and channels in the ground below.' },
  { value: 'multiply', label: 'Multiply', hint: 'Scales the ground below by this layer — a mask. At weight 1 the ground survives only where this layer is high.' },
  { value: 'max', label: 'Max', hint: 'Keeps whichever is higher — this layer’s peaks rise out of the ground below without lowering anything.' },
]

const SHAPINGS: Option<LabShaping>[] = [
  { value: 'none', label: 'None', hint: 'The stack as it comes.' },
  { value: 'terrace', label: 'Terrace', hint: 'Quantises height into flat steps — mesas, rice paddies, contour lines made solid.' },
  { value: 'power', label: 'Power', hint: 'Raises the value to an exponent. Above 1 flattens the lowlands and sharpens peaks; below 1 does the reverse.' },
]

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segmented-option${value === option.value ? ' is-active' : ''}`}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const label = <T,>(options: Option<T>[], value: T) => options.find((o) => o.value === value)?.label ?? ''

/** One line per layer in the list: enough to tell them apart without opening one. */
function describeLayer(layer: LabLayer, index: number): string {
  const kind =
    layer.noise === 'cellular' ? `Cellular ${label(CELLULAR_MODES, layer.cellular)}` : label(NOISE_TYPES, layer.noise)
  const parts = [kind]
  if (layer.noise !== 'white') parts.push(`${layer.frequency}×`, `${layer.octaves} oct`)
  if (layer.fold !== 'none') parts.push(layer.fold)
  if (index > 0) parts.push(`${label(BLENDS, layer.blend).toLowerCase()} ${layer.weight.toFixed(2)}`)
  return parts.join(' · ')
}

/**
 * Topic 2's Noise tab: noise functions stacked in layers, a few operations on the
 * stack, and what the result means as ground.
 *
 * Everything here is per point and computed once; what happens to the field
 * over time — automata, erosion — is the Simulate tab, which takes this field
 * as its ground. This answers "what is the field, and why does that operation
 * make that landform". Both views are always on screen together — the map is
 * the number, the terrain is the number used as height — so a slider is seen
 * to change both at once.
 */
export function NoiseLabPage({
  switcher,
  settings,
  setSettings,
  field,
}: {
  switcher?: ReactNode
  /** Owned by the parent, because the Simulate tab erodes this same field. */
  settings: LabSettings
  setSettings: Dispatch<SetStateAction<LabSettings>>
  field: LabField
}) {
  const [row, setRow] = useState(Math.floor(LAB_RESOLUTION / 2))
  const [paletteName, setPaletteName] = useState<PaletteName>('land')
  const [spin, setSpin] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const set = <K extends keyof LabSettings>(key: K, value: LabSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  // A removed layer, or a preset that replaced them all, leaves the selection
  // pointing at nothing; falling back to the bottom layer keeps the editor open.
  const selectedIndex = Math.max(0, settings.layers.findIndex((l) => l.id === selectedId))
  const layer = settings.layers[selectedIndex]

  const updateLayer = (id: string, patch: Partial<LabLayer>) =>
    setSettings((s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))

  const addLayer = () => {
    // Added as fine detail on top, because that is what a second layer is
    // usually for, and a copy of the first would add nothing visible.
    const next = createLabLayer({
      seed: Math.max(...settings.layers.map((l) => l.seed)) + 1,
      frequency: 8,
      octaves: 3,
      blend: 'add',
      weight: 0.3,
    })
    setSettings((s) => ({ ...s, layers: [...s.layers, next] }))
    setSelectedId(next.id)
  }

  const removeLayer = (id: string) =>
    setSettings((s) => (s.layers.length === 1 ? s : { ...s, layers: s.layers.filter((l) => l.id !== id) }))

  const moveLayer = (index: number, direction: -1 | 1) =>
    setSettings((s) => {
      const target = index + direction
      if (target < 0 || target >= s.layers.length) return s
      const layers = [...s.layers]
      ;[layers[index], layers[target]] = [layers[target], layers[index]]
      return { ...s, layers }
    })

  const pipeline = useMemo(() => describePipeline(settings, field), [settings, field])
  const activePreset = matchPreset(settings)
  // The values are stretched to [0, 1] before shaping, so a fixed domain is
  // already fitted — and keeping it fixed means a power curve visibly darkens
  // the map rather than being stretched back out.
  const ramp = useMemo(
    () => ({ ...buildLut(paletteName, VIZ_ACCENT, CONTINUOUS), ...FULL_DOMAIN }),
    [paletteName],
  )

  const white = layer.noise === 'white'
  const octaved = !white && layer.octaves > 1
  // The bottom layer is what the others blend onto; it has nothing beneath it
  // to combine with, so blend and weight would be controls that do nothing.
  const isBase = selectedIndex === 0

  const globalSlider = (
    key: 'amplitude' | 'terraceSteps' | 'powerExponent' | 'warpStrength' | 'warpScale' | 'islandFalloff' | 'seaLevel',
    text: string,
    info: string,
    min: number,
    max: number,
    step: number,
    display: (v: number) => string = (v) => v.toFixed(2),
  ) => (
    <Slider
      label={text}
      info={info}
      value={settings[key]}
      display={display(settings[key])}
      min={min}
      max={max}
      step={step}
      onChange={(v) => set(key, v)}
    />
  )

  const layerSlider = (
    key: 'frequency' | 'octaves' | 'persistence' | 'lacunarity' | 'ridgeSharpness' | 'weight',
    text: string,
    info: string,
    min: number,
    max: number,
    step: number,
    display: (v: number) => string = (v) => v.toFixed(2),
  ) => (
    <Slider
      label={text}
      info={info}
      value={layer[key]}
      display={display(layer[key])}
      min={min}
      max={max}
      step={step}
      onChange={(v) => updateLayer(layer.id, { [key]: v })}
    />
  )

  return (
    <Workspace
      topic="maps-lab"
      library={
        <aside className="control-sidebar" aria-label="Presets">
          <h3 className="control-group">
            <InfoTip text="Each preset is a recipe — noise layers and a few operations, in order. None of them is a different algorithm; they are the same pipeline with different switches. The seed is kept, so changing preset compares recipes on the same ground.">
              Presets
            </InfoTip>
          </h3>
          <div className="lab-presets">
            {LAB_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`lab-preset${activePreset === preset.id ? ' is-active' : ''}`}
                aria-pressed={activePreset === preset.id}
                onClick={() => setSettings((s) => applyPreset(preset, s.seed))}
              >
                <span className="lab-preset-name">{preset.label}</span>
                <span className="lab-preset-recipe">{preset.recipe}</span>
              </button>
            ))}
          </div>
          <p className="hint">
            {activePreset
              ? 'Change any control and this becomes your own recipe.'
              : 'Custom — no preset matches the controls.'}
          </p>
        </aside>
      }
      view={
        <ViewControls>
          <label className="control">
            <span className="control-label">
              <InfoTip text="One ramp colours both the map and the terrain, because they show the same numbers and a second control would only let them disagree.">
                Palette
              </InfoTip>
            </span>
            <select value={paletteName} onChange={(e) => setPaletteName(e.target.value as PaletteName)}>
              {PALETTES.filter((p) => p.stops !== null).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="Draws the 128 × 128 sampling grid over the terrain: one vertex per pixel of the map.">Wireframe</InfoTip>
            </span>
            <input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />
          </label>
          <Slider
            label="Spin"
            info="Turns the tile about its vertical axis. Relief that is ambiguous in a still frame usually resolves once the shading moves."
            value={spin}
            display={spin === 0 ? 'off' : `${spin}°/s`}
            min={0}
            max={90}
            step={1}
            onChange={setSpin}
          />
        </ViewControls>
      }
      inspector={
        <aside className="control-sidebar" aria-label="Noise lab controls">
          {switcher}

          <ControlSection title="Layers" info="Noise functions stacked bottom-up. The bottom layer is the ground; each layer above combines with everything beneath it by its blend. Composition, not one perfect noise function, is how most procedural terrain is made.">
            <ol className="lab-layers">
              {settings.layers.map((l, i) => (
                <li key={l.id} className={`lab-layer${i === selectedIndex ? ' is-selected' : ''}${l.enabled ? '' : ' is-off'}`}>
                  <input
                    type="checkbox"
                    checked={l.enabled}
                    aria-label={`Layer ${i + 1} enabled`}
                    onChange={(e) => updateLayer(l.id, { enabled: e.target.checked })}
                  />
                  <button type="button" className="lab-layer-name" onClick={() => setSelectedId(l.id)}>
                    <span className="lab-layer-index">L{i + 1}</span> {describeLayer(l, i)}
                  </button>
                  <span className="lab-layer-tools">
                    <button type="button" aria-label={`Move layer ${i + 1} down the stack`} disabled={i === 0} onClick={() => moveLayer(i, -1)}>↑</button>
                    <button type="button" aria-label={`Move layer ${i + 1} up the stack`} disabled={i === settings.layers.length - 1} onClick={() => moveLayer(i, 1)}>↓</button>
                    <button type="button" aria-label={`Remove layer ${i + 1}`} disabled={settings.layers.length === 1} onClick={() => removeLayer(l.id)}>×</button>
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className="reset-button" disabled={settings.layers.length >= MAX_LAB_LAYERS} onClick={addLayer}>
              + Add layer
            </button>
          </ControlSection>

          <ControlSection title={`Layer ${selectedIndex + 1}`} info="The selected layer: which noise it is, how its octaves are stacked and folded, and how it combines with the layers beneath it. Controls are hidden when they cannot change the result.">
            <Segmented label="Noise type" options={NOISE_TYPES} value={layer.noise} onChange={(v) => updateLayer(layer.id, { noise: v })} />
            {layer.noise === 'cellular' && (
              <Segmented label="Cellular distance" options={CELLULAR_MODES} value={layer.cellular} onChange={(v) => updateLayer(layer.id, { cellular: v })} />
            )}
            <p className="hint lab-hint">
              {(layer.noise === 'cellular'
                ? CELLULAR_MODES.find((m) => m.value === layer.cellular)
                : NOISE_TYPES.find((t) => t.value === layer.noise))?.hint}
            </p>

            {!white &&
              layerSlider('frequency', 'Frequency', 'How many features of the first octave fit across the tile. Low is broad continents; high is a field of small bumps. The same thing as a scale, inverted.', 0.5, 12, 0.5, (v) => `${v} across`)}
            {!white &&
              layerSlider('octaves', 'Octaves', 'How many copies of the noise are stacked, each finer than the last. One octave is smooth blobs of one size; more add detail at smaller scales without moving the large shapes.', 1, 8, 1, (v) => String(v))}
            {octaved &&
              layerSlider('persistence', 'Persistence', 'How much quieter each octave is than the one before. Low leaves the fine octaves faint — rolling ground; high lets them through — rough, rocky ground.', 0.2, 0.9, 0.01)}
            {octaved &&
              layerSlider('lacunarity', 'Lacunarity', 'How much finer each octave is than the one before. 2 is the standard doubling; higher spreads the octaves further apart in scale.', 1.5, 3, 0.05)}
            {white && (
              <p className="hint">
                White noise has no frequency and nothing to stack: every pixel is already independent, so an octave would just be another white field.
              </p>
            )}

            <h4 className="lab-subhead">
              <InfoTip text="Applied to every octave of this layer before they are summed. Folding the sum would crease the terrain along one contour only; folding each octave creases it at every scale.">Fold</InfoTip>
            </h4>
            <Segmented label="Fold" options={FOLDS} value={layer.fold} onChange={(v) => updateLayer(layer.id, { fold: v })} />
            {layer.fold === 'ridged' &&
              layerSlider('ridgeSharpness', 'Sharpness', 'The power the fold is raised to. 1 is a plain V; higher pinches the crest into a knife edge and widens the valleys between.', 1, 4, 0.05)}
            <p className="hint">{FOLDS.find((o) => o.value === layer.fold)?.hint}</p>

            {isBase ? (
              <p className="hint">The bottom layer is the ground the others combine with, so it has no blend of its own.</p>
            ) : (
              <>
                <h4 className="lab-subhead">
                  <InfoTip text="How this layer combines with everything beneath it. The stack is stretched to [0, 1] afterwards, so weights are relative: what matters is how loud this layer is against the ones below.">Blend</InfoTip>
                </h4>
                <Segmented label="Blend" options={BLENDS} value={layer.blend} onChange={(v) => updateLayer(layer.id, { blend: v })} />
                {layerSlider('weight', 'Weight', 'How strongly this layer acts. For a multiply, 1 is a full mask and 0 leaves the ground alone.', 0, 1, 0.01)}
                <p className="hint">{BLENDS.find((o) => o.value === layer.blend)?.hint}</p>
              </>
            )}
          </ControlSection>

          <ControlSection title="Field" info="Settings for the whole stack rather than one layer.">
            <label className="control lab-seed">
              <span className="control-label">
                <InfoTip text="Which random field. The same seed always rebuilds the same terrain, so every other control is comparable across changes. Each layer offsets it by its own number, so layers never share randomness.">Seed</InfoTip>
              </span>
              <span className="lab-seed-row">
                <input
                  type="number"
                  min={0}
                  max={99999}
                  value={settings.seed}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value))
                    if (Number.isFinite(v)) set('seed', Math.max(0, Math.min(99999, v)))
                  }}
                />
                <button type="button" className="reset-button" onClick={() => set('seed', Math.floor(Math.random() * 99999))}>
                  New
                </button>
              </span>
            </label>
            {globalSlider('amplitude', 'Amplitude', 'How tall a value of 1 stands, in world units, against a tile 2.4 wide. The map is unitless; amplitude is what turns it into height, so it changes the terrain and the profile but not the map.', 0.05, LAB_MAX_AMPLITUDE, 0.05)}
          </ControlSection>

          <ControlSection title="Shaping" info="A remap of the finished stack, after it is stretched to [0, 1]. It acts once, on the sum — a terrace applied to each layer would be blurred away by the layers above it.">
            <Segmented label="Shaping" options={SHAPINGS} value={settings.shaping} onChange={(v) => set('shaping', v)} />
            {settings.shaping === 'terrace' &&
              globalSlider('terraceSteps', 'Steps', 'How many flat levels the height is quantised into.', 2, 16, 1, (v) => String(v))}
            {settings.shaping === 'power' &&
              globalSlider('powerExponent', 'Exponent', 'Above 1 pushes values toward 0: wide flat lowlands and isolated peaks. Below 1 lifts them: plateaus cut by narrow valleys.', 0.25, 4, 0.05)}
            <p className="hint">{SHAPINGS.find((s) => s.value === settings.shaping)?.hint}</p>
          </ControlSection>

          <ControlSection title="Domain warp" info="Reads every layer at coordinates pushed around by a second noise. Nothing is added to the value — only where it is looked up changes — so features bend, swirl and stretch.">
            <label className="control control-toggle">
              <span className="control-label">Enable</span>
              <input type="checkbox" checked={settings.warp} onChange={(e) => set('warp', e.target.checked)} />
            </label>
            {settings.warp && (
              <>
                {globalSlider('warpStrength', 'Strength', 'The largest displacement, as a share of the tile. Small values bend coastlines; large ones drag features into swirls.', 0, 0.5, 0.01, pct)}
                {globalSlider('warpScale', 'Scale', 'Features across the tile in the offset field. Low bends whole regions one way; high only jitters edges.', 0.5, 8, 0.25, (v) => `${v} across`)}
              </>
            )}
          </ControlSection>

          <ControlSection title="Island mask" info="Multiplies the value by a falloff from the centre, so the edges of the tile sink. With water on, that is an island.">
            <label className="control control-toggle">
              <span className="control-label">Enable</span>
              <input type="checkbox" checked={settings.island} onChange={(e) => set('island', e.target.checked)} />
            </label>
            {settings.island &&
              globalSlider('islandFalloff', 'Falloff', 'How hard the edges are pulled down. At 1 the value reaches 0 at the middle of each edge; below 1 the land runs off the tile.', 0.2, 2, 0.05)}
          </ControlSection>

          <ControlSection title="Water" info="A flat plane at a fixed value. Not part of the noise — it reads the noise, and what it shows is which values count as land.">
            {globalSlider('seaLevel', 'Sea level', 'Values below this are under water, on the map and on the terrain. 0 is no water.', 0, 0.8, 0.01, (v) => (v === 0 ? 'off' : v.toFixed(2)))}
          </ControlSection>

          <p className="readout">
            {LAB_RESOLUTION}² samples in <strong>{field.ms.toFixed(1)} ms</strong>
            {settings.seaLevel > 0 && (
              <>
                {' '}· <strong>{pct(field.land)}</strong> land
              </>
            )}
          </p>
          <p className="hint">Drag the terrain to orbit, scroll to zoom. Click the map to move the profile.</p>
        </aside>
      }
    >
      <div className="lab-bench">
        <div className="lab-pair">
          <figure className="lab-pane">
            <figcaption>
              <span className="lab-caption">Noise map</span>
              <span className="lab-caption-detail">a value in [0, 1] per pixel</span>
            </figcaption>
            <div className="lab-square">
              <LabMap
                resolution={LAB_RESOLUTION}
                field={field.values}
                ramp={ramp}
                seaLevel={settings.seaLevel}
                row={row}
                onRow={setRow}
              />
            </div>
          </figure>
          <div className="lab-arrow" aria-hidden="true">
            →
          </div>
          <figure className="lab-pane">
            <figcaption>
              <span className="lab-caption">Terrain</span>
              <span className="lab-caption-detail">height = value × {settings.amplitude.toFixed(2)}</span>
            </figcaption>
            <div className="lab-square lab-terrain">
              <NoiseViewport
                mode="surface"
                resolution={LAB_RESOLUTION}
                field={field.values}
                heightScale={settings.amplitude}
                selected={null}
                ramp={ramp}
                overlay={null}
                spin={spin}
                wireframe={wireframe}
                water={settings.seaLevel}
                zoom={0.85}
              />
            </div>
          </figure>
        </div>

        <figure className="lab-pane">
          <figcaption>
            <span className="lab-caption">Profile</span>
            <span className="lab-caption-detail">
              the dashed row, cut through the terrain · height 0–{settings.amplitude.toFixed(2)}, stretched to fill
            </span>
          </figcaption>
          <LabProfile
            resolution={LAB_RESOLUTION}
            field={field.values}
            row={row}
            seaLevel={settings.seaLevel}
          />
        </figure>

        <figure className="lab-pane">
          <figcaption>
            <span className="lab-caption">Pipeline</span>
            <span className="lab-caption-detail">what the controls amount to, run for every (x, z) in [0, 1]² — greyed lines are off</span>
          </figcaption>
          <pre className="lab-code">
            {pipeline.map((line, i) => (
              <div key={i} className={line.active ? undefined : 'is-off'}>
                {/* A blank line still needs a glyph, or the empty div collapses. */}
                {line.code || '\u00a0'}
                {line.comment && <span className="lab-code-comment">{`  // ${line.comment}`}</span>}
              </div>
            ))}
          </pre>
        </figure>
      </div>
    </Workspace>
  )
}
