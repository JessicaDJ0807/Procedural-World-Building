import { mulberry32 } from '../noise'

/**
 * The genotype: every number a creature is built from, and nothing else.
 *
 * The phenotype — skeleton, mesh, gait, senses — is a pure function of this
 * record (skeleton.ts), so a creature is reproducible from about forty
 * numbers, mutation is an edit to the record, and saving a creature stores the
 * record rather than any geometry. State that changes while the creature
 * lives (energy, hunger, where it stands) is not here; the genome is what it
 * was born with.
 *
 * Every gene is declared once in GENES with its range. `repair` clamps a
 * record into those ranges and then applies the few rules a record can
 * break *between* genes — the anatomy that would not hold together — so
 * anything that went through it, from a slider, a mutation, a saved file or a
 * random roll, builds a valid creature.
 */
export type Topology = 'continuous' | 'segmented' | 'branching'
export type Symmetry = 'bilateral' | 'radial' | 'asymmetric'
export type LegCount = 0 | 2 | 4 | 6 | 8

export const TOPOLOGIES: Topology[] = ['continuous', 'segmented', 'branching']
export const SYMMETRIES: Symmetry[] = ['bilateral', 'radial', 'asymmetric']
export const LEG_COUNTS: LegCount[] = [0, 2, 4, 6, 8]

export type Genome = {
  // Body plan
  topology: Topology
  symmetry: Symmetry
  /** Torso length, nose of the chest to the base of the tail, in world units. */
  bodyLength: number
  bodyWidth: number
  bodyHeight: number
  /** Body segments: bulges along the spine. Continuous bodies use it only for how many spine bones carry the skin. */
  segments: number
  /** How much segment girth varies, front to back, by a seeded roll per segment. */
  segmentVariation: number
  /** Multiplies every length. */
  scale: number
  // Anatomy
  legs: LegCount
  /** Hip to foot, straightened, in world units before scale. */
  legLength: number
  legSegments: number
  /** Where along the torso the legs attach, rear (0) to front (1). */
  legPlacement: number
  /** How far the leg pairs spread along the torso, as a share of its length. */
  legSpread: number
  tail: boolean
  /** As a share of torso length. */
  tailLength: number
  tailSegments: number
  /** Head width as a share of body width. */
  headSize: number
  eyes: number
  /** Eye radius as a share of head size. */
  eyeSize: number
  /** 0: forward-facing, like a hunter; 1: on the sides, like prey. */
  eyePlacement: number
  antennae: number
  /** As a share of torso length. */
  antennaLength: number
  wings: boolean
  /** Wing length as a share of torso length. */
  wingSpan: number
  // Locomotion
  /** Walking speed, world units per second. Running is 2.2× this. */
  speed: number
  /** Distance the body covers in one gait cycle, as a share of leg length. */
  stride: number
  /** Swing-foot lift, as a share of leg length. */
  stepHeight: number
  /** Side-to-side bend of the spine while moving. */
  sway: number
  // Behaviour
  /** How far it can see, in world units. */
  detection: number
  /** How readily it wanders off to somewhere new. */
  curiosity: number
  // Look
  /** 0–1 along a muted palette: moss, sage, slate, sand. */
  hue: number
  /** Strength of the dorsal stripes. */
  pattern: number
  /**
   * The developmental seed: the rolls that make a body its own — each
   * segment's girth, an asymmetric creature's uneven legs and eyes. Separate
   * from the other genes on purpose: if it were derived from them, dragging
   * the body-length slider would reshuffle every segment.
   */
  bodySeed: number
}

type NumberGene = {
  [K in keyof Genome]: Genome[K] extends number ? K : never
}[keyof Genome]

export type GeneSpec = {
  key: NumberGene
  label: string
  group: GeneGroup
  min: number
  max: number
  step: number
  /** Integers mutate by whole steps; reals by a Gaussian on the range. */
  integer?: boolean
  info: string
  format?: (v: number) => string
}

export type GeneGroup = 'body' | 'anatomy' | 'motion' | 'behaviour' | 'look'

const u = (v: number) => `${v.toFixed(2)} u`
const pct = (v: number) => `${Math.round(v * 100)}%`
const x = (v: number) => `${v.toFixed(2)}×`

