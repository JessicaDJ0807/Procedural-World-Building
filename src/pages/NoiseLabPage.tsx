import { useMemo, useState, type ReactNode } from 'react'
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
  DEFAULT_LAB,
  LAB_MAX_AMPLITUDE,
  LAB_PRESETS,
  LAB_RESOLUTION,
  describePipeline,
  generateLab,
  matchPreset,
  type CellularMode,
  type LabSettings,
  type LabShaping,
  type NoiseType,
} from '../maplab/noiseLab'
import '../study/study.css'
import '../maplab/maplab.css'

const NOISE_TYPES: { value: NoiseType; label: string; hint: string }[] = [
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

const CELLULAR_MODES: { value: CellularMode; label: string; hint: string }[] = [
  { value: 'distance', label: 'F1', hint: 'Distance to the nearest point: 0 at every point, rising to the cell walls — round basins.' },
  { value: 'edges', label: 'F2 − F1', hint: 'How much closer the nearest point is than the second nearest: 0 exactly on the walls, so it draws the cell outlines.' },
]

const SHAPINGS: { value: LabShaping; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'The noise as it comes.' },
  { value: 'ridged', label: 'Ridged', hint: 'Folds each octave about its middle, so smooth crests become sharp creases. Applied per octave, not to the sum — that is what puts ridges at every scale.' },
  { value: 'billow', label: 'Billow', hint: 'The opposite fold: creases point down and the tops round off. Reads as dunes, clouds or rounded hills.' },
  { value: 'terrace', label: 'Terrace', hint: 'Quantises height into flat steps — mesas, rice paddies, contour lines made solid.' },
  { value: 'power', label: 'Power', hint: 'Raises the value to an exponent. Above 1 flattens the lowlands and sharpens peaks; below 1 does the reverse.' },
]

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; hint: string }[]
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

/**
 * Topic 2's Lab: one noise function, a few operations on it, and what the
 * result means as ground.
 *
 * The workbench beside it answers "what can be done to a field"; this answers
 * "what is the field, and why does that operation make that landform". Both
 * views are always on screen together — the map is the number, the terrain is
 * the number used as height — so a slider is seen to change both at once.
 */
