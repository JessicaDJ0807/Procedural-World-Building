import type { RoofType } from '../city/building'
import { FIELD_NAMES, type FieldName } from '../city/fields'
import { RESOURCES, type Policy, type ResourceId } from '../city/sim/resources'
import type { PlotMode } from '../city/plots'
import type { RoadStrategy } from '../city/roads'
import { bool, int, isRecord, num, pick, type ConfigSpec } from './spec'

/**
 * What a Topic 10 world stores: the seed and every experiment's parameters.
 *
 * Nothing generated is stored. Every stage is a deterministic function of the
 * seed and the parameters before it — terrain, roads, blocks, plots, maps,
 * zones, buildings — and rebuilding the whole site from scratch takes a few
 * hundred milliseconds, most of it the terrain's erosion. Storing the result
 * would be storing thousands of polygons to save less than a second.
 */
export type ExperimentId = 'roads' | 'plots' | 'zoning' | 'building' | 'site' | 'agents' | 'resources' | 'dynamics'
export const EXPERIMENTS: ExperimentId[] = ['roads', 'plots', 'zoning', 'building', 'site', 'agents', 'resources', 'dynamics']

export type CitySettings = {
  experiment: ExperimentId
  seed: number
  strategy: RoadStrategy
  density: number
  roadWidth: number
  irregularity: number
  plotMode: PlotMode
  plotSize: number
  plotIrregularity: number
  map: FieldName
  noiseScale: number
  noiseIntensity: number
  reach: number
  buildThreshold: number
  greenThreshold: number
  blend: number
  maxFloors: number
  width: number
  depth: number
  floors: number
  roof: RoofType
  roofSlope: number
  balconyChance: number
  facadeVariation: number
  population: number
  walkSpeed: number
  simSpeed: number
  resource: ResourceId
  supply: number
  demand: number
  capacity: number
  policy: Policy
  show: { roads: boolean; plots: boolean; zoning: boolean; buildings: boolean; vegetation: boolean; agents: boolean; network: boolean }
}

export type NumericKey = {
  [K in keyof CitySettings]: CitySettings[K] extends number ? K : never
}[keyof CitySettings]