/** The numeric genes, each with its range. Ranges are the space mutation explores. */
export const GENES: GeneSpec[] = [
  { key: 'bodyLength', label: 'Body length', group: 'body', min: 1.2, max: 6, step: 0.05, format: u, info: 'Torso length, chest to the base of the tail. The head and tail are added to it.' },
  { key: 'bodyWidth', label: 'Body width', group: 'body', min: 0.4, max: 2.2, step: 0.05, format: u, info: 'Widest girth side to side. Legs attach at the edge of the girth at their attachment point, so a wide body splays the legs.' },
  { key: 'bodyHeight', label: 'Body height', group: 'body', min: 0.3, max: 2, step: 0.05, format: u, info: 'Girth top to bottom. The cross-section is an ellipse of width × height.' },
  { key: 'segments', label: 'Segment count', group: 'body', min: 1, max: 9, step: 1, integer: true, format: (v) => v.toFixed(0), info: 'Segmented bodies bulge once per segment with a pinch between; leg pairs snap to segment centres. Continuous bodies are one smooth profile and use this only for how many spine bones carry the skin.' },
  { key: 'segmentVariation', label: 'Segment variation', group: 'body', min: 0, max: 1, step: 0.05, format: pct, info: 'Each segment\'s girth is multiplied by a seeded factor between 1 − 0.45× this and 1 + 0.45× this. At 0 every segment is the same size.' },
  { key: 'scale', label: 'Overall scale', group: 'body', min: 0.5, max: 2, step: 0.05, format: x, info: 'Multiplies every length — body, legs, head, stride. Speeds stay in units per second, so a bigger creature at the same speed takes slower, longer strides.' },
  { key: 'legLength', label: 'Leg length', group: 'anatomy', min: 0.4, max: 3.2, step: 0.05, format: u, info: 'Hip to foot, straightened. The body rides at the height where every foot stands at 80% of its reach, so longer legs lift the body.' },
  { key: 'legSegments', label: 'Leg segments', group: 'anatomy', min: 2, max: 4, step: 1, integer: true, format: (v) => v.toFixed(0), info: '2: thigh and shin, solved by two-bone IK. 3: adds a foot that stands up on its toes (digitigrade). 4: adds a coxa that holds the leg out sideways first, as an insect\'s does.' },
  { key: 'legPlacement', label: 'Attachment position', group: 'anatomy', min: 0, max: 1, step: 0.05, format: pct, info: 'Centre of the leg attachments along the torso, from the rear (0) to the front (1).' },
  { key: 'legSpread', label: 'Attachment spread', group: 'anatomy', min: 0, max: 1, step: 0.05, format: pct, info: 'How far the leg pairs spread along the torso, as a share of its length. Has no effect on one pair.' },
  { key: 'tailLength', label: 'Tail length', group: 'anatomy', min: 0.1, max: 1.6, step: 0.05, format: x, info: 'As a multiple of the torso length.' },
  { key: 'tailSegments', label: 'Tail segments', group: 'anatomy', min: 2, max: 14, step: 1, integer: true, format: (v) => v.toFixed(0), info: 'Spine bones in the tail. Each bends a little, so more segments make a smoother curl; the skin is bound to them like the rest of the spine.' },
  { key: 'headSize', label: 'Head size', group: 'anatomy', min: 0.35, max: 1.4, step: 0.05, format: x, info: 'Head width as a multiple of the body width.' },
  { key: 'eyes', label: 'Eyes', group: 'anatomy', min: 0, max: 8, step: 1, integer: true, format: (v) => v.toFixed(0), info: 'Eyes set the field of view the creature perceives with. None: it senses only by touch and antennae. Bilateral eyes come in pairs; an odd one sits on the midline.' },
  { key: 'eyeSize', label: 'Eye size', group: 'anatomy', min: 0.08, max: 0.4, step: 0.01, format: pct, info: 'Eye radius as a share of the head. Bigger eyes see further: detection range is scaled by 0.75 + this.' },
  { key: 'eyePlacement', label: 'Eye placement', group: 'anatomy', min: 0, max: 1, step: 0.05, format: pct, info: 'Forward-facing (0) eyes overlap and see a narrow 120° ahead; side-mounted (1) eyes see 300° round. Radial creatures see all round.' },
  { key: 'antennae', label: 'Antennae / horns', group: 'anatomy', min: 0, max: 6, step: 1, integer: true, format: (v) => v.toFixed(0), info: 'Sprung appendages on the head. Each is a chain of point masses that lags behind the head and springs back: secondary motion, not keyframes. Antennae also give a short all-round sense of smell.' },
  { key: 'antennaLength', label: 'Antenna length', group: 'anatomy', min: 0.1, max: 1.2, step: 0.05, format: x, info: 'As a multiple of the torso length. Long ones droop and swing more.' },
  { key: 'wingSpan', label: 'Wing length', group: 'anatomy', min: 0.3, max: 1.6, step: 0.05, format: x, info: 'Each wing as a multiple of the torso length. The wings fold and flutter but do not fly: flight is a future extension, not a menu option that does nothing.' },
  { key: 'speed', label: 'Movement speed', group: 'motion', min: 0.3, max: 4, step: 0.05, format: (v) => `${v.toFixed(2)} u/s`, info: 'Walking speed. Running is 2.2× this, with strides 1.35× longer. The gait cycle is stride ÷ speed, so faster with the same stride is a quicker cadence.' },
  { key: 'stride', label: 'Stride length', group: 'motion', min: 0.3, max: 1.8, step: 0.05, format: x, info: 'Ground covered per gait cycle, as a multiple of leg length. Capped at what the legs can reach: a foot on the ground cannot be dragged further from its hip than the leg is long.' },
  { key: 'stepHeight', label: 'Step height', group: 'motion', min: 0.03, max: 0.5, step: 0.01, format: pct, info: 'How high a swinging foot lifts, as a share of leg length. The swing follows half a sine wave.' },
  { key: 'sway', label: 'Body sway', group: 'motion', min: 0, max: 1, step: 0.05, format: pct, info: 'Side-to-side bend of the spine while moving. For legged creatures a standing wave locked to the gait cycle; for legless ones the amplitude of the travelling wave they slither on.' },
  { key: 'detection', label: 'Detection radius', group: 'behaviour', min: 2, max: 20, step: 0.5, format: u, info: 'How far the eyes see, before eye size scales it. Food outside this radius, or outside the field of view, does not exist to the creature.' },
  { key: 'curiosity', label: 'Curiosity', group: 'behaviour', min: 0, max: 1, step: 0.05, format: pct, info: 'Chance that a new wander goal is a point of interest rather than somewhere nearby, how far nearby is, and how short its pauses are.' },
  { key: 'hue', label: 'Colour', group: 'look', min: 0, max: 1, step: 0.01, format: pct, info: 'A position along a muted palette: moss, sage, slate, sand.' },
  { key: 'pattern', label: 'Stripes', group: 'look', min: 0, max: 1, step: 0.05, format: pct, info: 'Strength of the darker dorsal bands. On segmented bodies they fall on the pinches.' },
]

