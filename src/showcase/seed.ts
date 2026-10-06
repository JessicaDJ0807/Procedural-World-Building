import { SHOWCASE_TOPICS, type ShowcaseTopic } from '../config/spec'
import { listConfigurations, saveConfiguration } from '../firebase/configs'
import { SPECS, validateAll } from './validate'
import { SHOWCASE_WORLDS, settingsFor } from './worlds'

export type SeedOutcome = {
  created: number
  skipped: number
  failures: { world: string; topic: ShowcaseTopic; reason: string }[]
}

/**
 * Writing the showcase worlds into the signed-in account.
 *
 * ## Why this goes through the ordinary save path
 *
 * `saveConfiguration` is the function the Save button calls. Using it here
 * means a seeded world is indistinguishable from one saved by hand — same
 * document shape, same `ownerUid`, same `createdAt`, same security rules
 * evaluated against the same authenticated session. There is no admin
 * credential anywhere in this app and nothing here needs one: the rules allow a
 * user to write their own configs, and that is exactly what this does.
 *
 * ## Idempotence
 *
 * A world is skipped per topic when a document of that name already exists on
 * that topic. Name rather than id, because the id is minted by Firestore and
 * nothing durable ties a document back to the preset it came from — adding a
 * marker field would need a rules change, which is off the table. The
 * consequence to know about: rename a seeded world and re-seeding will write a
 * fresh copy, because by then nothing says they were the same thing.
 *
 * A partially-failed run is safe to repeat. Each document is written on its
 * own, and the ones that already landed are skipped on the next attempt.
 */

/**
 * Write every showcase world into `uid`'s own configs, skipping what is there.
 *
 * Writes are sequential rather than batched. Twenty documents is not enough
 * work to be worth a batch, and one failure leaving nineteen written is a
 * better outcome here than one failure rolling all twenty back — the next run
 * picks up exactly what is missing.
 */
export async function seedShowcaseWorlds(
  uid: string,
  onProgress?: (message: string) => void,
): Promise<SeedOutcome> {
  const outcome: SeedOutcome = { created: 0, skipped: 0, failures: [] }

  const blocked = validateAll()
  if (blocked.length > 0) {
    // Refusing to write anything is right: these are static presets, so a
    // validation failure is a bug in this file rather than bad input, and it
    // will fail the same way on every run.
    outcome.failures = blocked
    return outcome
  }

  // One listing per topic, not one per document: the names a topic already
  // holds are the same for all five worlds.
  const existing: Partial<Record<ShowcaseTopic, Set<string>>> = {}
  for (const topic of SHOWCASE_TOPICS) {
    const configs = await listConfigurations(uid, SPECS[topic])
    existing[topic] = new Set(configs.map((config) => config.name))
  }

  for (const world of SHOWCASE_WORLDS) {
    for (const topic of SHOWCASE_TOPICS) {
      if (existing[topic]?.has(world.name)) {
        outcome.skipped++
        continue
      }
      try {
        onProgress?.(`${world.name} · ${topic}`)
        await saveConfiguration(uid, SPECS[topic], world.name, settingsFor(world, topic) as never)
        outcome.created++
      } catch (caught) {
        outcome.failures.push({
          world: world.name,
          topic,
          reason: caught instanceof Error ? caught.message : String(caught),
        })
      }
    }
  }

  return outcome
}
