import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { Workspace } from '../Workspace'
import {
  CITY_SPECS,
  DEFAULT_LAYERS,
  citySpec,
  defaultCitySettings,
  type CitySettings,
  type CitySpec,
  type ExperimentId,
} from '../config/cityConfig'
import { buildBuilding } from '../city/building'
import { extractBlocks } from '../city/blocks'
import { CATEGORY_COLOURS, HEAT_STOPS } from '../city/cityMeshes'
import { CityViewport, type Layers } from '../city/CityViewport'
import { EXPLANATIONS } from '../city/explanations'
import { buildFields, sampleMap, type FieldName } from '../city/fields'
import { buildSite } from '../city/ground'
import { subdivide } from '../city/plots'
import { degrees, generateRoads, roadLength, type RoadStrategy } from '../city/roads'
import { layoutSite } from '../city/site'
import {
  CATEGORIES,
  MIN_FRONTAGE,
  MOIST,
  RANDOM_MIX,
  WET,
  categoryCounts,
  coherence,
  zoneAll,
  type Category,
  type RuleId,
  type Zone,
} from '../city/zoning'
import '../study/study.css'
import '../city/city.css'

const byKey = (key: CitySpec['key']) => CITY_SPECS.find((s) => s.key === key) as CitySpec

const EXPERIMENT_TABS: { id: ExperimentId; letter: string; title: string }[] = [
  { id: 'roads', letter: 'A', title: 'Roads' },
  { id: 'plots', letter: 'B', title: 'Plots' },
  { id: 'zoning', letter: 'C', title: 'Zoning' },
  { id: 'building', letter: 'D', title: 'Building' },
  { id: 'site', letter: 'E', title: 'Site' },
]

/** Which toggles mean anything in each experiment. */
const AVAILABLE: Record<ExperimentId, (keyof Layers)[]> = {
  roads: ['roads'],
  plots: ['roads', 'plots'],
  zoning: ['roads', 'plots', 'zoning'],
  building: [],
  site: ['roads', 'plots', 'zoning', 'buildings', 'vegetation'],
}

const LAYER_LABELS: Record<keyof Layers, { label: string; info: string }> = {
  roads: { label: 'Roads', info: 'The road network. Hiding it changes nothing downstream: blocks and plots are already cut.' },
  plots: { label: 'Plot boundaries', info: 'Each plot filled with its category colour and outlined. In Experiment C the fill shrinks to a tile so the zoning map shows round it.' },
  zoning: { label: 'Zoning map', info: 'The selected map painted on the ground as a heatmap, slate (0) to pale (1). Water is darkened: the maps mean nothing there.' },
  buildings: { label: 'Buildings', info: 'One instanced mesh per part kind — walls, windows, balconies, roofs — for every building on the site.' },
  vegetation: { label: 'Vegetation', info: 'Trees in parks and gardens, shrubs in gardens, and the countryside outside the blocks, all thinned by the vegetation map.' },
}

const CATEGORY_LABELS: Record<Category, string> = { building: 'Building', park: 'Park', garden: 'Garden', open: 'Open space' }

const MAP_LABELS: Record<FieldName, string> = {
  density: 'Density',
  vegetation: 'Vegetation',
  moisture: 'Moisture',
  elevation: 'Elevation',
  distance: 'Distance',
}

const STRATEGY_LABELS: Record<RoadStrategy, string> = { grid: 'Grid', organic: 'Organic', layered: 'Layered' }

