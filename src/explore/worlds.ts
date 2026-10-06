import { band, ramp, type Band } from './environment'
import type { RiverSpec } from './river'
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
  /** How far the two lateral axes may differ from each other, 0 to 1. */
  squash: number
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
  /** A downhill river traced through the terrain, carved into it. */
  river: RiverSpec | null
  /** Height stops, low to high, interpolated in OKLab. */
  stops: string[]
  /**
   * The surface, as a list of materials rather than one ramp.
   *
   * Each band says what it looks like and how much of it there is at a site;
   * the renderer blends them. Written against the derived environment, so a
   * band and the scatter rule beside it are reading the same slope and the
   * same distance to water.
   */
  bands: Band[]
  /** Kept for the overview mesh and the card swatch, which want a simple ramp. */
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
  /** Hemisphere fill. Too little and back slopes go black; too much and the
   *  modelling disappears, which reads as washed out. */
  fill: number
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
      ridges: { amount: 13, frequency: 0.004 },
      tilt: null,
      landmark: { kind: 'volcano', x: 0, z: 0, radius: 500, height: 210 },
      // Seven flows out of the crater. The waterline then only reaches what
      // they cut, plus the crater itself and the deepest hollows — rather than
      // the lowest quarter of the whole plain.
      channels: { x: 0, z: 0, count: 7, depth: 26, reach: 900, width: 0.3 },
      // Low enough that only the channels, the crater and the deepest hollows
      // hold lava. The earlier 16 flooded the lowest quarter of the plain,
      // which is what produced the scattered patches.
      seaLevel: 7,
    },
    river: null,
    stops: ['#14100f', '#241b18', '#352521', '#4a2f26', '#6b3f2b', '#8f5c3a'],
    /*
     * Volcanic ground, from the lava up.
     *
     * The old version blended one dark ramp toward basalt on slope, which gave
     * a world that was essentially two colours. These are the six surfaces a
     * volcanic field actually has, and which one you are standing on is decided
     * by depth, slope and altitude rather than by height alone.
     */
    bands: [
      {
        name: 'lava',
        color: '#ff4a0a',
        // Only in the channels and the crater, which the height function
        // carves — not simply "anything low", which is what covered the plain
        // in red patches.
        mask: (s) => ramp(s.depth, -0.4, 1.4),
      },
      {
        name: 'scorched',
        color: '#8a2d12',
        // The margin of a flow, where rock has been cooked but not covered.
        mask: (s) => s.shore * 1.4 * (1 - ramp(s.depth, 0, 1)),
      },
      {
        name: 'ash',
        color: '#9a8f82',
        // Settles on the flat and high, and is washed off anything steep.
        mask: (s) => ramp(s.altitude, 0.3, 0.6) * (1 - ramp(s.slope, 0.12, 0.34)),
      },
      {
        name: 'basalt',
        color: '#1a1413',
        // Bare rock wherever the slope will not hold anything.
        mask: (s) => ramp(s.slope, 0.08, 0.28) * (1 - ramp(s.depth, 0, 1)),
      },
      {
        // Charcoal and soil split the low ground between them on the patch
        // field rather than both spanning the same altitude. Two bands that
        // overlap everywhere do not read as two materials — they average into
        // one, which is how six colours came back as a single rust.
        name: 'charcoal',
        color: '#2e2522',
        mask: (s) => ramp(s.patch, 0.52, 0.3) * (1 - ramp(s.altitude, 0.34, 0.6)) * 1.3,
      },
      {
        name: 'volcanic soil',
        color: '#6d4328',
        mask: (s) => ramp(s.patch, 0.46, 0.68) * (1 - ramp(s.altitude, 0.34, 0.6)) * 1.3,
      },
    ],
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
    colorRange: [0, 96],
    sky: '#1b1310',
    // Dense enough that the chunk horizon is gone well before the edge of the
    // loaded set, which is what sells the world as continuing.
    fog: { color: '#43281c', density: 0.0009 },
    water: { color: '#ff5a1e', opacity: 0.95, metalness: 0.1, roughness: 0.35 },
    sun: { azimuth: 302, elevation: 15, color: '#ffc49a', intensity: 2.1 },
    fill: 0.5,
    ambient: { color: '#6b4034', intensity: 0.9 },
    scatter: [
      {
        // Rubble, at the scale the eye checks for when deciding whether ground
        // is real. Nothing here is above knee height.
        kind: 'tuft',
        attempts: 180,
        minHeight: 15,
        maxHeight: 90,
        minFlatness: 0.62,
        scale: [0.9, 2.2],
        color: '#2a1c17',
        sink: 0.3,
        clump: 0.55,
        clumpScale: 0.014,
        variants: 3,
        tilt: 0.9,
        stretch: [0.55, 1.1],
        squash: 0.3,
        colorJitter: 0.35,
      },
      {
        kind: 'pillar',
        attempts: 14,
        minHeight: 18,
        maxHeight: 76,
        minFlatness: 0.55,
        scale: [7, 20],
        color: '#19100e',
        sink: 1.5,
        clump: 0.85,
        clumpScale: 0.004,
        variants: 3,
        tilt: 0.1,
        stretch: [0.8, 1.35],
        squash: 0.3,
        colorJitter: 0.3,
      },
      {
        kind: 'rock',
        attempts: 46,
        minHeight: 15,
        maxHeight: 86,
        minFlatness: 0.4,
        scale: [1.4, 4.2],
        color: '#241a17',
        sink: 0.4,
        clump: 0.6,
        clumpScale: 0.006,
        variants: 3,
        tilt: 0.55,
        stretch: [0.6, 1.15],
        squash: 0.3,
        colorJitter: 0.28,
      },
    ],
    // Composed first, then nudged clear of the nearest grove: searching the
    // whole world for a clearing threw the view away.
    spawn: { x: 110, z: -540, yaw: 2.94, pitch: -0.05, lift: 0 },
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
      ridges: { amount: 9, frequency: 0.0055 },
      tilt: null,
      landmark: { kind: 'massif', x: 0, z: 0, radius: 520, height: 130 },
      channels: null,
      // Measured: the median height is 20.7, so a waterline at 21 drowns about
      // half the ground and what is left is islands. At 7 it was below the 2nd
      // percentile and the world was one continuous landmass.
      seaLevel: 21,
    },
    river: null,
    stops: ['#4a6673', '#64818f', '#879fac', '#abc0c9', '#cfe0e6', '#f2f8fa'],
    /*
     * Ice, rock and snow, decided by how deep the water is, how steep the
     * ground is and how high it stands — which is what makes the islands read
     * as landforms rather than as grey shapes in grey water.
     */
    bands: [
      {
        name: 'deep ocean',
        color: '#16303f',
        mask: (s) => ramp(s.depth, 4, 13),
      },
      {
        name: 'shallows',
        color: '#4e8296',
        mask: (s) => band(s.depth, 0.2, 5, 2.4),
      },
      {
        name: 'coastal ice',
        color: '#9ec2d2',
        // The first thing above the waterline, and the band the shoreline
        // marker reinforces.
        mask: (s) => (s.depth > 0 ? 0 : s.shore * 1.5 + band(s.altitude, 0, 0.18, 0.1)),
      },
      {
        name: 'exposed rock',
        color: '#4a545c',
        // Steep island flanks. Ice does not cling to a cliff.
        mask: (s) => ramp(s.slope, 0.09, 0.3) * (s.depth > 0 ? 0 : 1),
      },
      {
        name: 'blue ice',
        color: '#a9c6d4',
        mask: (s) => band(s.altitude, 0.1, 0.46, 0.16) * (1 - ramp(s.slope, 0.08, 0.26)) * (0.55 + s.grain * 0.8),
      },
      {
        name: 'snow',
        color: '#dfeaf0',
        mask: (s) => band(s.altitude, 0.38, 0.78, 0.18) * (1 - ramp(s.slope, 0.12, 0.34)) * (0.6 + s.patch * 0.7),
      },
      {
        name: 'summit snow',
        color: '#fbfdfe',
        // Accumulates where it is high and flat, which is why the peaks go
        // white and their flanks do not.
        mask: (s) => ramp(s.altitude, 0.66, 0.95) * (1 - ramp(s.slope, 0.16, 0.42)),
      },
    ],
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
    colorRange: [20, 78],
    sky: '#a4bac6',
    fog: { color: '#a6bdc8', density: 0.0013 },
    water: { color: '#3c6a86', opacity: 0.78, metalness: 0.45, roughness: 0.1 },
    sun: { azimuth: 198, elevation: 26, color: '#dfeaf2', intensity: 1.8 },
    fill: 0.85,
    ambient: { color: '#8aa3b2', intensity: 1.15 },
    scatter: [
      {
        kind: 'tuft',
        attempts: 200,
        minHeight: 22,
        maxHeight: 95,
        minFlatness: 0.68,
        scale: [0.9, 2.2],
        color: '#b6cbd6',
        sink: 0.3,
        clump: 0.6,
        clumpScale: 0.013,
        variants: 3,
        tilt: 0.8,
        stretch: [0.55, 1.1],
        squash: 0.3,
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
        scale: [5, 16],
        color: '#cfe0e8',
        sink: 2.5,
        clump: 0.7,
        clumpScale: 0.0055,
        variants: 3,
        tilt: 0.3,
        stretch: [0.6, 1.1],
        squash: 0.3,
        colorJitter: 0.18,
      },
      {
        kind: 'rock',
        attempts: 34,
        minHeight: 26,
        maxHeight: 95,
        minFlatness: 0.45,
        scale: [1.2, 3.6],
        color: '#9fb3bd',
        sink: 0.4,
        clump: 0.6,
        clumpScale: 0.006,
        variants: 3,
        tilt: 0.55,
        stretch: [0.6, 1.15],
        squash: 0.3,
        colorJitter: 0.28,
      },
    ],
    spawn: { x: 720, z: 300, yaw: 1.19, pitch: -0.05, lift: 0 },
  },

  {
    id: 'verdant',
    name: 'Verdant Valley',
    blurb:
      'A river traced downhill through the terrain and carved into it, with vegetation that answers to the ground — trees crowd the damp banks and give up on anything steep.',
    look: 'The river runs downhill past you, left to right. Follow it down, or climb the far bank for the view.',
    terrain: {
      seed: 77,
      frequency: 0.0085,
      octaves: 6,
      persistence: 0.53,
      amplitude: 27,
      shaping: 'none',
      outputShaping: 'none',
      warp: 12,
      detail: 0.9,
      ridges: { amount: 15, frequency: 0.0032 },
      // ~45 units of fall across the play area, running from the high
      // north-east corner toward the low south-west. Invisible underfoot.
      tilt: { x: 0.009, z: -0.0105 },
      // The valley landmark is gone: it was a trough carved along z and
      // flooded flat, which is the thing the river system replaces.
      landmark: { kind: 'none' },
      channels: null,
      // The trough bottoms out near -20, so the river sits at -13 and fills
      // only the valley floor rather than flooding the hills.
      // No global waterline. The river carries its own surface now, and a flat
      // plane under it would flood every hollow in the world besides.
      seaLevel: null,
    },
    river: {
      // Upstream is the high ground in the north-west; the route finds its own
      // way down from there.
      source: { x: 1150, z: -1150, radius: 320 },
      step: 20,
      // Long enough to leave the region rather than stopping in the middle of
      // it, which reads as unfinished.
      nodes: 215,
      // 0.016 per unit over a ~3,400-unit course is about 54 units of fall —
      // visibly downhill without reading as a waterslide.
      gradient: 0.016,
      depth: 9,
      width: 20,
      influence: 78,
      descentBias: 1,
      drift: 1.8,
      meander: 0.75,
    },
    stops: ['#30402c', '#45573a', '#5d7246', '#7a8d57', '#9aa578', '#bdbaa0'],
    /*
     * Seven surfaces across a river valley.
     *
     * Thresholds come from the terrain's own distribution rather than from
     * taste. Measured over a 1,400-unit square: land runs 12.7 to 22.4 between
     * its 25th and 95th percentiles, slope reaches 0.050 at the 90th percentile
     * and 0.245 at its worst, and moisture sits at 0.31 in the middle.
     *
     * The first version ignored all of that and 71.7% of the world came back as
     * one band — the pale upland grass — with the river bank at 0.7% and the
     * rock never winning anywhere at all. A threshold written against a range
     * the ground does not occupy is not a threshold.
     */
    bands: [
      {
        name: 'deep water',
        color: '#1b3f54',
        mask: (s) => ramp(s.depth, 2, 7),
      },
      {
        name: 'shallow water',
        // Lighter and a touch greener where it shelves, which is the cue that
        // tells you the middle is deep without anything having to be drawn.
        color: '#5e9c93',
        mask: (s) => band(s.depth, 0.1, 2.6, 1.3),
      },
      {
        name: 'river bank',
        color: '#b89a6c',
        // Tan mud and gravel at the waterline. Widened from a 2.2-unit band,
        // which on these valley sides was 0.7% of the world and invisible.
        mask: (s) => (s.depth > 0.5 ? 0 : s.shore * 2.6),
      },
      {
        name: 'lush grass',
        color: '#3d6b33',
        // Damp ground, which follows the river round its bends and reaches up
        // the side gullies — unlike a height threshold, which would ring it.
        mask: (s) => (s.depth > 0 ? 0 : ramp(s.moisture, 0.3, 0.46) * 1.3),
      },
      {
        name: 'grass',
        color: '#5f8a42',
        // The default: broad, and mid-altitude on purpose, so it is what you
        // stand on unless something else claims you.
        mask: (s) => (s.depth > 0 ? 0 : band(s.altitude, 0.08, 0.74, 0.18) * (0.75 + s.patch * 0.5)),
      },
      {
        name: 'dry upland grass',
        color: '#9fac66',
        // High *and* dry. Altitude alone put this on 72% of the world, because
        // altitude alone is nearly everywhere once the range is wrong.
        mask: (s) =>
          ramp(s.altitude, 0.68, 0.95) * (1 - ramp(s.moisture, 0.26, 0.42)) * (0.6 + s.grain * 0.8),
      },
      {
        name: 'exposed rock',
        color: '#7d7465',
        // Against a measured slope: the 90th percentile is 0.050 and the old
        // threshold started at 0.13, so this band existed and never once won.
        // Gated on depth like the rest — the carved channel wall is steep, and
        // without this it was winning under seven units of water.
        mask: (s) => ramp(s.slope, 0.045, 0.13) * 1.4 * (1 - ramp(s.depth, 0, 1)),
      },
    ],
    ground: {
      // Grass holds on all but the steepest ground here, so rock shows late and
      // never fully — which is the difference between a hill and a crag.
      rock: '#6d6a5c',
      rockMix: 0.8,
      rockFrom: 0.95,
      rockTo: 0.66,
      shore: '#b89a6c',
      // 14, not 8. The carve leaves a steep bank, so the rock band competes for
      // the same ground; at 8 the tan margin survived in a strip about four
      // units wide and read as nothing at all.
      shoreBand: 14,
      tintScale: 0.0016,
      tintAmount: 0.4,
    },
    // Refitted after the regional tilt widened the height span: measured
    // around the river's midpoint, the ground runs -7 to 46.
    colorRange: [-7, 46],
    sky: '#a8c4cc',
    fog: { color: '#c3cfbb', density: 0.00085 },
    // Teal-blue, and smoother and more metallic than before: the moving
    // highlight is what reads as water, and a rough matte surface has no
    // highlight to move. Partly transparent so the classified bed shows
    // through and the river has depth rather than one flat tone.
    water: { color: '#3f7f8c', opacity: 0.72, metalness: 0.42, roughness: 0.14 },
    sun: { azimuth: 118, elevation: 38, color: '#fff0d2', intensity: 2.2 },
    fill: 0.6,
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
        scale: [1.1, 2.4],
        color: '#4e6b3c',
        sink: 0.25,
        clump: 0.75,
        clumpScale: 0.012,
        variants: 3,
        tilt: 0.35,
        stretch: [0.65, 1.3],
        squash: 0.3,
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
        scale: [7, 17],
        color: '#3f5a36',
        sink: 0.6,
        clump: 0.92,
        clumpScale: 0.0035,
        variants: 5,
        tilt: 0.09,
        stretch: [0.82, 1.3],
        squash: 0.3,
        colorJitter: 0.34,
      },
      {
        kind: 'rock',
        attempts: 30,
        minHeight: -14,
        maxHeight: 30,
        minFlatness: 0.5,
        scale: [1, 2.6],
        color: '#6a6d5c',
        sink: 0.35,
        clump: 0.6,
        clumpScale: 0.006,
        variants: 3,
        tilt: 0.55,
        stretch: [0.6, 1.15],
        squash: 0.3,
        colorJitter: 0.28,
      },
    ],
    // On the bank above a wide reach, looking downstream, clear of the trees.
    spawn: { x: 384, z: 126, yaw: 2.55, pitch: -0.08, lift: 0 },
  },
]

export const getWorld = (id: string): WorldSpec => WORLDS.find((w) => w.id === id) ?? WORLDS[0]
