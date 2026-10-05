import { defaultNoiseSettings, fbmStack, type NoiseSettings, type StoredLayer } from '../config/noiseConfig'
import { defaultObjectSettings, type ObjectSettings } from '../config/objectConfig'
import { defaultShaderSettings, type ShaderSettings } from '../config/shaderConfig'
import { defaultSettings as defaultVoxelSettings, type StoredNode, type VoxelSettings } from '../config/voxelConfig'
import { defaultParamsFor, getShapingOp, type ShapingName } from '../noise'
import type { TopicId } from '../config/spec'

/**
 * A gallery of what the four topics can do, as saved worlds.
 *
 * ## What a showcase world is
 *
 * There is no cross-topic world object in this app, and this file does not
 * invent one. Each topic owns its own `ConfigSpec` and its own document under
 * `users/{uid}/configs/{configId}`, and the library panel on a topic lists only
 * that topic's documents. So a showcase world is four documents that happen to
 * share a name — exactly what you would get by saving the same name on each of
 * the four pages by hand. Seeding writes them through `saveConfiguration`, the
 * same function the Save button calls.
 *
 * ## Every world is built from the topic's own defaults
 *
 * Each entry spreads `defaults()` and overrides from there, rather than writing
 * a settings object out in full. Two reasons: a field added to a schema later
 * cannot silently go missing from a preset, and every value a preset does not
 * name is one the topic already considers valid. What is overridden is then
 * checked against each spec's own `parse` before anything is written — a preset
 * that needed repairing would be a preset making a claim the renderer does not
 * support, which is the one thing these must not do.
 *
 * ## What is deliberately not here
 *
 * Objects is a single-primitive viewer: five shapes and one material, with no
 * placement system. Vegetation that follows a river, structures on flat ground,
 * scatter density — none of that exists to be preset, so none of these worlds
 * pretends otherwise. What the Objects document in each world carries is the
 * material that belongs to it, which is the part of that topic a preset can
 * honestly demonstrate.
 *
 * There is also no emissive channel on the material, so a lava glow is a colour
 * ramp in Shaders rather than a lit object in Objects.
 */

export type ShowcaseWorld = {
  id: string
  /** Becomes the document name on all four topics. Under Firestore's 120. */
  name: string
  blurb: string
  /** What to look at on each topic once the world is loaded. */
  showcases: Record<TopicId, string>
  objects: ObjectSettings
  maps: NoiseSettings
  voxels: VoxelSettings
  shaders: ShaderSettings
}

/* ---------------------------------------------------------------------------
 * Builders
 *
 * Thin on purpose: their whole job is to start from the topic's defaults so a
 * preset only has to say what it changes.
 * ------------------------------------------------------------------------- */

const objects = (over: Partial<ObjectSettings>): ObjectSettings => ({
  ...defaultObjectSettings(),
  ...over,
})

const maps = (over: Partial<NoiseSettings>): NoiseSettings => ({
  ...defaultNoiseSettings(),
  ...over,
})

const voxels = (over: Partial<VoxelSettings>): VoxelSettings => ({
  ...defaultVoxelSettings(),
  ...over,
})

/**
 * Only the named simulation is tuned; the rest keep their defaults.
 *
 * `parse` rebuilds every simulation's parameter bag from that simulation's own
 * definitions, so an override here has to be merged onto the defaults rather
 * than replacing the map — otherwise switching Study in the sidebar would land
 * on an empty bag.
 */
function shaders(
  simulationId: string,
  params: Record<string, number>,
  presetName?: string,
  running = false,
): ShaderSettings {
  const base = defaultShaderSettings()
  return {
    simulationId,
    allParams: { ...base.allParams, [simulationId]: { ...base.allParams[simulationId], ...params } },
    presetName: presetName ? { ...base.presetName, [simulationId]: presetName } : base.presetName,
    running,
  }
}

/**
 * A shaping op's full parameter set, with only the named ones overridden.
 *
 * Writing `{}` and letting `parse` fill the gaps would store a valid document —
 * `parseParams` substitutes an op's own defaults without recording a repair —
 * but the preset would no longer say what it means, and anything reading these
 * objects outside the parser would hand `undefined` to the shaping function and
 * get a field of NaN. A preset should be complete on its own terms.
 */
function shaping(name: ShapingName, over: Record<string, number> = {}): Record<string, number> {
  return { ...defaultParamsFor(getShapingOp(name)), ...over }
}

/** An fBm stack with one shaping op applied to every octave. */
function shapedStack(
  octaves: number,
  persistence: number,
  resolution: number,
  shapingName: ShapingName,
  over: Record<string, number> = {},
): StoredLayer[] {
  return fbmStack(octaves, persistence, resolution).map((layer) => ({
    ...layer,
    shapingName,
    shapingParams: shaping(shapingName, over),
  }))
}

