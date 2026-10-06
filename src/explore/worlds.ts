import type { TerrainSpec } from './terrain'

/**
 * Three worlds, one system.
 *
 * Every field below feeds the same chunk builder, the same scatter pass and the
 * same renderer. Nothing here is a scene: there is no hand-placed geometry, no
 * per-world code path, and no branch anywhere downstream on `id`. What makes
 * them different is the numbers, which is the point the presentation is making.
 *
 * Seeds are fixed, so a world is the same on every reload. That matters more
 * than it sounds for a live demo — a spawn point chosen against one terrain is
 * meaningless if the terrain is re-rolled on refresh.
 */

export type ScatterKind = 'rock' | 'pillar' | 'tree' | 'berg' | 'tuft'

/**
 * Where a kind of object is allowed to stand.
 *
 * Bands rather than a flat probability, so placement answers to the terrain:
 * trees stop at the waterline and give up on anything steep, bergs only exist
 * near the water, pillars want altitude. This is what keeps a scatter from
 * reading as confetti.
 */
export type ScatterRule = {
  kind: ScatterKind
  /** Candidate positions tried per chunk. Most are rejected by the bands. */
  attempts: number
  minHeight: number
  maxHeight: number
  /** 1 is vertical ground, 0 is a cliff. Compared against the surface normal's y. */
  minFlatness: number
  scale: [number, number]
  color: string
  /** Lifts the base below the surface so nothing appears to hover on a slope. */
  sink: number
  /**
   * How strongly a low-frequency field gates placement, 0 to 1.
   *
   * At 0 the survivors of the height and slope bands are spread evenly, which
   * is what made the first pass read as confetti — nothing in nature is evenly
   * spread. At 1 a candidate only survives where the field is high, so stands
   * form with open ground between them.
   */
  clump: number
  /** Spatial frequency of that field. Lower is larger, fewer stands. */
  clumpScale: number
  /** Distinct geometries for this kind, so a stand is not one shape repeated. */
  variants: number
  /** Max lean from vertical, radians. Nothing on a hillside grows plumb. */
  tilt: number
  /** Vertical stretch relative to width, as a range. */
  stretch: [number, number]
  /** How far an instance's colour may drift from the rule's, 0 to 1. */
  colorJitter: number
}

export type WorldSpec = {
  id: string
  name: string
  blurb: string
  /** One line naming what to look at, shown while exploring. */
  look: string
  terrain: TerrainSpec
  /** Height stops, low to high, interpolated in OKLab. */
  stops: string[]
  /**
   * What the ramp alone cannot say: what the rock under it looks like, where
   * the water meets it, and that two hillsides at one height are not one
   * colour.
   */
  ground: {
    /** Shown on anything steep enough that soil or ice would not hold. */
    rock: string
    /** How much of it, at the steepest. */
    rockMix: number
    /** Normal-y where rock starts to show, and where it fully has. */
    rockFrom: number
    rockTo: number
    shore: string
    /** Units either side of the waterline the shore colour reaches. */
    shoreBand: number
    tintScale: number
    tintAmount: number
  }
  /** World Y the ramp's two ends map to. */
  colorRange: [number, number]
  /** The top of the sky gradient; the fog colour is its horizon. */
  sky: string
  fog: { color: string; density: number }
  water: { color: string; opacity: number; metalness: number; roughness: number } | null
  sun: { azimuth: number; elevation: number; color: string; intensity: number }
  ambient: { color: string; intensity: number }
  scatter: ScatterRule[]
  /**
   * Eye position is this plus the terrain height, so a spawn is never buried.
   *
   * `lift` raises it further, and is 0 on all three now. It existed because the
   * camera used to fly by default and a lifted start cleared the near ridges —
   * but the default is walking, so a lifted spawn only drops to the ground in
   * the first half second anyway. Kept as a field because a world with
   * genuinely broken ground may want it back.
   */
  spawn: { x: number; z: number; yaw: number; pitch: number; lift: number }
}