export function CityPage() {
  const [settings, setSettings] = useState<CitySettings>(defaultCitySettings)
  const [hovered, setHovered] = useState(-1)
  const s = settings
  const set = <K extends keyof CitySettings>(key: K, value: CitySettings[K]) => setSettings((c) => ({ ...c, [key]: value }))

  const chooseExperiment = (experiment: ExperimentId) => {
    setHovered(-1)
    setSettings((c) => ({ ...c, experiment, show: { ...DEFAULT_LAYERS[experiment] } }))
  }
  const reset = () => {
    setHovered(-1)
    setSettings((c) => ({ ...defaultCitySettings(), experiment: c.experiment, seed: c.seed, show: { ...DEFAULT_LAYERS[c.experiment] } }))
  }
  const newSeed = () => {
    setHovered(-1)
    setSettings((c) => ({ ...c, seed: (c.seed % 999) + 1 }))
  }

  // The pipeline. Each stage is memoised on its own inputs, so a slider
  // re-runs its stage and the ones after it, and nothing before it.
  const site = useMemo(() => buildSite(s.seed), [s.seed])
  const net = useMemo(
    () => generateRoads(site.ground, { strategy: s.strategy, density: s.density, width: s.roadWidth, irregularity: s.irregularity, seed: s.seed }),
    [site, s.strategy, s.density, s.roadWidth, s.irregularity, s.seed],
  )
  const blocks = useMemo(() => extractBlocks(net), [net])
  const plots = useMemo(
    () => subdivide(blocks.blocks, net, { mode: s.plotMode, size: s.plotSize, irregularity: s.plotIrregularity, seed: s.seed }),
    [blocks, net, s.plotMode, s.plotSize, s.plotIrregularity, s.seed],
  )
  const fields = useMemo(
    () => buildFields(site.ground, net.centre, { noiseScale: s.noiseScale, noiseIntensity: s.noiseIntensity, reach: s.reach, seed: s.seed }),
    // The centre depends on the ground alone, so its coordinates are the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site, net.centre.x, net.centre.z, s.noiseScale, s.noiseIntensity, s.reach, s.seed],
  )
  const zoningParams = useMemo(
    () => ({ buildThreshold: s.buildThreshold, greenThreshold: s.greenThreshold, blend: s.blend, maxFloors: s.maxFloors, seed: s.seed }),
    [s.buildThreshold, s.greenThreshold, s.blend, s.maxFloors, s.seed],
  )
  const needsZones = s.experiment === 'plots' || s.experiment === 'zoning' || s.experiment === 'site'
  const zoningMode = s.experiment === 'plots' ? 'random' : 'maps'
  const zones = useMemo(
    () => (needsZones ? zoneAll(plots.plots, fields, zoningParams, zoningMode) : null),
    [needsZones, plots, fields, zoningParams, zoningMode],
  )
  // The comparison number for B and C: what dealing at random would have scored on these plots.
  const coherenceNow = useMemo(() => (zones ? coherence(zones) : 0), [zones])
  const coherenceOther = useMemo(
    () => (needsZones ? coherence(zoneAll(plots.plots, fields, zoningParams, zoningMode === 'maps' ? 'random' : 'maps')) : 0),
    [needsZones, plots, fields, zoningParams, zoningMode],
  )
  const style = useMemo(() => ({ roofSlope: s.roofSlope, balconyChance: s.balconyChance, facadeVariation: s.facadeVariation }), [s.roofSlope, s.balconyChance, s.facadeVariation])
  const layout = useMemo(
    () => (s.experiment === 'site' && zones ? layoutSite(zones, blocks.blocks.map((b) => b.face), site.ground, fields, net, style, s.seed) : null),
    [s.experiment, zones, blocks, site, fields, net, style, s.seed],
  )
  const studio = useMemo(
    () => buildBuilding({ width: s.width, depth: s.depth, floors: s.floors, roof: s.roof, roofSlope: s.roofSlope, balconyChance: s.balconyChance, facadeVariation: s.facadeVariation, seed: s.seed }),
    [s.width, s.depth, s.floors, s.roof, s.roofSlope, s.balconyChance, s.facadeVariation, s.seed],
  )

  const showHeat = (s.experiment === 'zoning' || s.experiment === 'site') && s.show.zoning
  const heat = useMemo(() => {
    if (!showHeat) return null
    const map = fields.maps[s.map]
    return (x: number, z: number) => sampleMap(fields, map, x, z)
  }, [showHeat, fields, s.map])

  const onHover = useCallback((i: number) => setHovered((h) => (h === i ? h : i)), [])

  const layers: Layers = {
    roads: s.show.roads && AVAILABLE[s.experiment].includes('roads'),
    plots: s.show.plots && AVAILABLE[s.experiment].includes('plots'),
    zoning: showHeat,
    buildings: s.show.buildings,
    vegetation: s.show.vegetation,
  }

  const slider = (key: CitySpec['key']) => {
    const spec = byKey(key)
    const value = s[key]
    return (
      <Slider
        key={key}
        label={spec.label}
        info={spec.info}
        value={value}
        display={spec.format ? spec.format(value) : String(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(v) => set(key, v)}
      />
    )
  }

  const segmented = <T extends string>(label: string, value: T, options: [T, string][], onChange: (v: T) => void) => (
    <div className="segmented city-segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={`segmented-option${value === v ? ' is-active' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )

  const hoveredZone = zones && hovered >= 0 ? zones[hovered] : null
  const explanation = EXPLANATIONS[s.experiment]

  return (
    <Workspace
      topic="city"
      library={
        <ConfigPanel
          spec={citySpec}
          settings={settings}
          onLoad={(next) => {
            setHovered(-1)
            setSettings(next)
          }}
        />
      }
      inspector={
        <aside className="control-sidebar city-sidebar" aria-label="City generation controls">
          <header className="city-header">
            <h2>Topic 10: City</h2>
            <p>
              Explore how procedural rules transform terrain into organized environments through road networks, spatial
              subdivision, zoning maps, and parametric architecture.
            </p>
          </header>

          <div className="city-tabs" role="tablist" aria-label="Experiments">
            {EXPERIMENT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={s.experiment === t.id}
                className={`city-tab${s.experiment === t.id ? ' is-active' : ''}`}
                onClick={() => chooseExperiment(t.id)}
              >
                <span className="city-tab-letter">{t.letter}</span>
                <span className="city-tab-title">{t.title}</span>
              </button>
            ))}
          </div>
          <p className="city-lede">{explanation.lede}</p>

          <div className="city-seed-row">
            <label className="city-seed">
              <InfoTip text="One seed drives every stage: the terrain, the road growth, the cuts, the noise in the maps, each plot's die and each building's facade. The same seed and parameters always rebuild the same site.">
                Seed
              </InfoTip>
              <input
                type="number"
                min={1}
                max={999}
                value={s.seed}
                aria-label="Seed"
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value))
                  if (Number.isFinite(v) && v >= 1 && v <= 999) set('seed', v)
                }}
              />
            </label>
            <button type="button" className="reset-button is-primary" onClick={newSeed} title="Next seed: new terrain, new roads, new everything">
              New seed
            </button>
            <button type="button" className="reset-button" onClick={reset} title="Every parameter back to its default; the seed and the experiment stay">
              Reset
            </button>
          </div>

          {s.experiment === 'roads' && (
            <Group title="Road network" info="One growth algorithm with five local rules; the strategy only changes what each new road proposes next.">
              {segmented('Road strategy', s.strategy, [['grid', 'Grid'], ['organic', 'Organic'], ['layered', 'Layered']], (v) => set('strategy', v))}
              {slider('density')}
              {slider('roadWidth')}
              {slider('irregularity')}
            </Group>
          )}

          {s.experiment === 'plots' && (
            <Group title="Subdivision" info="Blocks are the faces of the road graph, inset from each road. Plots are cut from blocks by straight lines.">
              {segmented('Subdivision', s.plotMode, [['grid', 'Regular grid'], ['irregular', 'Irregular']], (v) => set('plotMode', v))}
              {slider('plotSize')}
              {s.plotMode === 'irregular' && slider('plotIrregularity')}
              <p className="hint">
                Categories here are dealt at random in fixed shares — {Math.round(RANDOM_MIX.building * 100)}% building,{' '}
                {Math.round(RANDOM_MIX.park * 100)}% park, {Math.round(RANDOM_MIX.garden * 100)}% garden,{' '}
                {Math.round(RANDOM_MIX.open * 100)}% open — so Experiment C has something to be compared with. Only two
                rules hold: a sliver is open space, and a plot with no road frontage is a garden.
              </p>
            </Group>
          )}

          {(s.experiment === 'zoning' || s.experiment === 'site') && (
            <>
              {s.experiment === 'zoning' && (
                <Group title="Spatial maps" info="Continuous fields over the site, each in [0, 1]. The map shown is one of five; the decision reads all of them.">
                  <div className="city-maps" role="radiogroup" aria-label="Map">
                    {(Object.keys(MAP_LABELS) as FieldName[]).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={s.map === m} className={`segmented-option${s.map === m ? ' is-active' : ''}`} onClick={() => setSettings((c) => ({ ...c, map: m, show: { ...c.show, zoning: true } }))}>
                        {MAP_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  <p className="hint">{MAP_FORMULAS[s.map]}</p>
                  {slider('noiseScale')}
                  {slider('noiseIntensity')}
                  {slider('reach')}
                </Group>
              )}
              <Group title="Decision" info="Each plot reads the maps at its centre and takes the first rule that applies. Counts are plots decided by each rule now.">
                {slider('buildThreshold')}
                {slider('greenThreshold')}
                {slider('blend')}
                {s.experiment === 'site' && slider('maxFloors')}
                {zones && <RuleList zones={zones} active={hoveredZone?.rule} buildThreshold={s.buildThreshold} greenThreshold={s.greenThreshold} />}
              </Group>
              {s.experiment === 'site' && (
                <Group title="Building style" info="Shared with Experiment D: the same generator builds every building here. Zoning sets the floors and type, the plot sets the footprint; these three set the style.">
                  {slider('roofSlope')}
                  {slider('balconyChance')}
                  {slider('facadeVariation')}
                </Group>
              )}
            </>
          )}

          {s.experiment === 'building' && (
            <Group title="Building parameters" info="Every part is generated from these numbers and the seed; nothing is loaded from a model.">
              {slider('width')}
              {slider('depth')}
              {slider('floors')}
              {segmented('Roof type', s.roof, [['flat', 'Flat roof'], ['pitched', 'Pitched roof']], (v) => set('roof', v))}
              {s.roof === 'pitched' && slider('roofSlope')}
              {slider('balconyChance')}
              {slider('facadeVariation')}
            </Group>
          )}

          {AVAILABLE[s.experiment].length > 0 && (
            <>
              <h3 className="control-group">Show</h3>
              {AVAILABLE[s.experiment].map((k) => (
                <label key={k} className="control control-toggle">
                  <span className="control-label">
                    <InfoTip text={LAYER_LABELS[k].info}>{LAYER_LABELS[k].label}</InfoTip>
                  </span>
                  <input type="checkbox" checked={s.show[k]} onChange={(e) => setSettings((c) => ({ ...c, show: { ...c.show, [k]: e.target.checked } }))} />
                </label>
              ))}
            </>
          )}

          <h3 className="control-group">
            <InfoTip text="Counted from the site on screen, every time it is rebuilt. Times are main-thread milliseconds for each stage on this machine.">
              Measurements
            </InfoTip>
          </h3>
          <div className="readout city-readout">
            {s.experiment === 'roads' && <RoadStats net={net} terrainMs={site.terrain.buildMs} />}
            {s.experiment === 'plots' && zones && (
              <PlotStats blocks={blocks} plots={plots} zones={zones} coherenceNow={coherenceNow} coherenceOther={coherenceOther} />
            )}
            {s.experiment === 'zoning' && zones && (
              <ZoningStats zones={zones} fieldsMs={fields.ms} coherenceNow={coherenceNow} coherenceOther={coherenceOther} />
            )}
            {s.experiment === 'building' && <BuildingStats studio={studio} />}
            {s.experiment === 'site' && layout && zones && <SiteStats layout={layout} zones={zones} timings={{ terrain: site.terrain.buildMs, roads: net.ms, blocks: blocks.ms, plots: plots.ms, fields: fields.ms, site: layout.ms }} />}
          </div>

          <Explanation id={s.experiment} />
        </aside>
      }
    >
      <CityViewport
        stage={s.experiment === 'building' ? 'studio' : 'site'}
        site={site}
        net={net}
        zones={zones}
        fillShrink={s.experiment === 'zoning' && showHeat ? 0.5 : 1}
        heat={heat}
        layout={layout}
        studio={studio}
        show={layers}
        hovered={hovered}
        onHover={onHover}
      />
      <Legend experiment={s.experiment} heat={showHeat ? s.map : null} strategy={s.strategy} />
      {hoveredZone && <Probe zone={hoveredZone} experiment={s.experiment} buildThreshold={s.buildThreshold} greenThreshold={s.greenThreshold} />}
    </Workspace>
  )
}

