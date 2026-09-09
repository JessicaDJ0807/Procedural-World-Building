import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayerPanel } from '../LayerPanel'
import { NoiseMapPreview, type Cell } from '../NoiseMapPreview'
import { NoiseViewport, type GeometryMode } from '../NoiseViewport'
import { Slider } from '../Slider'
import { ACCENT_BLUE } from '../theme'
import {
  DEFAULT_SURVIVE,
  MAX_GENERATIONS,
  BLOCK_SIZE,
  runAutomata,
} from '../automata'
import {
  EROSION_PARAM_SPECS,
  EROSION_PRESETS,
  MAX_RAIN_DENSITY,
  RAIN_DENSITY_RANGE,
  dropletsFor,
  erodeStep,
  getPreset,
  type ErosionParams,
  type ErosionRun,
} from '../erosion'
import {
  SHAPING_OPS,
  applyShaping,
  compositeLayers,
  defaultParamsFor,
  fbmOctaves,
  getShapingOp,
  type NoiseLayer,
  type ShapingName,
} from '../noise'

const GEOMETRIES: { value: GeometryMode; label: string; hint: string }[] = [
  {
    value: 'surface',
    label: 'Height field',
    hint: 'The map is a graph: each cell’s value becomes the height of a vertex.',
  },
  {
    value: 'volume',
    label: 'Volumetric cloud',
    hint: 'True 3D noise, one point per cell. The map shows one slice through it.',
  },
  {
    value: 'planet',
    label: 'Planet',
    hint: 'A sphere displaced by the 3D field sampled at each vertex — no seam, no poles.',
  },
]

// A volume costs the cube of the resolution, so it caps far lower than a
// surface — and past ~32 every ray crosses too many lit cells to see into.
const MAX_RESOLUTION: Record<GeometryMode, number> = { surface: 128, volume: 32, planet: 32 }

let layerCounter = 0
function createLayer(overrides: Partial<NoiseLayer> = {}): NoiseLayer {
  layerCounter += 1
  return {
    id: `layer-${layerCounter}`,
    name: `Layer ${layerCounter}`,
    enabled: true,
    frequency: 8,
    spread: 0.18,
    seed: layerCounter,
    shapingName: 'none',
    shapingParams: {},
    blendName: 'normal',
    opacity: 1,
    ...overrides,
  }
}

const FBM_BASE_FREQUENCY = 2
const FBM_SPREAD = 0.6
const DEFAULT_OCTAVES = 6
const DEFAULT_PERSISTENCE = 0.5
const DEFAULT_RESOLUTION = 128

/**
 * Seeds are the octave index rather than a running counter, so rebuilding at a
 * different persistence redraws the same terrain at a different roughness
 * instead of an unrelated one — which is the only way the dial is readable.
 */
function createFbmStack(octaves: number, persistence: number, maxFrequency: number): NoiseLayer[] {
  return fbmOctaves(octaves, FBM_BASE_FREQUENCY, persistence, maxFrequency).map((octave, index) =>
    createLayer({
      name: `Octave ${index + 1}`,
      frequency: octave.frequency,
      opacity: octave.opacity,
      spread: FBM_SPREAD,
      seed: index + 1,
    }),
  )
}

// Six octaves rather than the two this started with: measured against a
// structure function, two layers four octaves apart score 0.960 for
// straightness where real topography is above 0.99, and six score 0.990.
const INITIAL_LAYERS: NoiseLayer[] = createFbmStack(
  DEFAULT_OCTAVES,
  DEFAULT_PERSISTENCE,
  DEFAULT_RESOLUTION,
)

