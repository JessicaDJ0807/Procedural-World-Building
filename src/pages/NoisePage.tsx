import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { LayerPanel } from '../LayerPanel'
import { NoiseMapPreview, type Cell } from '../NoiseMapPreview'
import { NoiseViewport, type GeometryMode } from '../NoiseViewport'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { Workspace } from '../Workspace'
import {
  DEFAULT_OCTAVES,
  DEFAULT_PERSISTENCE,
  FBM_BASE_FREQUENCY,
  defaultNoiseSettings,
  fbmStack,
  noiseSpec,
  type NoiseSettings,
  type StoredLayer,
} from '../config/noiseConfig'
import { ACCENT_BLUE } from '../theme'
import {
  CONTINUOUS,
  FULL_DOMAIN,
  MAX_BANDS,
  PALETTES,
  buildLut,
  fieldDomain,
  getPalette,
  type PaletteName,
} from '../palette'
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
  warpField,
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
    // A UUID, not the counter: the counter restarts at zero on reload, so a
    // loaded world's layer ids would collide with the next layer added. The
    // counter still numbers the visible name, where repeating is harmless.
    id: crypto.randomUUID(),
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

/** Fresh ids for stored layers, which carry none. */
const withLayerIds = (layers: StoredLayer[]): NoiseLayer[] =>
  layers.map((layer) => ({ ...layer, id: crypto.randomUUID() }))

const createFbmStack = (octaves: number, persistence: number, maxFrequency: number) =>
  withLayerIds(fbmStack(octaves, persistence, maxFrequency))

const INITIAL = defaultNoiseSettings()
const INITIAL_LAYERS: NoiseLayer[] = withLayerIds(INITIAL.layers)