export function NoiseLabPage({ switcher }: { switcher?: ReactNode }) {
  const [settings, setSettings] = useState<LabSettings>(DEFAULT_LAB)
  const [row, setRow] = useState(Math.floor(LAB_RESOLUTION / 2))
  const [paletteName, setPaletteName] = useState<PaletteName>('land')
  const [spin, setSpin] = useState(0)
  const [wireframe, setWireframe] = useState(false)

  const set = <K extends keyof LabSettings>(key: K, value: LabSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  const field = useMemo(() => generateLab(settings), [settings])
  const pipeline = useMemo(() => describePipeline(settings, field), [settings, field])
  const activePreset = matchPreset(settings)
  // The values are stretched to [0, 1] before shaping, so a fixed domain is
  // already fitted — and keeping it fixed means a power curve visibly darkens
  // the map rather than being stretched back out.
  const ramp = useMemo(
    () => ({ ...buildLut(paletteName, VIZ_ACCENT, CONTINUOUS), ...FULL_DOMAIN }),
    [paletteName],
  )

  const white = settings.noise === 'white'
  const stacked = !white && settings.octaves > 1

  const slider = (
    key: 'frequency' | 'amplitude' | 'octaves' | 'persistence' | 'lacunarity' | 'ridgeSharpness' | 'terraceSteps' | 'powerExponent' | 'warpStrength' | 'warpScale' | 'islandFalloff' | 'seaLevel',
    label: string,
    info: string,
    min: number,
    max: number,
    step: number,
    display: (v: number) => string = (v) => v.toFixed(2),
  ) => (
    <Slider
      label={label}
      info={info}
      value={settings[key]}
      display={display(settings[key])}
      min={min}
      max={max}
      step={step}
      onChange={(v) => set(key, v)}
    />
  )

  return (
    <Workspace
      topic="maps-lab"
      library={
        <aside className="control-sidebar" aria-label="Presets">
          <h3 className="control-group">
            <InfoTip text="Each preset is a recipe — a noise, a few operations, in order. None of them is a different algorithm; they are the same pipeline with different switches. The seed is kept, so changing preset compares recipes on the same ground.">
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
                onClick={() => setSettings((s) => ({ ...preset.settings, seed: s.seed }))}
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

          <ControlSection title="Noise" info="Which function produces the raw value at each point. Everything below operates on its output, whichever it is.">
            <Segmented label="Noise type" options={NOISE_TYPES} value={settings.noise} onChange={(v) => set('noise', v)} />
            {settings.noise === 'cellular' && (
              <Segmented label="Cellular distance" options={CELLULAR_MODES} value={settings.cellular} onChange={(v) => set('cellular', v)} />
            )}
            <p className="hint">
              {(settings.noise === 'cellular'
                ? CELLULAR_MODES.find((m) => m.value === settings.cellular)
                : NOISE_TYPES.find((t) => t.value === settings.noise))?.hint}
            </p>
          </ControlSection>

          <ControlSection title="Parameters" info="Controls are hidden when they cannot change the result — white noise has no scale, and one octave has nothing to persist or space out.">
            <label className="control lab-seed">
              <span className="control-label">
                <InfoTip text="Which random field. The same seed always rebuilds the same terrain, so every other control is comparable across changes.">Seed</InfoTip>
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

            {!white &&
              slider('frequency', 'Frequency', 'How many features of the first octave fit across the tile. Low is broad continents; high is a field of small bumps. The same thing as a scale, inverted.', 0.5, 12, 0.5, (v) => `${v} across`)}
            {slider('amplitude', 'Amplitude', 'How tall a value of 1 stands, in world units, against a tile 2.4 wide. The map is unitless; amplitude is what turns it into height, so it changes the terrain and the profile but not the map.', 0.05, LAB_MAX_AMPLITUDE, 0.05)}
            {!white &&
              slider('octaves', 'Octaves', 'How many copies of the noise are stacked, each finer than the last. One octave is smooth blobs of one size; more add detail at smaller scales without moving the large shapes.', 1, 8, 1, (v) => String(v))}
            {stacked &&
              slider('persistence', 'Persistence', 'How much quieter each octave is than the one before. Low leaves the fine octaves faint — rolling ground; high lets them through — rough, rocky ground.', 0.2, 0.9, 0.01)}
            {stacked &&
              slider('lacunarity', 'Lacunarity', 'How much finer each octave is than the one before. 2 is the standard doubling; higher spreads the octaves further apart in scale.', 1.5, 3, 0.05)}
            {white && (
              <p className="hint">
                White noise has no frequency and nothing to stack: every pixel is already independent, so an octave would just be another white field.
              </p>
            )}
          </ControlSection>

          <ControlSection title="Shaping" info="A function applied to the value. Ridged and Billow fold each octave before it is summed; Terrace and Power remap the finished value.">
            <Segmented label="Shaping" options={SHAPINGS} value={settings.shaping} onChange={(v) => set('shaping', v)} />
            {settings.shaping === 'ridged' &&
              slider('ridgeSharpness', 'Sharpness', 'The power the fold is raised to. 1 is a plain V; higher pinches the crest into a knife edge and widens the valleys between.', 1, 4, 0.05)}
            {settings.shaping === 'terrace' &&
              slider('terraceSteps', 'Steps', 'How many flat levels the height is quantised into.', 2, 16, 1, (v) => String(v))}
            {settings.shaping === 'power' &&
              slider('powerExponent', 'Exponent', 'Above 1 pushes values toward 0: wide flat lowlands and isolated peaks. Below 1 lifts them: plateaus cut by narrow valleys.', 0.25, 4, 0.05)}
            <p className="hint">{SHAPINGS.find((s) => s.value === settings.shaping)?.hint}</p>
          </ControlSection>

          <ControlSection title="Domain warp" info="Reads the noise at coordinates pushed around by a second noise. Nothing is added to the value — only where it is looked up changes — so features bend, swirl and stretch.">
            <label className="control control-toggle">
              <span className="control-label">Enable</span>
              <input type="checkbox" checked={settings.warp} onChange={(e) => set('warp', e.target.checked)} />
            </label>
            {settings.warp && (
              <>
                {slider('warpStrength', 'Strength', 'The largest displacement, as a share of the tile. Small values bend coastlines; large ones drag features into swirls.', 0, 0.5, 0.01, pct)}
                {slider('warpScale', 'Scale', 'Features across the tile in the offset field. Low bends whole regions one way; high only jitters edges.', 0.5, 8, 0.25, (v) => `${v} across`)}
              </>
            )}
          </ControlSection>

          <ControlSection title="Island mask" info="Multiplies the value by a falloff from the centre, so the edges of the tile sink. With water on, that is an island.">
            <label className="control control-toggle">
              <span className="control-label">Enable</span>
              <input type="checkbox" checked={settings.island} onChange={(e) => set('island', e.target.checked)} />
            </label>
            {settings.island &&
              slider('islandFalloff', 'Falloff', 'How hard the edges are pulled down. At 1 the value reaches 0 at the middle of each edge; below 1 the land runs off the tile.', 0.2, 2, 0.05)}
          </ControlSection>

          <ControlSection title="Water" info="A flat plane at a fixed value. Not part of the noise — it reads the noise, and what it shows is which values count as land.">
            {slider('seaLevel', 'Sea level', 'Values below this are under water, on the map and on the terrain. 0 is no water.', 0, 0.8, 0.01, (v) => (v === 0 ? 'off' : v.toFixed(2)))}
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
                {line.code}
                {line.comment && <span className="lab-code-comment">{`  // ${line.comment}`}</span>}
              </div>
            ))}
          </pre>
        </figure>
      </div>
    </Workspace>
  )
}
