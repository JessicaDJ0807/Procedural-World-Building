/**
 * One saved-document contract per topic.
 *
 * Every topic stores a different shape, so the parts that cannot be shared —
 * what the defaults are, how to validate a document, how to summarise it in one
 * line — are supplied per topic and everything else is written once.
 */
export type TopicId = ShowcaseTopic | 'distributions'

export const TOPIC_IDS: TopicId[] = ['objects', 'maps', 'voxels', 'shaders', 'distributions']

/**
 * The topics the showcase worlds were written for.
 *
 * A showcase world is one design expressed through each of the first four
 * topics, and the seeder writes one document per world per topic. Later topics
 * save and load like any other, but have no showcase settings — so the seeder
 * walks this list, not TOPIC_IDS, rather than writing an empty world into a
 * topic it was never designed for.
 */
export type ShowcaseTopic = 'objects' | 'maps' | 'voxels' | 'shaders'

export const SHOWCASE_TOPICS: ShowcaseTopic[] = ['objects', 'maps', 'voxels', 'shaders']

export type ConfigSpec<S> = {
  topic: TopicId
  /** Bumped when a stored shape changes incompatibly. */
  schemaVersion: number
  defaults: () => S
  /** Must never throw: see parse notes in docs/project/firebase-setup.md. */
  parse: (raw: unknown) => { settings: S; repairs: string[] }
  /** The one line under a name in the library, e.g. "3 shapes · 56³". */
  summary: (settings: S) => string
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Out of range, the wrong type and NaN all collapse to the fallback. */
export function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function int(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(num(value, min, max, fallback))
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Checked against the live list, so a renamed option degrades instead of breaking. */
export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** A CSS hex colour, the one string a user can set directly. */
export function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

/**
 * Rebuild a numeric parameter bag from the definitions that own it, so an
 * unknown key cannot survive and a missing one gets its default.
 */
export function params(
  raw: unknown,
  specs: readonly { key: string; min: number; max: number; defaultValue: number }[],
): Record<string, number> {
  const source = isRecord(raw) ? raw : {}
  const out: Record<string, number> = {}
  for (const spec of specs) {
    out[spec.key] = num(source[spec.key], spec.min, spec.max, spec.defaultValue)
  }
  return out
}

/** The bytes an export writes, and the ones a Storage upload would hold. */
export function configToJson<S>(spec: ConfigSpec<S>, name: string, settings: S): string {
  return JSON.stringify(
    { name, topic: spec.topic, schemaVersion: spec.schemaVersion, settings },
    null,
    2,
  )
}