export function NoisePage() {
  const [mode, setMode] = useState<GeometryMode>('surface')
  const [resolution, setResolution] = useState(INITIAL.resolution)
  // Averaging six octaves shrinks the variance, so the stack's relief is about
  // 0.40 against the old pair's 0.71. Display scaling costs nothing, so the
  // height makes it back up rather than the spread pushing values into a clamp.
  const [heightScale, setHeightScale] = useState(1.4)
  // Relief is its own value, not a reused height: 0.8 on a radius-0.85 sphere
  // is an asteroid, and carrying the surface's setting across would look broken.
  const [relief, setRelief] = useState(0.18)
  const [slice, setSlice] = useState(0)
  const [selected, setSelected] = useState<Cell | null>(null)
  const [spin, setSpin] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [tint, setTint] = useState(ACCENT_BLUE)
  const [paletteName, setPaletteName] = useState<PaletteName>('terrain')
  const [bands, setBands] = useState(CONTINUOUS)
  const [fitRamp, setFitRamp] = useState(true)
  // Built once per palette, then indexed per cell: converting live would be
  // 21 ms against 0.21 ms for a 128² field.
  const lut = useMemo(() => buildLut(paletteName, tint, bands), [paletteName, tint, bands])

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

  const [warpAmount, setWarpAmount] = useState(0)
  const [warpFrequency, setWarpFrequency] = useState(4)
  const [warpSeed, setWarpSeed] = useState(1)
  const [talus, setTalus] = useState(0.02)
  const [talusStrength, setTalusStrength] = useState(0.5)
  const [thermalPasses, setThermalPasses] = useState(0)

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
  // Warping sits between compositing and the automaton: it moves where the
  // noise puts its features, which is a question about the field rather than
  // about the rule applied to it.
  const warped = useMemo(
    () => warpField(composite, resolution, dimensions, {
      amount: warpAmount, frequency: warpFrequency, seed: warpSeed,
    }),
    [composite, resolution, dimensions, warpAmount, warpFrequency, warpSeed],
  )
  // Re-run from the composite every time rather than mutating a running state:
  // a generation count is then just a number, so editing a layer mid-run stays
  // consistent instead of leaving a stale automaton behind.
  const automata = useMemo(
    () =>
      runAutomata(warped, resolution, dimensions, {
        threshold: caThreshold,
        survive,
        generations: generation,
      }),
    [warped, resolution, dimensions, caThreshold, survive, generation],
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
  // Fitting stretches the colouring only — geometry still uses the raw value,
  // so a fitted ramp never changes the shape of the terrain.
  const domain = useMemo(() => (fitRamp ? fieldDomain(field) : FULL_DOMAIN), [fitRamp, field])
  const ramp = useMemo(() => ({ ...lut, ...domain }), [lut, domain])

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
      return erodeStep(
        previous, automata.field, resolution, budget, erosionSeed * 7919, erosionParams,
        { talus, strength: talusStrength, passes: thermalPasses },
      )
    })
  }, [
    automata.field, resolution, density, erosionSeed, erosionParams,
    talus, talusStrength, thermalPasses,
  ])

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

  const settings = useMemo<NoiseSettings>(
    () => ({
      mode, resolution, heightScale, relief, slice, spin, wireframe, tint, paletteName, bands,
      fitRamp, presetName, erosionParams, density, erosionSeed, showCutFill, caThreshold, survive,
      warpAmount, warpFrequency, warpSeed, talus, talusStrength, thermalPasses, octaves,
      persistence, outputShapingName, outputParams,
      // Stripped of their ids, which are React keys rather than part of a layer.
      layers: layers.map((layer) => {
        const { id, ...rest } = layer
        void id
        return { ...rest, shapingParams: { ...rest.shapingParams } }
      }),
    }),
    [mode, resolution, heightScale, relief, slice, spin, wireframe, tint, paletteName, bands,
     fitRamp, presetName, erosionParams, density, erosionSeed, showCutFill, caThreshold, survive,
     warpAmount, warpFrequency, warpSeed, talus, talusStrength, thermalPasses, octaves,
     persistence, layers, outputShapingName, outputParams],
  )

  /**
   * Replaces the whole page. The erosion run, the CA generation count and the
   * selected cell are reset rather than restored: they are accumulated or
   * transient, and the parameters that produce them are what was stored.
   */
  const applySettings = (next: NoiseSettings) => {
    setMode(next.mode)
    setResolution(next.resolution)
    setHeightScale(next.heightScale)
    setRelief(next.relief)
    setSlice(next.slice)
    setSpin(next.spin)
    setWireframe(next.wireframe)
    setTint(next.tint)
    setPaletteName(next.paletteName)
    setBands(next.bands)
    setFitRamp(next.fitRamp)
    setPresetName(next.presetName)
    setErosionParams(next.erosionParams)
    setDensity(next.density)
    setErosionSeed(next.erosionSeed)
    setShowCutFill(next.showCutFill)
    setCaThreshold(next.caThreshold)
    setSurvive(next.survive)
    setWarpAmount(next.warpAmount)
    setWarpFrequency(next.warpFrequency)
    setWarpSeed(next.warpSeed)
    setTalus(next.talus)
    setTalusStrength(next.talusStrength)
    setThermalPasses(next.thermalPasses)
    setOctaves(next.octaves)
    setPersistence(next.persistence)
    setOutputShapingName(next.outputShapingName)
    setOutputParams(next.outputParams)
    const restored = withLayerIds(next.layers)
    setLayers(restored)
    setExpandedId(restored[0]?.id ?? null)
    setErosion(null)
    setGeneration(0)
    setPlaying(false)
    setSelected(null)
  }

  return (
    <Workspace
      topic="maps"
      library={<ConfigPanel spec={noiseSpec} settings={settings} onLoad={applySettings} />}
      inspector={
        <aside className="control-sidebar" aria-label="Noise controls">
        <h2>Source map</h2>
        <NoiseMapPreview
          resolution={resolution}
          field={mapField}
          selected={inRange}
          onSelect={setSelected}
          ramp={ramp}
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

        <h3 className="control-group">
          <InfoTip text={"How the field is drawn: which colours it maps to, which shape it becomes, and how finely it is sampled. Nothing here changes the field itself — only how you see it."}>Geometry</InfoTip>
        </h3>

        <label className="control">
          <span className="control-label">
            <InfoTip text={"Which colours the field maps onto. Scaling one colour by the value is a luminance ramp, and the eye resolves luminance far worse than hue — a terrain ramp offers about 165 distinguishable steps against 74 for a single hue."}>Palette</InfoTip>
          </span>
          <select
            value={paletteName}
            onChange={(event) => setPaletteName(event.target.value as PaletteName)}
          >
            {PALETTES.map((palette) => (
              <option key={palette.value} value={palette.value}>
                {palette.label}
              </option>
            ))}
          </select>
        </label>

        {getPalette(paletteName).stops === null && (
          <label className="control">
            <span className="control-label">
              <InfoTip text={"The colour the single-hue ramp runs to from black. Shown only for Single hue; every other palette carries its own stops."}>Colour</InfoTip>
              <span className="control-value">{tint}</span>
            </span>
            <input
              type="color"
              value={tint}
              onChange={(event) => setTint(event.target.value)}
            />
          </label>
        )}

        <Slider
          label="Bands"
          info={"Quantises the ramp into flat steps, turning a smooth field into contour-like regions. It bands the RAMP rather than the field, so the surface underneath stays smooth — unlike the Terrace shaping op, which genuinely terraces the terrain."}
          value={bands}
          display={bands < 2 ? 'continuous' : String(bands)}
          min={CONTINUOUS}
          max={MAX_BANDS}
          step={1}
          onChange={setBands}
        />

        <label className="control control-toggle">
          <span className="control-label">
            <InfoTip text={"Stretches the ramp across the field’s actual minimum and maximum. Without it the default stack reaches only 113 of 256 ramp entries, so most of the palette goes unused — fewer distinguishable steps than the old single-colour ramp managed."}>Fit ramp to range</InfoTip>
          </span>
          <input
            type="checkbox"
            checked={fitRamp}
            onChange={(event) => setFitRamp(event.target.checked)}
          />
        </label>

        <p className="readout">
          ramp spans{' '}
          <strong>
            {domain.min.toFixed(2)}–{(domain.min + domain.span).toFixed(2)}
          </strong>
          {!fitRamp && ' — the field uses only part of it'}
        </p>

        <label className="control">
          <span className="control-label">
            <InfoTip
              text={`What the field is drawn as. ${
                GEOMETRIES.find((g) => g.value === mode)?.hint ?? ''
              } Height field graphs the map as a surface, Volumetric draws every cell of a 3D field as a point, and Planet displaces a sphere by the 3D field sampled at each vertex.`}
            >
              Mode
            </InfoTip>
          </span>
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
          info={"Vertical scale of the surface. Purely display: it stretches what you see without touching the values, so it is the right way to recover relief lost to averaging octaves."}
            value={heightScale}
            display={heightScale.toFixed(2)}
            min={0}
            max={2}
            step={0.01}
            onChange={setHeightScale}
          />
        )}

        {mode === 'surface' && (
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text={"Draws the sampling lattice over the surface: one line per row and per column, so you can see the grid the field is actually stored on. Only the lattice — not the triangulation, whose diagonals come from how each quad was split rather than from the data. At 128² the lines land a few pixels apart and read as a haze; drop the resolution to see individual cells."}>
                Wireframe
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(event) => setWireframe(event.target.checked)}
            />
          </label>
        )}

        {mode === 'planet' && (
          <Slider
            label="Relief"
          info={"How far the noise displaces the sphere. Its own value rather than a reused Height, because 0.8 on a radius-0.85 planet is an asteroid."}
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
          info={"Which z-plane of the 3D volume the sidebar map shows. The geometry always draws the whole volume; this only moves the cross-section you inspect."}
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
          info={"Cells per side. A volume costs the cube of this, which is why it caps at 32 where a height field caps at 128; switching modes clamps it on the way in."}
          value={resolution}
          display={mode === 'surface' ? `${resolution}²` : `${resolution}³`}
          min={2}
          max={MAX_RESOLUTION[mode]}
          step={1}
          onChange={setResolution}
        />

        <Slider
          label="Spin"
          info={"Turns the object about its vertical axis, in degrees per second. Useful for reading relief: a shape that is ambiguous when still usually resolves as soon as the shading moves across it."}
          value={spin}
          display={spin === 0 ? 'off' : `${spin}°/s`}
          min={0}
          max={90}
          step={1}
          onChange={setSpin}
        />

        <h3 className="control-group">
          <InfoTip text={"The noise stack the field is built from. Each layer samples its own lattice and composites onto the running result, bottom-up."}>Layers</InfoTip>
        </h3>

        <Slider
          label="Octaves"
          info={"How many doublings of frequency the stack spans. More octaves fill in the scales between coarse shape and fine detail, which is what stops a field reading as random."}
          value={octaves}
          display={`${octaves} · f${FBM_BASE_FREQUENCY}–f${Math.min(resolution, FBM_BASE_FREQUENCY * 2 ** (octaves - 1))}`}
          min={1}
          max={8}
          step={1}
          onChange={setOctaves}
        />
        <Slider
          label="Persistence"
          info={"How much quieter each octave is than the one below. This is the roughness dial: around 0.3 reads as rolling hills, 0.5 is balanced, and past about 0.7 it stops looking like terrain at all."}
          value={persistence}
          display={persistence.toFixed(2)}
          min={0.2}
          max={0.9}
          step={0.01}
          onChange={setPersistence}
        />
        <button type="button" className="reset-button" onClick={rebuildStack}>
          <InfoTip
            text={`Replaces the whole stack with ${octaves} octaves of doubling frequency at ${persistence.toFixed(
              2,
            )}× amplitude each. Seeds are the octave index, so rebuilding at a different persistence redraws the same terrain at a different roughness rather than an unrelated one.`}
          >
            Rebuild as fBm stack
          </InfoTip>
        </button>

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

        <h3 className="control-group">
          <InfoTip text={"Looks the field up at coordinates displaced by another noise field, so strata fold and ridges curve instead of sitting where the lattice put them."}>Warp</InfoTip>
        </h3>

        <Slider
          label="Warp amount"
          info={"Maximum displacement in cells. Below about 20 it moves where features are without changing how rough they are; past that it starts shearing the fine octaves apart. 0 leaves the field untouched."}
          value={warpAmount}
          display={warpAmount === 0 ? 'off' : `${warpAmount} cells`}
          min={0}
          max={40}
          step={1}
          onChange={setWarpAmount}
        />
        {warpAmount > 0 && (
          <>
            <Slider
              label="Warp scale"
          info={"Lattice frequency of the offset fields. A low value bends whole regions into folds; a high one only jitters edges."}
              value={warpFrequency}
              display={`f${warpFrequency}`}
              min={2}
              max={Math.min(32, resolution)}
              step={1}
              onChange={setWarpFrequency}
            />
            <button
              type="button"
              className="reset-button"
              onClick={() => setWarpSeed((current) => current + 1)}
            >
              New warp
            </button>
          </>
        )}
        <h3 className="control-group">
          <InfoTip text={"A neighbour rule applied repeatedly. Where shaping is per-cell f(x), this is f(x, neighbours) — which is what turns speckled noise into connected landmasses."}>Automata</InfoTip>
        </h3>

        <Slider
          label="Alive above"
          info={"The value at or above which a cell starts the run alive. Set it under the field minimum and every cell is alive so nothing can flip; set it over the maximum and everything dies."}
          value={caThreshold}
          display={caThreshold.toFixed(2)}
          min={0}
          max={1}
          step={0.01}
          onChange={setCaThreshold}
        />
        <Slider
          label="Survive at"
          info={"How many cells in the block must be live for a cell to be live next pass. The block includes the cell itself — without a vote of its own a cell cannot hold its state and the field just erodes away."}
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
          {BLOCK_SIZE[dimensions]} cells in its {dimensions === 2 ? '3×3' : '3×3×3'}{' '}
          <InfoTip text={"The cell itself is counted along with its neighbours. Counting only the 8 surrounding cells looks like the same rule but is not: with no vote of its own a cell cannot hold its state, and the field erodes away instead of settling."}>
            block (itself included)
          </InfoTip>{' '}
          are live. Live cells keep their value; dead cells go to 0.
        </p>

        <h3 className="control-group">
          <InfoTip text={"Simulated water running over the height field, cutting where it runs fast and dropping what it carries where it slows. This is what produces valley networks, which noise alone never does."}>Erosion</InfoTip>
        </h3>

        {!canErode ? (
          <p className="hint">
            Erosion needs a{' '}
            <InfoTip text={"Droplets have to run downhill, and only a height field has a downhill. A volume has no “down” at all, and the planet is displaced from the 3D field precisely so that it needs no surface grid — so there is no lattice for droplets to follow. Eroding the planet would mean running the simulation over the icosphere’s vertex adjacency instead, which is a separate and much larger job."}>
              height field
            </InfoTip>
            . Switch Mode to erode.
          </p>
        ) : (
          <>
            <label className="control">
              <span className="control-label">
            <InfoTip text={"A measured starting point for the droplet parameters. Nudging any slider below switches this to Custom, since the preset name would otherwise describe terrain it did not carve."}>Preset</InfoTip>
          </span>
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
          info={"Droplets per cell, not a flat count. A fixed count means something different at every resolution: 5,000 droplets is 0.3 per cell at 128 but 1.2 at 64, so the same setting that carves valleys on one grid strips the relief off another."}
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
                  info={spec.info}
                  value={value}
                  display={spec.format ? spec.format(value) : value.toFixed(2)}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  onChange={(next) => setErosionParam(spec.key, next)}
                />
              )
            })}

            <Slider
              label="Talus passes"
          info={"Thermal slippage passes run after the droplets each tick. Where droplets transport material, this is purely local: a cell hands its excess to neighbours below its angle of repose."}
              value={thermalPasses}
              display={thermalPasses === 0 ? 'off' : `${thermalPasses} / tick`}
              min={0}
              max={8}
              step={1}
              onChange={setThermalPasses}
            />
            {thermalPasses > 0 && (
              <>
                <Slider
                  label="Angle of repose"
          info={"The steepest slope a cell can hold before it slumps. Lower values settle the terrain into gentler, more uniform hillsides."}
                  value={talus}
                  display={talus.toFixed(3)}
                  min={0.002}
                  max={0.08}
                  step={0.002}
                  onChange={setTalus}
                />
                <Slider
                  label="Slump strength"
          info={"How much of the excess moves per pass. Half the worst excess is the most that moves in one go — moving all of it would overshoot and oscillate."}
                  value={talusStrength}
                  display={talusStrength.toFixed(2)}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={setTalusStrength}
                />
              </>
            )}
            <label className="control control-toggle">
              <span className="control-label">
            <InfoTip text={"Tints the surface by where material moved rather than by height: warm where the droplets cut, cool where they dropped their load. This is the clearest view of the channel network."}>Colour by cut / fill</InfoTip>
          </span>
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
              <InfoTip
                text={`${
                  getPreset(presetName).value === presetName
                    ? getPreset(presetName).hint
                    : 'Custom settings.'
                } Channel structure is cut in the first few ticks and worn away afterwards: concentration peaks around 0.3 droplets per cell and decays from there, so more erosion is not better.`}
              >
                Watch the relief figure
              </InfoTip>{' '}
              — once it drops far, the run is lowering the whole field rather
              than carving it.
            </p>
          </>
        )}

        <h3 className="control-group">
          <InfoTip text={"A final remap of the finished field, applied after everything else. Shaping here reshapes the terrain you see without touching any layer."}>Output</InfoTip>
        </h3>

        <label className="control">
          <span className="control-label">
            <InfoTip text={"A remap applied to every cell independently. Unlike the automaton it has no notion of neighbours, so it reshapes the distribution of values rather than their arrangement."}>Shaping</InfoTip>
          </span>
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
              info={param.info}
              value={value}
              display={param.format ? param.format(value) : value.toFixed(2)}
              min={param.min}
              max={param.max}
              step={param.step}
              onChange={(next) => setOutputParams((c) => ({ ...c, [param.key]: next }))}
            />
          )
        })}

        <p className="hint">Drag to orbit, scroll to zoom, right-drag to pan.</p>
        </aside>
      }
    >
      <NoiseViewport
        mode={mode}
        resolution={resolution}
        field={field}
        heightScale={mode === 'planet' ? relief : heightScale}
        selected={inRange ? { ...inRange, z: sliceZ } : null}
        ramp={ramp}
        overlay={overlay}
        spin={spin}
        wireframe={wireframe}
      />
    </Workspace>
  )
}