const MAP_FORMULAS: Record<FieldName, string> = {
  density: 'Density = a bell around the centre, falling to 0 at the reach, × (0.4 + 0.6 × flatness), + noise. Zero on water.',
  vegetation: 'Vegetation = 0.55 × moisture + 0.45 × (1 − density) − 0.15, + noise. High where it is wet and unbuilt.',
  moisture: 'Moisture = 0.6 × nearness to water (e-folding over 18 units) + 0.4 × (1 − elevation), + noise.',
  elevation: 'Elevation = height above the waterline, 0 at the shore and 1 at the highest ground. No noise.',
  distance: 'Distance = straight-line distance from the city centre, over half the site width. No noise.',
}

function Group({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  return (
    <>
      <h3 className="control-group">
        <InfoTip text={info}>{title}</InfoTip>
      </h3>
      {children}
    </>
  )
}

const RULES: { id: RuleId; text: (b: number, g: number) => string; to: Category }[] = [
  { id: 'sliver', text: () => 'too small or thin to build', to: 'open' },
  { id: 'wet', text: () => `moisture ≥ ${WET.toFixed(2)}`, to: 'park' },
  { id: 'dense', text: (b) => `density passes ${b.toFixed(2)}`, to: 'building' },
  { id: 'courtyard', text: () => `…but under ${MIN_FRONTAGE} u of road frontage`, to: 'garden' },
  { id: 'green', text: (_, g) => `vegetation ≥ ${g.toFixed(2)}`, to: 'park' },
  { id: 'moist', text: () => `moisture ≥ ${MOIST.toFixed(2)}`, to: 'garden' },
  { id: 'rest', text: () => 'otherwise', to: 'open' },
]

function RuleList({ zones, active, buildThreshold, greenThreshold }: { zones: Zone[]; active?: RuleId; buildThreshold: number; greenThreshold: number }) {
  const counts = new Map<RuleId, number>()
  for (const z of zones) counts.set(z.rule, (counts.get(z.rule) ?? 0) + 1)
  return (
    <ol className="city-rules" aria-label="Decision rules, in order">
      {RULES.map((r) => (
        <li key={r.id} className={active === r.id ? 'is-active' : undefined}>
          <span className="city-rule-text">{r.text(buildThreshold, greenThreshold)}</span>
          <span className="city-rule-to">
            <span className="swatch" style={{ background: hex(CATEGORY_COLOURS[r.to]) }} />
            {CATEGORY_LABELS[r.to]}
          </span>
          <span className="city-rule-count">{counts.get(r.id) ?? 0}</span>
        </li>
      ))}
    </ol>
  )
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

function Counts({ zones }: { zones: Zone[] }) {
  const c = categoryCounts(zones)
  return (
    <span className="city-counts">
      {CATEGORIES.map((k) => (
        <span key={k} className="legend-key">
          <span className="swatch" style={{ background: hex(CATEGORY_COLOURS[k]) }} />
          {CATEGORY_LABELS[k]} <strong>{c[k]}</strong>
        </span>
      ))}
    </span>
  )
}

function RoadStats({ net, terrainMs }: { net: ReturnType<typeof generateRoads>; terrainMs: number }) {
  const deg = degrees(net)
  const junctions = deg.filter((d) => d >= 3).length
  const deadEnds = deg.filter((d) => d === 1).length
  const rejected = Object.values(net.rejected).reduce((a, b) => a + b, 0)
  return (
    <>
      <strong>{net.edges.length}</strong> segments · <strong>{(roadLength(net) / 1000).toFixed(2)} km</strong> of road (
      {Math.round((roadLength(net, 'primary') / Math.max(roadLength(net), 1)) * 100)}% primary)
      <br />
      <strong>{junctions}</strong> junctions · <strong>{deadEnds}</strong> dead ends
      <br />
      <InfoTip text="Every proposal popped from the queue, and what the local rules did with it. Joined: stopped where it crossed a road. Snapped: ended on a nearby junction. Extended: stretched to meet a road just ahead. Merged: ended too close to a road and was joined straight onto it.">
        {net.proposals} proposals
      </InfoTip>
      : <strong>{net.grown}</strong> grew,{' '}
      <strong>{net.joined + net.snapped + net.extended + net.merged}</strong> joined the network, <strong>{rejected}</strong> refused
      <br />
      <span className="city-dim">
        refused for water {net.rejected.water}, slope {net.rejected.slope}, edge of town {net.rejected.bounds}, angle {net.rejected.angle}, crowding {net.rejected.crowded + net.rejected.short}
      </span>
      <br />
      <span className="city-dim">
        roads {net.ms.toFixed(1)} ms · terrain {terrainMs.toFixed(0)} ms
      </span>
    </>
  )
}

function CoherenceLine({ now, other, mode }: { now: number; other: number; mode: 'random' | 'maps' }) {
  return (
    <InfoTip text="Of each plot's four nearest neighbours, the share in the same category, averaged. Dealing categories at random scores near the sum of their squared shares, wherever they are dealt; a map-driven city scores higher because its districts are contiguous.">
      coherence <strong>{Math.round(now * 100)}%</strong>{' '}
      <span className="city-dim">
        ({mode === 'maps' ? 'dealt at random' : 'by the maps'}: {Math.round(other * 100)}%)
      </span>
    </InfoTip>
  )
}

function PlotStats({ blocks, plots, zones, coherenceNow, coherenceOther }: { blocks: ReturnType<typeof extractBlocks>; plots: ReturnType<typeof subdivide>; zones: Zone[]; coherenceNow: number; coherenceOther: number }) {
  const landlocked = plots.plots.filter((p) => p.frontage < MIN_FRONTAGE).length
  const slivers = plots.plots.filter((p) => p.sliver).length
  const meanArea = plots.plots.reduce((a, p) => a + p.area, 0) / Math.max(plots.plots.length, 1)
  return (
    <>
      <strong>{blocks.blocks.length}</strong> blocks from {blocks.faces} faces{' '}
      <span className="city-dim">
        ({blocks.slivers} too narrow, {blocks.oversized} too large, {blocks.prunedDeadEnds} dead-end segments pruned)
      </span>
      <br />
      <strong>{plots.plots.length}</strong> plots, mean <strong>{meanArea.toFixed(0)} u²</strong> · <strong>{landlocked}</strong> with no road ·{' '}
      <strong>{slivers}</strong> slivers · {plots.crossed} dropped under a dead end
      <br />
      <Counts zones={zones} />
      <br />
      <CoherenceLine now={coherenceNow} other={coherenceOther} mode="random" />
      <br />
      <span className="city-dim">
        blocks {blocks.ms.toFixed(1)} ms · plots {plots.ms.toFixed(1)} ms
      </span>
    </>
  )
}

function ZoningStats({ zones, fieldsMs, coherenceNow, coherenceOther }: { zones: Zone[]; fieldsMs: number; coherenceNow: number; coherenceOther: number }) {
  return (
    <>
      <Counts zones={zones} />
      <br />
      <CoherenceLine now={coherenceNow} other={coherenceOther} mode="maps" />
      <br />
      <span className="city-dim">five maps on a 128² grid in {fieldsMs.toFixed(1)} ms · hover a plot to see its decision</span>
    </>
  )
}

function BuildingStats({ studio }: { studio: ReturnType<typeof buildBuilding> }) {
  const tris = studio.parts.reduce((a, p) => a + (p.kind === 'gable' ? 6 : 12), 0)
  return (
    <>
      <strong>{studio.height.toFixed(1)} u</strong> tall · <strong>{studio.windows}</strong> windows ·{' '}
      <strong>{studio.balconies}</strong> balconies
      {studio.setback ? ' · top floor set back' : ''}
      <br />
      <strong>{studio.parts.length}</strong> parts · {tris.toLocaleString()} triangles
    </>
  )
}

function SiteStats({ layout, zones, timings }: { layout: NonNullable<ReturnType<typeof layoutSite>>; zones: Zone[]; timings: Record<string, number> }) {
  const types = { house: 0, apartment: 0, tower: 0 }
  let tallest = 0
  for (const b of layout.buildings) {
    types[b.type]++
    tallest = Math.max(tallest, b.params.floors)
  }
  const parts = layout.buildings.reduce((a, b) => a + b.result.parts.length, 0)
  const total = Object.values(timings).reduce((a, b) => a + b, 0)
  return (
    <>
      <strong>{layout.buildings.length}</strong> buildings: {types.house} houses, {types.apartment} apartment blocks, {types.tower} towers
      <br />
      mean <strong>{(layout.floors / Math.max(layout.buildings.length, 1)).toFixed(1)}</strong> floors, tallest <strong>{tallest}</strong>
      <br />
      <InfoTip text="A plot can veto the type zoning chose. A tower whose footprint will not fit becomes an apartment block of at most 6 floors; if that will not fit either, a house of at most 2. A plot that cannot hold even a house stays empty.">
        <strong>{layout.downgraded}</strong> stepped down a type to fit, <strong>{layout.unfit}</strong> too awkward to build on
      </InfoTip>
      <br />
      <strong>{layout.trees.length.toLocaleString()}</strong> trees and shrubs · {parts.toLocaleString()} building parts in 10 draw calls
      <br />
      <Counts zones={zones} />
      <br />
      <span className="city-dim">
        whole site {total.toFixed(0)} ms: terrain {timings.terrain.toFixed(0)}, roads {timings.roads.toFixed(1)}, blocks {timings.blocks.toFixed(1)}, plots {timings.plots.toFixed(1)}, maps {timings.fields.toFixed(1)}, buildings and trees {timings.site.toFixed(1)}
      </span>
    </>
  )
}

function Legend({ experiment, heat, strategy }: { experiment: ExperimentId; heat: FieldName | null; strategy: RoadStrategy }) {
  if (experiment === 'building') return null
  return (
    <div className="study-overlay study-legend city-legend" aria-hidden="true">
      {heat && (
        <span className="legend-key city-heat-key">
          {MAP_LABELS[heat]} 0
          <span className="city-heat-bar" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.join(', ')})` }} />1
        </span>
      )}
      {experiment === 'roads' ? (
        <>
          <span className="legend-key">
            <span className="swatch" style={{ background: '#565c63' }} />
            Primary
          </span>
          <span className="legend-key">
            <span className="swatch" style={{ background: '#6a7076' }} />
            Secondary
          </span>
          <span className="legend-key">{STRATEGY_LABELS[strategy]}</span>
        </>
      ) : (
        CATEGORIES.map((c) => (
          <span key={c} className="legend-key">
            <span className="swatch" style={{ background: hex(CATEGORY_COLOURS[c]) }} />
            {CATEGORY_LABELS[c]}
          </span>
        ))
      )}
    </div>
  )
}

function Probe({ zone, experiment, buildThreshold, greenThreshold }: { zone: Zone; experiment: ExperimentId; buildThreshold: number; greenThreshold: number }) {
  const p = zone.plot
  const rule = RULES.find((r) => r.id === zone.rule)
  const why =
    zone.rule === 'random'
      ? 'Dealt at random — no map consulted.'
      : zone.rule === 'dense' && zone.chance > 0 && zone.chance < 1
        ? `Density ${zone.sample.density.toFixed(2)} is inside the soft band: built with probability ${Math.round(zone.chance * 100)}%, and this plot rolled ${zone.roll.toFixed(2)}.`
        : rule
          ? `First rule that applies: ${rule.text(buildThreshold, greenThreshold)}.`
          : ''
  return (
    <div className="study-overlay study-probe city-probe" role="status">
      <div className="probe-ground">
        Plot <strong>#{p.id}</strong> · {p.area.toFixed(0)} u² · {p.frontage.toFixed(0)} u of road frontage →{' '}
        <span className="swatch" style={{ background: hex(CATEGORY_COLOURS[zone.category]) }} />
        <strong>{CATEGORY_LABELS[zone.category]}</strong>
        {zone.floors > 0 && (
          <>
            , <strong>{zone.floors}</strong> floor{zone.floors === 1 ? '' : 's'} ({zone.type})
          </>
        )}
      </div>
      <div className="city-dim">{why}</div>
      {experiment !== 'plots' && (
        <table className="probe-table city-probe-table">
          <tbody>
            <tr>
              {(Object.keys(MAP_LABELS) as FieldName[]).map((m) => (
                <th key={m}>{MAP_LABELS[m]}</th>
              ))}
            </tr>
            <tr>
              {(Object.keys(MAP_LABELS) as FieldName[]).map((m) => (
                <td key={m}>{zone.sample[m].toFixed(2)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

function Explanation({ id }: { id: ExperimentId }) {
  const e = EXPLANATIONS[id]
  return (
    <section className="city-explain" aria-label="How it works">
      <h3 className="control-group">How it works</h3>
      <dl>
        <dt>Concept</dt>
        <dd>{e.concept}</dd>
        <dt>Algorithm</dt>
        <dd>{e.algorithm}</dd>
        <dt>Parameters</dt>
        <dd>{e.parameters}</dd>
        <dt>For Wildform</dt>
        <dd>{e.application}</dd>
      </dl>
    </section>
  )
}