export const geneSpec = (key: NumberGene) => GENES.find((g) => g.key === key) as GeneSpec

export function defaultGenome(): Genome {
  return {
    topology: 'segmented',
    symmetry: 'bilateral',
    bodyLength: 2.6,
    bodyWidth: 1,
    bodyHeight: 0.8,
    segments: 3,
    segmentVariation: 0.35,
    scale: 1,
    legs: 4,
    legLength: 1.3,
    legSegments: 3,
    legPlacement: 0.5,
    legSpread: 0.7,
    tail: true,
    tailLength: 0.8,
    tailSegments: 8,
    headSize: 0.8,
    eyes: 2,
    eyeSize: 0.22,
    eyePlacement: 0.45,
    antennae: 2,
    antennaLength: 0.45,
    wings: false,
    wingSpan: 0.8,
    speed: 1.2,
    stride: 0.9,
    stepHeight: 0.18,
    sway: 0.35,
    detection: 9,
    curiosity: 0.5,
    hue: 0.22,
    pattern: 0.5,
    bodySeed: 1,
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** How a leg's length divides into bones, hip to toe. */
export function legRatios(segments: number): number[] {
  if (segments <= 2) return [0.5, 0.5]
  if (segments === 3) return [0.38, 0.42, 0.2]
  return [0.16, 0.34, 0.34, 0.16]
}

/** The share of a leg the two-bone IK solves: thigh and shin. */
export const ikShare = (segments: number) => {
  const r = legRatios(segments)
  return segments >= 4 ? r[1] + r[2] : r[0] + r[1]
}

/**
 * How far a resting foot stands out from its hip, as a share of the IK
 * reach. Two and four legs stand under the body, as a mammal or a bird does;
 * six and eight, and any radial creature, sprawl, as an insect or a spider does.
 */
export const legSplay = (g: Pick<Genome, 'legs' | 'symmetry'>) => (g.legs <= 4 && g.symmetry !== 'radial' ? 0.15 : 0.55)

/**
 * Into range, then the rules between genes. Never throws; anything numeric
 * that is not a finite number falls back to the default.
 */
export function repair(raw: Genome): Genome {
  const d = defaultGenome()
  const g = { ...raw }
  for (const spec of GENES) {
    const v = g[spec.key]
    let n = typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : d[spec.key]
    if (spec.integer) n = Math.round(n)
    ;(g as Record<string, unknown>)[spec.key] = n
  }
  if (!TOPOLOGIES.includes(g.topology)) g.topology = d.topology
  if (!SYMMETRIES.includes(g.symmetry)) g.symmetry = d.symmetry
  if (!LEG_COUNTS.includes(g.legs)) g.legs = d.legs
  g.bodySeed = typeof g.bodySeed === 'number' && Number.isFinite(g.bodySeed) ? Math.round(clamp(g.bodySeed, 1, 9999)) : d.bodySeed
  g.tail = typeof g.tail === 'boolean' ? g.tail : d.tail
  g.wings = typeof g.wings === 'boolean' ? g.wings : d.wings

  // Rules between genes — each one an anatomy that would not hold together.
  // A legless creature has nothing to stand on but its belly, so it needs a
  // body long enough to slither with: at least three segments of spine.
  if (g.legs === 0 && g.topology === 'segmented') g.segments = Math.max(g.segments, 3)
  // A segmented body needs a segment for every leg pair to stand on.
  if (g.topology === 'segmented') g.segments = Math.max(g.segments, g.legs / 2)
  // Radial symmetry with fewer than four legs is bilateral by another name.
  if (g.symmetry === 'radial' && g.legs > 0 && g.legs < 4) g.symmetry = 'bilateral'
  // A legless body is slender: an undulating wave needs length to push with.
  if (g.legs === 0) g.bodyLength = Math.max(g.bodyLength, g.bodyWidth * 2.5)
  // Legs must hold the belly off the ground. The hips sit 0.65 of the way
  // down the half-girth, and a resting foot stands at 80% of the leg's reach
  // with the foot splayed out sideways; this is the shortest leg that can.
  if (g.legs > 0) {
    const halfH = (g.bodyHeight / 2) * (1 + 0.45 * g.segmentVariation)
    const need = 0.65 * halfH + 0.05
    const splay = legSplay(g)
    const minLeg = need / (ikShare(g.legSegments) * Math.sqrt(0.64 - splay * splay))
    g.legLength = Math.min(geneSpec('legLength').max, Math.max(g.legLength, Math.ceil(minLeg * 20) / 20))
    if (g.legLength < minLeg) g.bodyHeight = Math.max(geneSpec('bodyHeight').min, g.bodyHeight * (g.legLength / minLeg))
  }
  return g
}

/**
 * A random creature from a seed. Not uniform over the ranges: each gene is
 * drawn from a middle band, so a random creature is usually odd rather than
 * broken, and the extremes are left for the sliders and for mutation to find.
 */
export function randomGenome(seed: number): Genome {
  const r = mulberry32(seed * 7919 + 17)
  const pick = <T,>(xs: readonly T[], weights?: number[]) => {
    if (!weights) return xs[Math.floor(r() * xs.length)]
    const total = weights.reduce((a, b) => a + b, 0)
    let t = r() * total
    for (let i = 0; i < xs.length; i++) if ((t -= weights[i]) < 0) return xs[i]
    return xs[xs.length - 1]
  }
  const g = {} as Genome
  for (const spec of GENES) {
    const span = spec.max - spec.min
    // A triangular draw over the middle 80% of the range.
    const t = 0.1 + 0.8 * ((r() + r()) / 2)
    ;(g as Record<string, unknown>)[spec.key] = spec.integer ? Math.round(spec.min + t * span) : spec.min + t * span
  }
  g.topology = pick(TOPOLOGIES, [3, 4, 2])
  g.symmetry = pick(SYMMETRIES, [6, 2, 2])
  g.legs = pick(LEG_COUNTS, [1, 2, 4, 3, 2])
  g.tail = r() < 0.75
  g.wings = r() < 0.25
  g.scale = 0.8 + r() * 0.5
  // Antennae are the one feature a uniform draw overdoes: six antennae at
  // two-thirds of a body length read as the whole creature. A roll favours
  // two short ones; the slider still reaches the extremes.
  g.antennae = pick([0, 1, 2, 3, 4] as const, [3, 1, 5, 1, 1])
  g.antennaLength = 0.15 + 0.4 * r()
  // Colour is uniform, not middle-weighted: the middle of the palette is slate,
  // and a triangular draw made two creatures in three grey.
  g.hue = r()
  g.bodySeed = seed
  return repair(g)
}

export type GeneChange = { gene: keyof Genome; label: string; from: string; to: string }

const fmtValue = (key: keyof Genome, v: Genome[keyof Genome]) => {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') return v
  const spec = GENES.find((s) => s.key === key)
  return spec?.format ? spec.format(v) : String(v)
}

/** Labels for the genes that are not numbers. */
export const DISCRETE_LABELS: Partial<Record<keyof Genome, string>> = {
  topology: 'Topology',
  symmetry: 'Symmetry',
  legs: 'Legs',
  tail: 'Tail',
  wings: 'Wings',
}

/**
 * Point mutation. Each gene is hit with probability `strength` × 0.35, and at
 * least one always is. A real gene moves by a Gaussian of σ = strength × 25%
 * of its range; an integer gene by one step, or two at high strength; a
 * choice gene flips to a neighbouring option (legs go up or down by a pair).
 * The result goes through `repair`, so a mutant is always a buildable
 * creature — mutation explores, repair keeps it inside the space of bodies
 * that hold together.
 */
export function mutate(parent: Genome, strength: number, seed: number): { genome: Genome; changes: GeneChange[] } {
  const r = mulberry32(seed * 104729 + 3)
  const gauss = () => {
    const u1 = Math.max(r(), 1e-9)
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r())
  }
  const s = clamp(strength, 0, 1)
  const child = { ...parent }
  const keys: (keyof Genome)[] = [...GENES.map((g) => g.key), 'topology', 'symmetry', 'legs', 'tail', 'wings']
  const p = s * 0.35
  let hit = keys.filter(() => r() < p)
  if (hit.length === 0) hit = [keys[Math.floor(r() * keys.length)]]
  for (const key of hit) {
    const spec = GENES.find((g) => g.key === key)
    if (spec) {
      const span = spec.max - spec.min
      if (spec.integer) {
        const steps = s > 0.6 && r() < 0.5 ? 2 : 1
        ;(child[spec.key] as number) = (child[spec.key] as number) + (r() < 0.5 ? -steps : steps)
      } else {
        ;(child[spec.key] as number) = (child[spec.key] as number) + gauss() * s * 0.25 * span
      }
      continue
    }
    if (key === 'legs') {
      const i = LEG_COUNTS.indexOf(child.legs)
      const j = clamp(i + (r() < 0.5 ? -1 : 1), 0, LEG_COUNTS.length - 1)
      // Losing the last pair of legs is a big jump; at low strength it is rarer.
      child.legs = LEG_COUNTS[j === 0 && r() > s ? 1 : j]
    } else if (key === 'topology') {
      child.topology = TOPOLOGIES[(TOPOLOGIES.indexOf(child.topology) + 1 + Math.floor(r() * 2)) % 3]
    } else if (key === 'symmetry') {
      child.symmetry = SYMMETRIES[(SYMMETRIES.indexOf(child.symmetry) + 1 + Math.floor(r() * 2)) % 3]
    } else if (key === 'tail') child.tail = !child.tail
    else if (key === 'wings') child.wings = !child.wings
  }
  const genome = repair(child)
  const changes: GeneChange[] = []
  for (const key of Object.keys(genome) as (keyof Genome)[]) {
    const a = fmtValue(key, parent[key])
    const b = fmtValue(key, genome[key])
    if (a !== b) changes.push({ gene: key, label: GENES.find((g) => g.key === key)?.label ?? DISCRETE_LABELS[key] ?? key, from: a, to: b })
  }
  return { genome, changes }
}

export { fmtValue as formatGene }