export const WORLDS: WorldSpec[] = [
  {
    id: 'volcanic',
    name: 'Volcanic Caldera',
    blurb:
      'Ridged noise under a 120-unit cone, with the crater cut into the summit by the same height function that raises it. Lava sits in the low ground.',
    look: 'The caldera is ahead of you. Walk the rim, or drop toward the lava in the hollows.',
    terrain: {
      seed: 1337,
      frequency: 0.011,
      octaves: 5,
      persistence: 0.5,
      amplitude: 30,
      // Ridges, not dunes: the crease a folded octave leaves is what makes
      // volcanic ground read as broken rock rather than as desert.
      shaping: 'ridge',
      outputShaping: 'none',
      warp: 16,
      detail: 1.1,
      landmark: { kind: 'volcano', x: 0, z: 0, radius: 500, height: 210 },
      // Measured: the ground's 25th percentile is 17, so a waterline at 16
      // puts lava in the lowest quarter of the terrain and nowhere else. At
      // -4 it was below every point in the world and nothing was ever flooded.
      seaLevel: 16,
    },
    stops: ['#14100f', '#241b18', '#352521', '#4a2f26', '#6b3f2b', '#8f5c3a'],
    ground: {
      // Black basalt under everything: on this world the rock is the subject,
      // so it shows earlier and more completely than on the other two.
      rock: '#120d0c',
      rockMix: 0.92,
      // 0.93 counted almost every dune as steep and turned the world black.
      rockFrom: 0.82,
      rockTo: 0.5,
      shore: '#ff8a3c',
      shoreBand: 3.5,
      tintScale: 0.0024,
      tintAmount: 0.36,
    },
    // The cone saturates the top of the ramp and comes out pale against dark
    // ground, which is what a volcano's ash flank does anyway.
    colorRange: [12, 62],
    sky: '#1b1310',
    // Dense enough that the chunk horizon is gone well before the edge of the
    // loaded set, which is what sells the world as continuing.
    fog: { color: '#3a2219', density: 0.0012 },
    water: { color: '#ff5a1e', opacity: 0.95, metalness: 0.1, roughness: 0.35 },
    sun: { azimuth: 302, elevation: 13, color: '#ff8a4a', intensity: 2.4 },
    ambient: { color: '#5a3328', intensity: 0.95 },
    scatter: [
      {
        // Rubble, at the scale the eye checks for when deciding whether ground
        // is real. Nothing here is above knee height.
        kind: 'tuft',
        attempts: 180,
        minHeight: 15,
        maxHeight: 90,
        minFlatness: 0.62,
        scale: [1.1, 2.6],
        color: '#2a1c17',
        sink: 0.3,
        clump: 0.55,
        clumpScale: 0.014,
        variants: 3,
        tilt: 0.9,
        stretch: [0.4, 1],
        colorJitter: 0.35,
      },
      {
        kind: 'pillar',
        attempts: 14,
        minHeight: 18,
        maxHeight: 76,
        minFlatness: 0.55,
        scale: [2.2, 7],
        color: '#19100e',
        sink: 1.5,
        clump: 0.85,
        clumpScale: 0.004,
        variants: 3,
        tilt: 0.1,
        stretch: [0.7, 2.1],
        colorJitter: 0.3,
      },
      {
        kind: 'rock',
        attempts: 46,
        minHeight: 15,
        maxHeight: 86,
        minFlatness: 0.4,
        scale: [0.8, 3.4],
        color: '#241a17',
        sink: 0.4,
        clump: 0.6,
        clumpScale: 0.006,
        variants: 3,
        tilt: 0.55,
        stretch: [0.55, 1.2],
        colorJitter: 0.28,
      },
    ],
    spawn: { x: -590, z: -490, yaw: -2.28, pitch: -0.04, lift: 0 },
  },

  {
    id: 'frozen',
    name: 'Frozen Archipelago',
    blurb:
      'Terraced noise flooded to the waterline, so only the high ground survives as islands. The shelves are the terrace op, not a sculpted cliff.',
    look: 'Islands run out to the horizon. The massif ahead is the highest ground in the world.',
    terrain: {
      seed: 20260108,
      frequency: 0.0095,
      octaves: 5,
      persistence: 0.47,
      amplitude: 38,
      // Terracing is what gives ice its shelves. It quantises height, so the
      // cliffs are a consequence of the op rather than something placed.
      // Plain noise per octave, terraced once at the end: that is what leaves
      // the shelves standing instead of averaging them away.
      shaping: 'none',
      outputShaping: 'terrace',
      warp: 9,
      detail: 0.55,
      landmark: { kind: 'massif', x: 0, z: 0, radius: 520, height: 130 },
      // Measured: the median height is 20.7, so a waterline at 21 drowns about
      // half the ground and what is left is islands. At 7 it was below the 2nd
      // percentile and the world was one continuous landmass.
      seaLevel: 21,
    },
    stops: ['#4a6673', '#64818f', '#879fac', '#abc0c9', '#cfe0e6', '#f2f8fa'],
    ground: {
      // Wet grey stone where the ice cannot hold, which is what makes the
      // terraces read as cliffs rather than as contour lines.
      rock: '#5a6a73',
      rockMix: 0.85,
      rockFrom: 0.97,
      rockTo: 0.72,
      shore: '#dceaf0',
      shoreBand: 2.6,
      tintScale: 0.0018,
      tintAmount: 0.2,
    },
    // Narrow, because half the world is within ten units of the waterline and
    // a wide range spent the whole ramp on ground nobody stands on.
    colorRange: [21, 50],
    sky: '#a4bac6',
    fog: { color: '#9db4c0', density: 0.0024 },
    water: { color: '#4d7489', opacity: 0.82, metalness: 0.35, roughness: 0.12 },
    sun: { azimuth: 198, elevation: 26, color: '#dfeaf2', intensity: 1.7 },
    ambient: { color: '#8aa3b2', intensity: 1.15 },
    scatter: [
      {
        kind: 'tuft',
        attempts: 200,
        minHeight: 22,
        maxHeight: 95,
        minFlatness: 0.68,
        scale: [1, 2.4],
        color: '#b6cbd6',
        sink: 0.3,
        clump: 0.6,
        clumpScale: 0.013,
        variants: 3,
        tilt: 0.8,
        stretch: [0.4, 1],
        colorJitter: 0.22,
      },
      {
        kind: 'berg',
        attempts: 30,
        // Only near the waterline, which is the only place floating ice makes
        // sense and also where it is most visible against the water.
        minHeight: 19,
        maxHeight: 29,
        minFlatness: 0.3,
        scale: [2.5, 9],
        color: '#cfe0e8',
        sink: 2.5,
        clump: 0.7,
        clumpScale: 0.0055,
        variants: 3,
        tilt: 0.3,
        stretch: [0.5, 1.1],
        colorJitter: 0.18,
      },
      {
        kind: 'rock',
        attempts: 34,
        minHeight: 26,
        maxHeight: 95,
        minFlatness: 0.45,
        scale: [1, 3.6],
        color: '#9fb3bd',
        sink: 0.4,
        clump: 0.6,
        clumpScale: 0.006,
        variants: 3,
        tilt: 0.55,
        stretch: [0.55, 1.2],
        colorJitter: 0.28,
      },
    ],
    spawn: { x: 710, z: 290, yaw: 1.19, pitch: -0.04, lift: 0 },
  },

  {
    id: 'verdant',
    name: 'Verdant Valley',
    blurb:
      'Rolling ground with a river trough carved through it, and vegetation that answers to the terrain — trees stop at the waterline and give up on anything steep.',
    look: 'The river runs north to south below you. The trees thin out as the ground steepens.',
    terrain: {
      seed: 77,
      frequency: 0.0085,
      octaves: 6,
      persistence: 0.53,
      amplitude: 27,
      shaping: 'none',
      outputShaping: 'none',
      warp: 12,
      detail: 0.7,
      landmark: { kind: 'valley', x: 0, z: 0, radius: 165, height: 34 },
      // The trough bottoms out near -20, so the river sits at -13 and fills
      // only the valley floor rather than flooding the hills.
      seaLevel: -13,
    },
    stops: ['#30402c', '#45573a', '#5d7246', '#7a8d57', '#9aa578', '#bdbaa0'],
    ground: {
      // Grass holds on all but the steepest ground here, so rock shows late and
      // never fully — which is the difference between a hill and a crag.
      rock: '#6d6a5c',
      rockMix: 0.8,
      rockFrom: 0.95,
      rockTo: 0.66,
      shore: '#8f8f6a',
      shoreBand: 2.2,
      tintScale: 0.0016,
      tintAmount: 0.4,
    },
    colorRange: [2, 21],
    sky: '#c6d2b8',
    fog: { color: '#bac6ae', density: 0.0017 },
    water: { color: '#49684f', opacity: 0.78, metalness: 0.2, roughness: 0.2 },
    sun: { azimuth: 118, elevation: 34, color: '#ffeccd', intensity: 1.8 },
    ambient: { color: '#9cae8a', intensity: 1.05 },
    scatter: [
      {
        // The third scale. Landmarks are hundreds of units, trees and boulders
        // are tens, and nothing at all occupied the metre or two in front of
        // you — which is where a viewer spends most of a demo looking.
        kind: 'tuft',
        attempts: 240,
        minHeight: -11,
        maxHeight: 24,
        minFlatness: 0.7,
        scale: [1.5, 3.2],
        color: '#4e6b3c',
        sink: 0.25,
        clump: 0.75,
        clumpScale: 0.012,
        variants: 3,
        tilt: 0.35,
        stretch: [0.6, 1.5],
        colorJitter: 0.4,
      },
      {
        kind: 'tree',
        // The densest scatter of the three, and the one most constrained: above
        // the water, below the ridgelines, and off anything steep. Those three
        // bands are what make a wooded valley rather than a dusting of cones.
        attempts: 150,
        minHeight: -11,
        maxHeight: 22,
        minFlatness: 0.82,
        scale: [1.6, 4.2],
        color: '#3f5a36',
        sink: 0.6,
        clump: 0.92,
        clumpScale: 0.0035,
        variants: 3,
        tilt: 0.09,
        stretch: [0.75, 1.65],
        colorJitter: 0.34,
      },
      {
        kind: 'rock',
        attempts: 30,
        minHeight: -14,
        maxHeight: 30,
        minFlatness: 0.5,
        scale: [0.6, 2],
        color: '#6a6d5c',
        sink: 0.35,
        clump: 0.6,
        clumpScale: 0.006,
        variants: 3,
        tilt: 0.55,
        stretch: [0.55, 1.2],
        colorJitter: 0.28,
      },
    ],
    spawn: { x: 10, z: 670, yaw: -0.07, pitch: -0.07, lift: 0 },
  },
]

export const getWorld = (id: string): WorldSpec => WORLDS.find((w) => w.id === id) ?? WORLDS[0]