export function NoisePage() {
  const [mode, setMode] = useState<GeometryMode>('surface')
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION)
  // Averaging six octaves shrinks the variance, so the stack's relief is about
  // 0.40 against the old pair's 0.71. Display scaling costs nothing, so the
  // height makes it back up rather than the spread pushing values into a clamp.
  const [heightScale, setHeightScale] = useState(1.4)
  // Relief is its own value, not a reused height: 0.8 on a radius-0.85 sphere
  // is an asteroid, and carrying the surface's setting across would look broken.
  const [relief, setRelief] = useState(0.18)
  const [slice, setSlice] = useState(0)
  const [selected, setSelected] = useState<Cell | null>(null)
  const [tint, setTint] = useState(ACCENT_BLUE)

  // Gorges over River valleys: on a six-octave stack it measures 0.997 for
  // straightness against 0.990, because its narrow cuts add structure at the
  // fine scales where an octave stack is thinnest.
  const [presetName, setPresetName] = useState('gorges')
  const [erosionParams, setErosionParams] = useState<ErosionParams>(getPreset('gorges').params)
  const [density, setDensity] = useState(getPreset('gorges').density)
  const [erosionSeed, setErosionSeed] = useState(1)
  const [erosion, setErosion] = useState<ErosionRun | null>(null)
  const [eroding, setEroding] = useState(false)
  const [showCutFill, setShowCutFill] = useState(false)

  const [caThreshold, setCaThreshold] = useState(0.5)
  const [survive, setSurvive] = useState(DEFAULT_SURVIVE[2])
  const [generation, setGeneration] = useState(0)
  const [playing, setPlaying] = useState(false)

  const [octaves, setOctaves] = useState(DEFAULT_OCTAVES)
  const [persistence, setPersistence] = useState(DEFAULT_PERSISTENCE)
  const [layers, setLayers] = useState<NoiseLayer[]>(INITIAL_LAYERS)
  const [expandedId, setExpandedId] = useState<string | null>(INITIAL_LAYERS[0].id)
  const [outputShapingName, setOutputShapingName] = useState<ShapingName>('none')
  const [outputParams, setOutputParams] = useState<Record<string, number>>({})
  const outputShaping = useMemo(() => getShapingOp(outputShapingName), [outputShapingName])

  const dimensions: 2 | 3 = mode === 'surface' ? 2 : 3

  const selectMode = (next: GeometryMode) => {
    const nextDimensions: 2 | 3 = next === 'surface' ? 2 : 3
    setMode(next)
    setResolution((current) => Math.min(current, MAX_RESOLUTION[next]))
    // 8 and 26 neighbourhoods need different survival counts. Clamping 13 down
    // to 8 would demand every neighbour be live, which kills the field, so the
    // rule resets to the new neighbourhood's majority instead.
    if (nextDimensions !== dimensions) setSurvive(DEFAULT_SURVIVE[nextDimensions])
  }

  const updateLayer = (id: string, patch: Partial<NoiseLayer>) =>
    setLayers((current) => current.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const removeLayer = (id: string) =>
    setLayers((current) => (current.length === 1 ? current : current.filter((l) => l.id !== id)))

  const moveLayer = (id: string, direction: -1 | 1) =>
    setLayers((current) => {
      const index = current.findIndex((l) => l.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const rebuildStack = () => {
    setLayers(createFbmStack(octaves, persistence, resolution))
    setExpandedId(null)
  }

  const addLayer = () => {
    const layer = createLayer({ blendName: 'screen', opacity: 0.5, frequency: 32 })
    setLayers((current) => [...current, layer])
    setExpandedId(layer.id)
  }

  const composite = useMemo(
    () => compositeLayers(resolution, dimensions, layers),
    [resolution, dimensions, layers],
  )
  // Re-run from the composite every time rather than mutating a running state:
  // a generation count is then just a number, so editing a layer mid-run stays
  // consistent instead of leaving a stale automaton behind.
  const automata = useMemo(
    () =>
      runAutomata(composite, resolution, dimensions, {
        threshold: caThreshold,
        survive,
        generations: generation,
      }),
    [composite, resolution, dimensions, caThreshold, survive, generation],
  )
  // Erosion only makes sense on a height field: a volume has no "down", and the
  // planet is sampled from a 3D field precisely so it needs no surface grid.
  const canErode = mode === 'surface'
  // Erosion accumulates, so it is state rather than a memo — but it is only
  // valid for the terrain it was run on. Comparing identity here beats resetting
  // from an effect, which would cost an extra render every time a layer moved.
  const activeErosion =
    canErode && erosion && erosion.source === automata.field ? erosion : null
  const terrain = activeErosion ? activeErosion.height : automata.field

  const field = useMemo(
    () => applyShaping(terrain, outputShaping, outputParams),
    [terrain, outputShaping, outputParams],
  )
  const overlay = useMemo(
    () =>
      showCutFill && activeErosion
        ? { cut: activeErosion.cut, scale: activeErosion.cutScale }
        : null,
    [showCutFill, activeErosion],
  )

  // Reaching the end is derived rather than pushed back into state: setting
  // `playing` false from inside the effect would cascade an extra render. The
  // run ends at the automaton's fixed point; the cap is only a safety net.
  const settledOut = automata.settled || generation >= MAX_GENERATIONS
  const running = playing && !settledOut
  // A rule that flips no cells is a dead end the picture cannot show, so the
  // readout has to say so — otherwise pressing Play looks like a broken button.
  const inert = generation > 0 && automata.changed === 0
  const wipedOut = generation > 0 && automata.live === 0

  // Each generation schedules the next, so the run advances one pass at a time
  // instead of an interval racing the state it updates.
  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => setGeneration((g) => g + 1), 240)
    return () => clearTimeout(timer)
  }, [running, generation])

  const dropletsRun = activeErosion?.droplets ?? 0
  const rainRun = activeErosion?.rain ?? 0
  const erodedOut = rainRun >= MAX_RAIN_DENSITY
  const runningErosion = eroding && canErode && !erodedOut

  const advanceErosion = useCallback(() => {
    setErosion((current) => {
      const previous = current && current.source === automata.field ? current : null
      const cap = dropletsFor(MAX_RAIN_DENSITY, resolution)
      const budget = Math.min(dropletsFor(density, resolution), cap - (previous?.droplets ?? 0))
      if (budget <= 0) return current
      return erodeStep(previous, automata.field, resolution, budget, erosionSeed * 7919, erosionParams)
    })
  }, [automata.field, resolution, density, erosionSeed, erosionParams])

  useEffect(() => {
    if (!runningErosion) return
    const timer = setTimeout(advanceErosion, 240)
    return () => clearTimeout(timer)
  }, [runningErosion, dropletsRun, advanceErosion])

  const resetErosion = () => {
    setEroding(false)
    setErosion(null)
  }

  const selectPreset = (value: string) => {
    const preset = getPreset(value)
    setPresetName(value)
    setErosionParams(preset.params)
    setDensity(preset.density)
    resetErosion()
  }

  // Nudging a parameter puts the run onto settings the terrain was not carved
  // with, so the preset name no longer describes what is on screen.
  const setErosionParam = (key: keyof ErosionParams, value: number) => {
    setErosionParams((current) => ({ ...current, [key]: value }))
    setPresetName('custom')
  }

  // Slice z is contiguous in the volume buffer: index = z·R² + (y·R + x), so a
  // slice is a plain window onto it rather than a copy.
  const sliceZ = Math.min(slice, resolution - 1)
  const mapField = useMemo(
    () =>
      mode === 'surface'
        ? field
        : field.subarray(sliceZ * resolution * resolution, (sliceZ + 1) * resolution * resolution),
    [mode, field, sliceZ, resolution],
  )

  // A selection made at a higher resolution can fall outside a lower one.
  const inRange = selected && selected.x < resolution && selected.y < resolution ? selected : null
  const selectedValue = inRange ? mapField[inRange.y * resolution + inRange.x] : null

  return (
    <div className="noise-page">
      <NoiseViewport
        mode={mode}
        resolution={resolution}
        field={field}
        heightScale={mode === 'planet' ? relief : heightScale}
        selected={inRange ? { ...inRange, z: sliceZ } : null}
        tint={tint}
        overlay={overlay}
      />

      <aside className="noise-sidebar" aria-label="Noise controls">
        <h2>Source map</h2>
        <NoiseMapPreview
          resolution={resolution}
          field={mapField}
          selected={inRange}
          onSelect={setSelected}
          tint={tint}
        />
        <p className="readout">
          {inRange && selectedValue !== null ? (
            <>
              cell ({inRange.x}, {inRange.y}
              {mode === 'volume' ? `, ${sliceZ}` : ''}) ={' '}
              <strong>{selectedValue.toFixed(3)}</strong>
            </>
          ) : (
            'Click the map to inspect a cell.'
          )}
        </p>

        <h3 className="control-group">Geometry</h3>

        <label className="control">
          <span className="control-label">
            Colour
            <span className="control-value">{tint}</span>
          </span>
          <input
            type="color"
            value={tint}
            onChange={(event) => setTint(event.target.value)}
          />
        </label>

        <label className="control">
          <span className="control-label">Mode</span>
          <select
            value={mode}
            onChange={(event) => selectMode(event.target.value as GeometryMode)}
          >
            {GEOMETRIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {mode === 'surface' && (
          <Slider
            label="Height"
            value={heightScale}
            display={heightScale.toFixed(2)}
            min={0}
            max={2}
            step={0.01}
            onChange={setHeightScale}
          />
        )}

        {mode === 'planet' && (
          <Slider
            label="Relief"
            value={relief}
            display={relief.toFixed(2)}
            min={0}
            max={0.6}
            step={0.005}
            onChange={setRelief}
          />
        )}

        {mode !== 'surface' && (
          <Slider
            label="Slice (z)"
            value={sliceZ}
            display={`${sliceZ} / ${resolution - 1}`}
            min={0}
            max={resolution - 1}
            step={1}
            onChange={setSlice}
          />
        )}

        <Slider
          label="Resolution"
          value={resolution}
          display={mode === 'surface' ? `${resolution}²` : `${resolution}³`}
          min={2}
          max={MAX_RESOLUTION[mode]}
          step={1}
          onChange={setResolution}
        />

        <h3 className="control-group">Layers</h3>

        <Slider
          label="Octaves"
          value={octaves}
          display={`${octaves} · f${FBM_BASE_FREQUENCY}–f${Math.min(resolution, FBM_BASE_FREQUENCY * 2 ** (octaves - 1))}`}
          min={1}
          max={8}
          step={1}
          onChange={setOctaves}
        />
        <Slider
          label="Persistence"
          value={persistence}
          display={persistence.toFixed(2)}
          min={0.2}
          max={0.9}
          step={0.01}
          onChange={setPersistence}
        />
        <button type="button" className="reset-button" onClick={rebuildStack}>
          Rebuild as fBm stack
        </button>
        <p className="hint">
          Replaces the stack with octaves of doubling frequency and{' '}
          {persistence.toFixed(2)}× amplitude. Persistence is the roughness dial:
          below ~0.4 reads as rolling hills, above ~0.7 stops looking like
          terrain at all.
        </p>

        <LayerPanel
          layers={layers}
          expandedId={expandedId}
          maxFrequency={resolution}
          onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
          onUpdate={updateLayer}
          onRemove={removeLayer}
          onMove={moveLayer}
          onAdd={addLayer}
        />

        <h3 className="control-group">Automata</h3>

        <Slider
          label="Alive above"
          value={caThreshold}
          display={caThreshold.toFixed(2)}
          min={0}
          max={1}
          step={0.01}
          onChange={setCaThreshold}
        />
        <Slider
          label="Survive at"
          value={survive}
          display={`${survive} / ${BLOCK_SIZE[dimensions]}`}
          min={1}
          max={BLOCK_SIZE[dimensions]}
          step={1}
          onChange={setSurvive}
        />

        <p className="readout">
          generation <strong>{automata.generations}</strong>
          {generation === 0 && ' — field untouched'}
          {inert && ' — no cells changed; every cell is alive at this threshold'}
          {wipedOut && ' — every cell died'}
          {automata.settled && !inert && !wipedOut && ' — settled, no cell can flip again'}
          {!automata.settled && generation >= MAX_GENERATIONS &&
            ` — stopped at the cap, ${automata.flips} cells still flipping`}
        </p>

        <div className="button-row">
          <button
            type="button"
            className="reset-button"
            disabled={settledOut}
            onClick={() => setPlaying((current) => !current)}
          >
            {running ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="reset-button"
            disabled={running || settledOut}
            onClick={() => setGeneration((g) => g + 1)}
          >
            Step
          </button>
          <button
            type="button"
            className="reset-button"
            disabled={generation === 0}
            onClick={() => {
              setPlaying(false)
              setGeneration(0)
            }}
          >
            Reset
          </button>
        </div>

        <p className="hint">
          Each pass sets a cell live when at least {survive} of the{' '}
          {BLOCK_SIZE[dimensions]} cells in its {dimensions === 2 ? '3×3' : '3×3×3'} block
          (itself included) are live. Live cells keep their value; dead cells go to 0.
        </p>

        <h3 className="control-group">Erosion</h3>

        {!canErode ? (
          <p className="hint">
            Droplets need a height field to run downhill on. A volume has no
            “down”, and the planet is displaced from the 3D field precisely so it
            needs no surface grid — switch to Height field to erode.
          </p>
        ) : (
          <>
            <label className="control">
              <span className="control-label">Preset</span>
              <select value={presetName} onChange={(event) => selectPreset(event.target.value)}>
                {EROSION_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
                {presetName === 'custom' && <option value="custom">Custom</option>}
              </select>
            </label>

            <Slider
              label="Rain per tick"
              value={density}
              display={`${density.toFixed(2)} /cell · ${dropletsFor(density, resolution).toLocaleString()}`}
              min={RAIN_DENSITY_RANGE.min}
              max={RAIN_DENSITY_RANGE.max}
              step={RAIN_DENSITY_RANGE.step}
              onChange={setDensity}
            />

            {EROSION_PARAM_SPECS.map((spec) => {
              const value = erosionParams[spec.key]
              return (
                <Slider
                  key={spec.key}
                  label={spec.label}
                  value={value}
                  display={spec.format ? spec.format(value) : value.toFixed(2)}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  onChange={(next) => setErosionParam(spec.key, next)}
                />
              )
            })}

            <label className="control control-toggle">
              <span className="control-label">Colour by cut / fill</span>
              <input
                type="checkbox"
                checked={showCutFill}
                onChange={(event) => setShowCutFill(event.target.checked)}
              />
            </label>

            <p className="readout">
              <strong>{rainRun.toFixed(2)}</strong> droplets/cell (
              {dropletsRun.toLocaleString()} total)
              {activeErosion && ` — ${Math.round(activeErosion.reliefKept * 100)}% of the relief left`}
              {erodedOut && ' — cap reached'}
            </p>

            <div className="button-row">
              <button
                type="button"
                className="reset-button"
                disabled={erodedOut}
                onClick={() => setEroding((current) => !current)}
              >
                {runningErosion ? 'Pause' : 'Rain'}
              </button>
              <button
                type="button"
                className="reset-button"
                disabled={runningErosion || erodedOut}
                onClick={advanceErosion}
              >
                Step
              </button>
              <button
                type="button"
                className="reset-button"
                disabled={dropletsRun === 0}
                onClick={resetErosion}
              >
                Reset
              </button>
            </div>

            <button
              type="button"
              className="reset-button"
              onClick={() => {
                // A different rain has to start from bare terrain: dropping new
                // droplets onto channels the old ones cut is neither run.
                setErosionSeed((current) => current + 1)
                resetErosion()
              }}
            >
              New rainfall
            </button>

            <p className="hint">
              {getPreset(presetName).value === presetName
                ? getPreset(presetName).hint
                : 'Custom settings.'}{' '}
              Channels are cut early and worn flat later, so watch the relief
              figure — once it drops far, the run is lowering the whole field
              rather than carving it.
            </p>
          </>
        )}

        <h3 className="control-group">Output</h3>

        <label className="control">
          <span className="control-label">Shaping</span>
          <select
            value={outputShapingName}
            onChange={(event) => {
              const name = event.target.value as ShapingName
              setOutputShapingName(name)
              setOutputParams(defaultParamsFor(getShapingOp(name)))
            }}
          >
            {SHAPING_OPS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </label>

        {outputShaping.params.map((param) => {
          const value = outputParams[param.key] ?? param.defaultValue
          return (
            <Slider
              key={param.key}
              label={param.label}
              value={value}
              display={param.format ? param.format(value) : value.toFixed(2)}
              min={param.min}
              max={param.max}
              step={param.step}
              onChange={(next) => setOutputParams((c) => ({ ...c, [param.key]: next }))}
            />
          )
        })}

        <p className="hint">{GEOMETRIES.find((g) => g.value === mode)?.hint}</p>
        <p className="hint">Drag to orbit, scroll to zoom, right-drag to pan.</p>
      </aside>
    </div>
  )
}
