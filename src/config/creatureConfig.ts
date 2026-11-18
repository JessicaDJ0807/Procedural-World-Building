import { defaultGenome, repair, type Genome } from '../creatures/genome'
import type { DebugShow } from '../creatures/CreatureViewport'
import type { Drive } from '../creatures/lab'
import { bool, int, isRecord, num, pick, type ConfigSpec } from './spec'

/**
 * What a Topic 11 world stores: the genome, and how the lab was set up to
 * look at it.
 *
 * The genome is the creature. Skeleton, mesh, gait and senses are rebuilt
 * from it in a few milliseconds, so nothing derived is stored — the same
 * reasoning as Topic 10's site. The live state (where it stands, how hungry
 * it is) is not stored either: a saved creature wakes up rested, at the
 * start of its habitat.
 */
export type CreatureTab = 'body' | 'anatomy' | 'motion' | 'behavior' | 'variation'
export const TABS: CreatureTab[] = ['body', 'anatomy', 'motion', 'behavior', 'variation']

export type CreatureSettings = {
  tab: CreatureTab
  /** The seed the creature was rolled from: Reset returns to `origin`. */
  seed: number
  genome: Genome
  /** What Reset restores: the creature this seed rolled, before any edits or mutations. */
  origin: Genome
  /** The genome the current one was mutated from, if it was. */
  parent: Genome | null
  generation: number
  mutation: number
  drive: Drive
  inPlace: boolean
  animSpeed: number
  follow: boolean
  show: DebugShow
}

const NONE: DebugShow = { skeleton: false, joints: false, attachments: false, sensors: false, target: false, path: false }

/**
 * The overlays each system opens with — the ones that explain it. The
 * toggles can change them afterwards; switching tabs restores these.
 */
export const TAB_SHOW: Record<CreatureTab, DebugShow> = {
  body: { ...NONE },
  anatomy: { ...NONE, attachments: true },
  motion: { ...NONE, skeleton: true, path: true },
  behavior: { ...NONE, sensors: true, target: true },
  variation: { ...NONE },
}

export function defaultCreatureSettings(): CreatureSettings {
  return {
    tab: 'body',
    seed: 1,
    genome: defaultGenome(),
    origin: defaultGenome(),
    parent: null,
    generation: 0,
    mutation: 0.4,
    drive: 'walk',
    inPlace: true,
    animSpeed: 1,
    follow: true,
    show: { ...TAB_SHOW.body },
  }
}

/** A stored genome back into a valid one: known keys only, each of the right type, then repaired. */
export function parseGenome(raw: unknown): Genome {
  const d = defaultGenome()
  if (!isRecord(raw)) return d
  const out = { ...d } as Record<string, unknown>
  for (const key of Object.keys(d) as (keyof Genome)[]) {
    if (typeof raw[key] === typeof d[key]) out[key] = raw[key]
  }
  return repair(out as Genome)
}

function parse(raw: unknown): { settings: CreatureSettings; repairs: string[] } {
  const d = defaultCreatureSettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const show = isRecord(raw.show) ? raw.show : {}
  const tab = pick(raw.tab, TABS, d.tab)
  const fallback = TAB_SHOW[tab]
  return {
    settings: {
      tab,
      seed: int(raw.seed, 1, 9999, d.seed),
      genome: parseGenome(raw.genome),
      origin: parseGenome(raw.origin),
      parent: isRecord(raw.parent) ? parseGenome(raw.parent) : null,
      generation: int(raw.generation, 0, 9999, 0),
      mutation: num(raw.mutation, 0.05, 1, d.mutation),
      drive: pick(raw.drive, ['idle', 'walk', 'run'] as const, d.drive),
      inPlace: bool(raw.inPlace, d.inPlace),
      animSpeed: num(raw.animSpeed, 0.1, 2, d.animSpeed),
      follow: bool(raw.follow, d.follow),
      show: {
        skeleton: bool(show.skeleton, fallback.skeleton),
        joints: bool(show.joints, fallback.joints),
        attachments: bool(show.attachments, fallback.attachments),
        sensors: bool(show.sensors, fallback.sensors),
        target: bool(show.target, fallback.target),
        path: bool(show.path, fallback.path),
      },
    },
    repairs: [],
  }
}

export const creatureSpec: ConfigSpec<CreatureSettings> = {
  topic: 'creatures',
  schemaVersion: 1,
  defaults: defaultCreatureSettings,
  parse,
  summary: (s) => `${s.genome.legs} legs · ${s.genome.topology} · ${s.genome.symmetry}${s.generation ? ` · generation ${s.generation}` : ''} · seed ${s.seed}`,
}