export type CitySpec = {
  key: Exclude<NumericKey, 'seed'>
  label: string
  info: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const u = (v: number) => `${v.toFixed(0)} u`
const f2 = (v: number) => v.toFixed(2)

export const CITY_SPECS: CitySpec[] = [
  { key: 'density', label: 'Road density', info: 'Closer roads, smaller blocks. Sets the spacing a grid repeats at and a layered city\'s secondaries branch at (64 units at 0, 24 at 1), and for organic roads (38 to 16) both the step length and how close two streets may run.', min: 0, max: 1, step: 0.05, value: 0.5, format: pct },
  { key: 'roadWidth', label: 'Road width', info: 'Width of a secondary road in world units; primaries are 1.6× wider. Blocks are inset from the centreline by half the road width plus a 1.2-unit setback, so wider roads mean smaller blocks — and, on a dense network, blocks too narrow to survive.', min: 2, max: 10, step: 0.5, value: 5, format: (v) => `${v.toFixed(1)} u` },
  { key: 'irregularity', label: 'Irregularity', info: 'For a grid: noise on the angle and length of every segment, and some branches left out. For organic and layered roads: how far the road wanders — the turn read from a noise field where the road is, so neighbouring streets bend alike.', min: 0, max: 1, step: 0.05, value: 0.3, format: pct },
  { key: 'plotSize', label: 'Plot size', info: 'Target side of a plot in world units. Irregular subdivision stops cutting once a piece is under 1.4× this squared; the grid lays lots this wide and 1.4× as deep.', min: 8, max: 30, step: 1, value: 14, format: u },
  { key: 'plotIrregularity', label: 'Cut irregularity', info: 'Irregular mode only. How far each cut strays from the middle of its piece (up to a quarter of its length) and how far it tilts (up to 17°). At 0, recursive bisection makes near-equal strips.', min: 0, max: 1, step: 0.05, value: 0.4, format: pct },
  { key: 'noiseScale', label: 'Noise scale', info: 'Wavelength of the noise in the maps, in world units. Small: districts break up into a patchwork. Large: a few broad swells across the site.', min: 20, max: 240, step: 5, value: 90, format: u },
  { key: 'noiseIntensity', label: 'Noise intensity', info: 'How much of each map is noise. At 0, density is distance and slope alone, and vegetation is water and density alone; the maps are smooth and the city is concentric.', min: 0, max: 1, step: 0.05, value: 0.35, format: pct },
  { key: 'reach', label: 'Centre reach', info: 'Distance over which density falls from 1 at the city centre to 0. A small reach is a compact town in open country; a large one fills the site.', min: 60, max: 280, step: 10, value: 170, format: u },
  { key: 'buildThreshold', label: 'Build threshold', info: 'Density a plot must reach to be built on. This is the line where the continuous map becomes a yes or a no.', min: 0.05, max: 0.9, step: 0.01, value: 0.2, format: f2 },
  { key: 'greenThreshold', label: 'Green threshold', info: 'Vegetation an unbuilt plot needs to become a park. Below it, a plot is a garden if the ground is moist and open space if not.', min: 0.1, max: 0.9, step: 0.01, value: 0.42, format: f2 },
  { key: 'blend', label: 'Soft band', info: 'Half-width of the band around the build threshold where the decision is a dice roll. 0 is a hard threshold — a crisp district edge along one contour of the map. Wider, and the probability of building rises smoothly through the band, so the edge frays.', min: 0, max: 0.3, step: 0.01, value: 0.08, format: (v) => (v === 0 ? 'hard' : `±${v.toFixed(2)}`) },
  { key: 'maxFloors', label: 'Max floors', info: 'Floors at density 1. Floors rise with density above the threshold as a power of 1.6, so most of the city stays low and the height gathers in a peak. 3–6 floors is an apartment block, 7 or more a tower, 1–2 a house with a pitched roof.', min: 2, max: 24, step: 1, value: 14, format: (v) => v.toFixed(0) },
  { key: 'width', label: 'Width', info: 'Across the front, in world units (about a metre each).', min: 4, max: 30, step: 0.5, value: 14, format: (v) => `${v.toFixed(1)} u` },
  { key: 'depth', label: 'Depth', info: 'Front to back. A pitched roof\'s ridge runs along whichever side is longer.', min: 4, max: 24, step: 0.5, value: 10, format: (v) => `${v.toFixed(1)} u` },
  { key: 'floors', label: 'Floors', info: 'Three units each. Floors above the first get balconies; the ground floor gets a door.', min: 1, max: 24, step: 1, value: 5, format: (v) => v.toFixed(0) },
  { key: 'roofSlope', label: 'Roof slope', info: 'Pitch of a gable roof in degrees. Also used for every house in Experiment E.', min: 10, max: 55, step: 1, value: 32, format: (v) => `${v.toFixed(0)}°` },
  { key: 'balconyChance', label: 'Balcony probability', info: 'Chance that a bay — a column of windows — on the front or back gets balconies, one on every floor above the ground, stacked as real buildings stack them. Facade variation knocks some out of their stacks. Used in Experiment E too, halved for towers.', min: 0, max: 1, step: 0.05, value: 0.35, format: pct },
  { key: 'facadeVariation', label: 'Facade variation', info: 'At 0 a building is perfectly regular. Raising it widens the bays, varies the window size, leaves some bays blank, may add floor bands and set the top floor back, widens the colour range and knocks some balconies out of their stacks — each by a seeded roll.', min: 0, max: 1, step: 0.05, value: 0.5, format: pct },
  { key: 'population', label: 'Population', info: 'Inhabitants, each with a home drawn by residential capacity and a job drawn by job capacity. Changed while running, newcomers start at home and the newest leave first. In H, supply at 100% is sized for 300 — more than that asks for more than the plants make.', min: 10, max: 800, step: 10, value: 300, format: (v) => v.toFixed(0) },
  { key: 'walkSpeed', label: 'Movement speed', info: 'World units per simulated minute; each inhabitant walks at 0.85–1.15× this. Slow on purpose: at a true walking pace of about 80 the average trip takes under three simulated minutes and the streets are nearly empty to watch.', min: 5, max: 150, step: 5, value: 15, format: (v) => `${v.toFixed(0)} u/min` },
  { key: 'simSpeed', label: 'Simulation speed', info: 'Simulated minutes per real second. The step is always one minute; a faster speed runs more steps per frame, never longer ones, so a run is the same at any speed.', min: 1, max: 120, step: 1, value: 8, format: (v) => `${v.toFixed(0)} min/s` },
  { key: 'supply', label: 'Resource supply', info: 'Each plant\'s output per minute, as a share of the reference demand: in G the peak of the daily demand curve, in H 300 people indoors plus every building\'s standing load.', min: 0.2, max: 2, step: 0.05, value: 1, format: pct },
  { key: 'demand', label: 'Resource demand', info: 'A multiplier on what every building asks for.', min: 0.2, max: 2, step: 0.05, value: 1, format: pct },
  { key: 'capacity', label: 'Network capacity', info: 'Pipe size. At 100% a lane\'s pipe carries the whole reference demand and a primary\'s 1.6× that; pipes on wide roads are wider. Lower it and the pipes, not the plant, become the limit.', min: 0.05, max: 2, step: 0.05, value: 1, format: pct },
]

/** The layers each experiment shows on arrival; the toggles can change them afterwards. */
export const DEFAULT_LAYERS: Record<ExperimentId, CitySettings['show']> = {
  roads: { roads: true, plots: false, zoning: false, buildings: false, vegetation: false, agents: false, network: false },
  plots: { roads: true, plots: true, zoning: false, buildings: false, vegetation: false, agents: false, network: false },
  zoning: { roads: true, plots: true, zoning: true, buildings: false, vegetation: false, agents: false, network: false },
  building: { roads: false, plots: false, zoning: false, buildings: true, vegetation: false, agents: false, network: false },
  site: { roads: true, plots: false, zoning: false, buildings: true, vegetation: true, agents: false, network: false },
  agents: { roads: true, plots: false, zoning: false, buildings: true, vegetation: true, agents: true, network: false },
  resources: { roads: true, plots: false, zoning: false, buildings: true, vegetation: false, agents: false, network: true },
  dynamics: { roads: true, plots: false, zoning: false, buildings: true, vegetation: false, agents: true, network: true },
}

export function defaultCitySettings(): CitySettings {
  const numbers = Object.fromEntries(CITY_SPECS.map((s) => [s.key, s.value])) as Pick<CitySettings, CitySpec['key']>
  return {
    ...numbers,
    experiment: 'roads',
    seed: 1,
    strategy: 'layered',
    plotMode: 'irregular',
    map: 'density',
    roof: 'flat',
    resource: 'energy',
    policy: 'nearest',
    show: { ...DEFAULT_LAYERS.roads },
  }
}

function parse(raw: unknown): { settings: CitySettings; repairs: string[] } {
  const d = defaultCitySettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const numbers = Object.fromEntries(CITY_SPECS.map((s) => [s.key, num(raw[s.key], s.min, s.max, s.value)])) as Pick<CitySettings, CitySpec['key']>
  const show = isRecord(raw.show) ? raw.show : {}
  const experiment = pick(raw.experiment, EXPERIMENTS, d.experiment)
  const layers = DEFAULT_LAYERS[experiment]
  return {
    settings: {
      ...numbers,
      experiment,
      seed: int(raw.seed, 1, 999, d.seed),
      strategy: pick(raw.strategy, ['grid', 'organic', 'layered'] as const, d.strategy),
      plotMode: pick(raw.plotMode, ['grid', 'irregular'] as const, d.plotMode),
      map: pick(raw.map, FIELD_NAMES, d.map),
      roof: pick(raw.roof, ['flat', 'pitched'] as const, d.roof),
      resource: pick(raw.resource, RESOURCES, d.resource),
      policy: pick(raw.policy, ['nearest', 'shared'] as const, d.policy),
      show: {
        roads: bool(show.roads, layers.roads),
        plots: bool(show.plots, layers.plots),
        zoning: bool(show.zoning, layers.zoning),
        buildings: bool(show.buildings, layers.buildings),
        vegetation: bool(show.vegetation, layers.vegetation),
        agents: bool(show.agents, layers.agents),
        network: bool(show.network, layers.network),
      },
    },
    repairs: [],
  }
}

const STRATEGY_LABEL: Record<RoadStrategy, string> = { grid: 'Grid', organic: 'Organic', layered: 'Layered' }

export const citySpec: ConfigSpec<CitySettings> = {
  topic: 'city',
  schemaVersion: 1,
  defaults: defaultCitySettings,
  parse,
  summary: (s) => `${STRATEGY_LABEL[s.strategy]} roads · ${s.plotMode} plots · ${s.maxFloors} floors max · ${s.population} people · seed ${s.seed}`,
}
