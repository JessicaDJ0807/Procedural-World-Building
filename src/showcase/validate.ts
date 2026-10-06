import { noiseSpec } from '../config/noiseConfig'
import { objectSpec } from '../config/objectConfig'
import { shaderSpec } from '../config/shaderConfig'
import { voxelSpec } from '../config/voxelConfig'
import { SHOWCASE_TOPICS, TOPIC_IDS, type ConfigSpec, type ShowcaseTopic } from '../config/spec'
import { settingsFor, SHOWCASE_WORLDS, type ShowcaseWorld } from './worlds'

/**
 * Whether a preset is something this app can actually store and render.
 *
 * Separate from `seed.ts` on purpose: checking a preset has nothing to do with
 * writing one, and keeping the two apart means the whole set can be validated
 * in a plain Node script without the Firestore client — which pulls in gRPC and
 * does not bundle for Node from this project's browser build.
 */
/** Paired with the four `ConfigSpec`s, so a document is written by its own contract. */
export const SPECS: Record<ShowcaseTopic, ConfigSpec<never>> = {
  objects: objectSpec as unknown as ConfigSpec<never>,
  maps: noiseSpec as unknown as ConfigSpec<never>,
  voxels: voxelSpec as unknown as ConfigSpec<never>,
  shaders: shaderSpec as unknown as ConfigSpec<never>,
}

/**
 * Firestore's rules require a non-empty name of at most 120 characters, a topic
 * from the allowed list, and a settings map. Checked here rather than left to
 * the write, because a rejection surfaces as `permission-denied`, which reads
 * identically to not being signed in and would send anyone debugging it to the
 * wrong place entirely.
 */
export function validate(world: ShowcaseWorld, topic: ShowcaseTopic): string | null {
  if (!world.name || world.name.length === 0) return 'name is empty'
  if (world.name.length > 120) return `name is ${world.name.length} characters, over the 120 limit`
  if (!TOPIC_IDS.includes(topic)) return `topic ${topic} is not one the rules allow`

  const settings = settingsFor(world, topic)
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return 'settings is not a map'
  }

  // The stronger check: every value has to survive the topic's own parser
  // untouched. A repair would mean the preset asked for something the renderer
  // does not support, which is the one thing a showcase must never do.
  const { repairs } = SPECS[topic].parse(settings)
  if (repairs.length > 0) return `settings needed repair: ${repairs.join('; ')}`

  // Firestore rejects undefined outright and cannot store a non-finite number.
  const bad = findInvalid(settings)
  if (bad) return bad
  return null
}

function findInvalid(value: unknown, path = 'settings'): string | null {
  if (value === undefined) return `${path} is undefined`
  if (typeof value === 'number' && !Number.isFinite(value)) return `${path} is ${value}`
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findInvalid(value[i], `${path}[${i}]`)
      if (bad) return bad
    }
    return null
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const bad = findInvalid(child, `${path}.${key}`)
      if (bad) return bad
    }
  }
  return null
}

/** Every world against every topic, before anything is written. */
export function validateAll(): { world: string; topic: ShowcaseTopic; reason: string }[] {
  const problems: { world: string; topic: ShowcaseTopic; reason: string }[] = []
  for (const world of SHOWCASE_WORLDS) {
    for (const topic of SHOWCASE_TOPICS) {
      const reason = validate(world, topic)
      if (reason) problems.push({ world: world.name, topic, reason })
    }
  }
  return problems
}