/** A CSG node. Omitted parameters fall back to that shape's own defaults. */
function node(
  shape: StoredNode['shape'],
  params: Record<string, number>,
  over: Partial<Omit<StoredNode, 'shape' | 'params'>> = {},
): StoredNode {
  return {
    shape,
    params,
    op: 'union',
    blend: 0,
    offset: { x: 0, y: 0, z: 0 },
    seed: 1,
    enabled: true,
    ...over,
  }
}

/** Ramp indices, as `RAMPS` in gpu/style.ts orders them. */
const RAMP = {
  slateTerrain: 0,
  slateChalk: 1,
  slateEmber: 2,
  land: 3,
  terrain: 4,
  viridis: 5,
  magma: 6,
  grey: 7,
} as const

/** Strategy indices, as `STRATEGIES` in gpu/shading.ts orders them. */
const STRATEGY = {
  matte: 0,
  height: 1,
  slope: 2,
  noise: 3,
  fresnel: 4,
  combined: 5,
} as const

/* ---------------------------------------------------------------------------
 * The worlds
 *
 * Each leads with a different mechanism rather than a different hue. A gallery
 * where five entries differ only by palette demonstrates the palette control
 * and nothing else.
 * ------------------------------------------------------------------------- */

export const SHOWCASE_WORLDS: ShowcaseWorld[] = [
  {
    id: 'volcanic',
    name: 'Volcanic Inferno',
    blurb:
      'Ridged noise and thermal collapse. The ridge shaping op folds every octave at its midpoint so peaks become creases rather than domes, and 40 passes of slope failure fan the debris out below them.',
    showcases: {
      maps: 'Shaping ops — every octave runs through ridge, which is what makes the crests sharp rather than rounded. Thermal collapse at 40 passes does the rest.',
      voxels: 'The terrain primitive with a gyroid subtracted from it: lava tubes through a solid, meshed with marching cubes.',
      shaders: 'The ember ramp under a low raking light with heavy haze. There is no emissive channel here — the glow is the ramp, not a light.',
      objects: 'A basalt material: fully rough, no metal. Objects is a single-primitive viewer, so the material is what it has to show.',
    },
    objects: objects({
      shape: 'icosahedron',
      color: '#3a2420',
      metalness: 0.05,
      roughness: 0.95,
      scale: 1.3,
      spinSpeed: 0,
    }),
    maps: maps({
      mode: 'surface',
      resolution: 160,
      heightScale: 2.2,
      relief: 0.42,
      paletteName: 'magma',
      fitRamp: true,
      octaves: 7,
      persistence: 0.58,
      layers: shapedStack(7, 0.58, 160, 'ridge', { sharpness: 3.2 }),
      presetName: 'badlands',
      density: 0.9,
      thermalPasses: 40,
      talus: 0.035,
      talusStrength: 0.7,
      warpAmount: 0.18,
      warpFrequency: 3,
      outputShapingName: 'gain',
      outputParams: shaping('gain', { k: 2.1 }),
    }),
    voxels: voxels({
      sceneName: 'caves',
      mode: 'marching',
      resolution: 72,
      palette: 'magma',
      showBounds: false,
      iso: -0.02,
      nodes: [
        node('terrain', { amplitude: 0.85, level: -0.1, frequency: 3.2, octaves: 5 }),
        node('gyroid', { scale: 7.5, thickness: 0.55 }, { op: 'subtract' }),
      ],
    }),
    shaders: shaders('shading', {
      strategy: STRATEGY.combined,
      ramp: RAMP.slateEmber,
      azimuth: 24,
      elevation: 12,
      relief: 0.62,
      haze: 0.62,
      fresnel: 0.44,
      noiseScale: 5.6,
      noiseAmount: 0.38,
      spin: 0,
    }),
  },

  {
    id: 'frozen',
    name: 'Frozen Archipelago',
    blurb:
      'Threshold shaping cuts the field into islands rather than shading it smoothly, and terrace quantises what is left into ice shelves. The bergs are four blended primitives, meshed by the one algorithm that can keep a corner.',
    showcases: {
      maps: 'Two shaping ops doing different jobs: threshold fragments the continent into islands, terrace steps the survivors into shelves.',
      voxels: 'Smooth-blended CSG — four primitives welded with a blend radius, then dual contouring, the only mesher here that reconstructs a sharp edge.',
      shaders: 'The Fresnel strategy on its own, which is the closest this study gets to translucency. Chalk ramp, high cold key light.',
      objects: 'Low roughness and high metalness — the one material setting that reads as ice rather than stone.',
    },
    objects: objects({
      shape: 'icosahedron',
      color: '#b9d4e4',
      metalness: 0.82,
      roughness: 0.12,
      scale: 1.15,
      wireframe: false,
    }),
    maps: maps({
      mode: 'surface',
      resolution: 144,
      heightScale: 1.9,
      relief: 0.3,
      paletteName: 'terrain',
      fitRamp: false,
      bands: 9,
      octaves: 4,
      persistence: 0.44,
      layers: shapedStack(4, 0.44, 144, 'threshold', { cutoff: 0.44 }),
      presetName: 'floodplain',
      density: 0.24,
      thermalPasses: 4,
      talus: 0.06,
      talusStrength: 0.35,
      warpAmount: 0.42,
      warpFrequency: 2.5,
      outputShapingName: 'terrace',
      outputParams: shaping('terrace', { steps: 7 }),
    }),
    voxels: voxels({
      sceneName: 'blend',
      mode: 'dual',
      resolution: 80,
      palette: 'grey',
      showBounds: false,
      spin: 0,
      nodes: [
        node('box', { size: 0.72, round: 0.02 }, { offset: { x: -0.2, y: -0.35, z: 0.1 } }),
        node('box', { size: 0.44, round: 0.01 }, { offset: { x: 0.45, y: 0.1, z: -0.3 }, blend: 0.12 }),
        node('sphere', { radius: 0.5 }, { offset: { x: 0.1, y: 0.5, z: 0.35 }, blend: 0.18 }),
        node('cylinder', { radius: 0.22, height: 0.9 }, { op: 'subtract', offset: { x: -0.35, y: 0.3, z: -0.2 }, blend: 0.08 }),
      ],
    }),
    shaders: shaders('shading', {
      strategy: STRATEGY.fresnel,
      ramp: RAMP.slateChalk,
      azimuth: 212,
      elevation: 66,
      relief: 0.36,
      haze: 0.52,
      fresnel: 0.78,
      noiseScale: 2.2,
      noiseAmount: 0.1,
      spin: 0,
    }),
  },

  {
    id: 'valley',
    name: 'Verdant River Valley',
    blurb:
      'The one world where the landform is cut rather than shaped. 2.4 droplets per cell under the river-valley preset carve dendritic channels that no amount of noise tuning produces on its own.',
    showcases: {
      maps: 'Droplet hydraulic erosion as the subject. Rain is well past the 0.3/cell where channel concentration peaks, because here the connected network matters more than the sharpest possible cut.',
      voxels: 'Intersection rather than subtraction — the terrain primitive clipped by a half-space, which is what gives the valley a floor.',
      shaders: 'High soft light and almost no relief, so the palette carries the image rather than the shading. The overcast end of the study.',
      objects: 'Matte and unlit-looking: no metal, high roughness. There is no scatter system, so this is one material, not vegetation.',
    },
    objects: objects({
      shape: 'sphere',
      color: '#6f8f63',
      metalness: 0,
      roughness: 0.88,
      scale: 1.1,
      spinSpeed: 6,
    }),
    maps: maps({
      mode: 'surface',
      resolution: 192,
      heightScale: 1.25,
      relief: 0.2,
      paletteName: 'land',
      fitRamp: true,
      octaves: 6,
      persistence: 0.5,
      presetName: 'valleys',
      density: 2.4,
      erosionSeed: 7,
      warpAmount: 0.35,
      warpFrequency: 2,
      thermalPasses: 8,
      talus: 0.025,
      talusStrength: 0.45,
      // A gentle lift rather than the op's default 0.35/0.65, which would clip
      // the channels erosion just cut.
      outputShapingName: 'smoothstep',
      outputParams: shaping('smoothstep', { edge0: 0.08, edge1: 0.96 }),
    }),
    voxels: voxels({
      sceneName: 'slice',
      mode: 'surface',
      resolution: 88,
      palette: 'land',
      showBounds: false,
      nodes: [
        node('terrain', { amplitude: 0.42, level: -0.3, frequency: 1.8, octaves: 4 }),
        node('plane', { height: 0.35 }, { op: 'intersect', blend: 0.06 }),
      ],
    }),
    shaders: shaders(
      'shading',
      {
        strategy: STRATEGY.combined,
        ramp: RAMP.land,
        azimuth: 90,
        elevation: 74,
        relief: 0.34,
        haze: 0.3,
        fresnel: 0.22,
        noiseScale: 3.4,
        noiseAmount: 0.18,
        spin: 0,
      },
      'overcast',
    ),
  },

  {
    id: 'crystal',
    name: 'Crystal Bloom',
    blurb:
      'Faceted rather than smooth, everywhere. Terrace shaping and nine colour bands quantise the terrain; greedy blocks refuse to interpolate the solid at all; and the shader page runs Gray–Scott instead of a lighting model.',
    showcases: {
      voxels: 'A gyroid clipped to a sphere, meshed as blocks with greedy merging on — the mesher that keeps voxels visible instead of hiding them.',
      maps: 'Banding as a display choice: the ramp is quantised to nine steps while the geometry keeps full precision, so the terraces are colour, not shape.',
      shaders: 'Not a shading study at all — the reaction–diffusion simulation, which is the other half of this topic. Two chemicals and four constants.',
      objects: 'Wireframe on an icosahedron: the one setting that shows a primitive as structure rather than as a surface.',
    },
    objects: objects({
      shape: 'icosahedron',
      color: '#8fd8c8',
      metalness: 0.9,
      roughness: 0.2,
      scale: 1.4,
      wireframe: true,
      spinSpeed: 14,
    }),
    maps: maps({
      mode: 'surface',
      resolution: 128,
      heightScale: 1.6,
      relief: 0.5,
      paletteName: 'viridis',
      fitRamp: true,
      bands: 9,
      octaves: 5,
      persistence: 0.62,
      layers: shapedStack(5, 0.62, 128, 'billow'),
      presetName: 'gorges',
      density: 0.2,
      warpAmount: 0.6,
      warpFrequency: 5,
      outputShapingName: 'terrace',
      outputParams: shaping('terrace', { steps: 9 }),
    }),
    voxels: voxels({
      sceneName: 'gyroid',
      mode: 'blocks',
      greedy: true,
      resolution: 88,
      palette: 'viridis',
      showBounds: true,
      iso: 0.04,
      nodes: [
        node('gyroid', { scale: 8.5, thickness: 0.3 }),
        node('sphere', { radius: 0.95 }, { op: 'intersect' }),
      ],
    }),
    shaders: shaders('reaction-diffusion', { palette: RAMP.viridis }, 'coral', true),
  },

  {
    id: 'planet',
    name: 'Cloud Planet',
    blurb:
      'The only world that leaves the flat grid. The same field is wrapped onto a sphere instead of a height field, and the shader page runs a thousand boids instead of a lighting model.',
    showcases: {
      maps: 'Geometry mode as the control. Planet wraps the field onto a sphere, which is the third of the three ways this topic turns a field into geometry.',
      voxels: 'A sliced solid at a raised isolevel, so the cut face shows what the field looks like inside rather than only at its surface.',
      shaders: 'Fish schooling — Reynolds’ three rules, one fish per texel. Every fish reads every other, so the O(N²) wall is a dial you can turn.',
      objects: 'Smooth and metallic at full scale: the material end of the range opposite the volcanic basalt.',
    },
    objects: objects({
      shape: 'sphere',
      color: '#7d9cc9',
      metalness: 1,
      roughness: 0.08,
      scale: 1.6,
      spinSpeed: 18,
    }),
    maps: maps({
      mode: 'planet',
      resolution: 96,
      heightScale: 0.9,
      relief: 0.55,
      paletteName: 'hue',
      tint: '#8fb0dd',
      fitRamp: true,
      octaves: 5,
      persistence: 0.55,
      layers: shapedStack(5, 0.55, 96, 'billow'),
      presetName: 'gorges',
      density: 0.3,
      warpAmount: 0.5,
      warpFrequency: 4,
      spin: 12,
    }),
    voxels: voxels({
      sceneName: 'slice',
      mode: 'blocks',
      greedy: false,
      resolution: 56,
      palette: 'hue',
      showBounds: true,
      iso: 0.12,
      spin: 10,
      nodes: [
        node('sphere', { radius: 0.9 }),
        node('box', { size: 0.6, round: 0.1 }, { op: 'subtract', offset: { x: 0.5, y: 0.5, z: 0.5 } }),
      ],
    }),
    // `count` is an index into [16, 32, 48, 64, 96] texels per side, not a
    // population: 2 is 48² = 2,304 fish and 2,304² = 5.3M neighbour tests per
    // step. Passing a literal 1024 would have clamped to the top of the range,
    // which is the setting that exists to show the wall, not to sit on.
    shaders: shaders('boids', { count: 2 }, 'school', true),
  },
]

/** The settings a world carries for one topic, for the seeder to write. */
export function settingsFor(world: ShowcaseWorld, topic: TopicId): unknown {
  switch (topic) {
    case 'objects':
      return world.objects
    case 'maps':
      return world.maps
    case 'voxels':
      return world.voxels
    case 'shaders':
      return world.shaders
  }
}
