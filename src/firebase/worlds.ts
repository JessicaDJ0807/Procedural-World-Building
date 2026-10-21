import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { requireFirebase } from './config'
import { WORLD_VERSION, WorldFormatError, readHead, type WorldHead, type WorldSummary } from '../build/worldState'

/**
 * Saved Wildform worlds.
 *
 *     users/{uid}/worlds/{worldId}                 name, owner, version, times, and the head:
 *                                                  scenario, seed, step, weather, a summary
 *     users/{uid}/worlds/{worldId}/chunks/{id}     the body, cut into pieces
 *
 * Its own collection, not `configs`: a config is a topic's control settings;
 * a world is a whole game.
 *
 * **Why chunks.** The body — every plant layer, tip, structure and Draper —
 * was 101 KB at step 1,600 and 175 KB at step 6,000 in the stepping-stone
 * run, but it grows with the plants: a town grown solid is about 36,000
 * layers at 22 bytes, which as base64 is past a megabyte, and a Firestore
 * document stops at 1 MiB. So the body is stored as strings of at most
 * CHUNK characters, each in its own document.
 *
 * **Why a snapshot id.** A save writes its chunks under a new snapshot id
 * first, and only then points the world document at it; the old snapshot's
 * chunks are deleted after, by id. A save that fails half-way leaves the
 * world pointing at its last complete snapshot — never at a mix of two.
 * (A save that fails before the switch leaves its new chunks orphaned:
 * storage, not damage.)
 *
 * The logic is written against `Docs`, a five-call document store, so the same
 * code runs on Firestore and, in tests, on `memoryDocs` (memoryDocs.ts),
 * which enforces the 1 MiB limit and firestore.rules' checks.
 */

/** Characters per chunk: comfortably under the 1 MiB document limit, with room for the other fields. */
export const CHUNK = 800_000
/** Chunks per batch: a batch's request is capped at 10 MiB. */
const PER_BATCH = 8

export const MAX_NAME = 120

/** Stands for "the server's time now" in a write. */
export const STAMP = Symbol('server timestamp')

export type DocData = Record<string, unknown>

/** The document operations the worlds need. Paths are slash-separated, as Firestore's. */
export type Docs = {
  newId(collectionPath: string): string
  get(path: string): Promise<DocData | null>
  /** A collection's documents, newest `updatedAt` first. */
  list(collectionPath: string): Promise<{ id: string; data: DocData }[]>
  set(path: string, data: DocData): Promise<void>
  update(path: string, data: DocData): Promise<void>
  /** All of these, or none. */
  batch(ops: ({ set: string; data: DocData } | { delete: string })[]): Promise<void>
}

export type WorldListing = {
  id: string
  name: string
  ownerUid: string
  createdAt: Date | null
  updatedAt: Date | null
  /** Null if this build can't read the world (too new, malformed): it is listed, and says why. */
  head: WorldHead | null
  problem: string | null
  summary: WorldSummary | null
}

type SnapshotRef = { id: string; chunks: number; chars: number }

const worldsPath = (uid: string) => `users/${uid}/worlds`
const chunksPath = (uid: string, worldId: string) => `users/${uid}/worlds/${worldId}/chunks`

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : null)

export function validName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Give the world a name.'
  if (n.length > MAX_NAME) return `Names are at most ${MAX_NAME} characters.`
  return null
}

/** "Hanging Garden" → "Hanging Garden copy", within the length limit. */
export function copyName(name: string): string {
  const suffix = ' copy'
  return (name.length + suffix.length > MAX_NAME ? name.slice(0, MAX_NAME - suffix.length) : name) + suffix
}

function listing(id: string, data: DocData): WorldListing {
  let head: WorldHead | null = null
  let problem: string | null = null
  try {
    head = readHead(data)
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e)
  }
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : '(untitled)',
    ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : '',
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    head,
    problem,
    summary: head?.summary ?? null,
  }
}

export type WorldsApi = ReturnType<typeof worldsApi>

/** The saved-worlds operations, on a document store. */
export function worldsApi(docs: Docs) {
  /** Writes a body as chunks under a new snapshot id. */
  async function writeSnapshot(uid: string, worldId: string, body: string): Promise<SnapshotRef> {
    const snap = docs.newId(chunksPath(uid, worldId))
    const pieces: string[] = []
    for (let i = 0; i < body.length; i += CHUNK) pieces.push(body.slice(i, i + CHUNK))
    if (!pieces.length) pieces.push('')
    for (let start = 0; start < pieces.length; start += PER_BATCH) {
      await docs.batch(
        pieces.slice(start, start + PER_BATCH).map((data, k) => ({
          set: `${chunksPath(uid, worldId)}/${snap}-${start + k}`,
          data: { ownerUid: uid, snapshot: snap, index: start + k, data },
        })),
      )
    }
    return { id: snap, chunks: pieces.length, chars: body.length }
  }

  /**
   * Deletes one snapshot's chunks, by id. Not by listing the collection:
   * listing downloads every chunk — up to CHUNK characters each — only to
   * delete it.
   */
  async function deleteSnapshot(uid: string, worldId: string, snapshot: SnapshotRef | undefined) {
    if (!snapshot || typeof snapshot.id !== 'string') return
    for (let start = 0; start < snapshot.chunks; start += 400) {
      const ops = []
      for (let i = start; i < Math.min(snapshot.chunks, start + 400); i++) ops.push({ delete: `${chunksPath(uid, worldId)}/${snapshot.id}-${i}` })
      await docs.batch(ops)
    }
  }

  /** A world's head and body, read back. Throws WorldFormatError if a piece is missing. */
  async function readWorld(uid: string, worldId: string): Promise<{ listing: WorldListing; raw: DocData; body: string }> {
    const raw = await docs.get(`${worldsPath(uid)}/${worldId}`)
    if (!raw) throw new WorldFormatError('That world no longer exists')
    const snapshot = raw.snapshot as SnapshotRef | undefined
    if (!snapshot || typeof snapshot.id !== 'string' || !(snapshot.chunks >= 1)) throw new WorldFormatError('The world’s saved state is missing')
    const parts = await Promise.all(Array.from({ length: snapshot.chunks }, (_, i) => docs.get(`${chunksPath(uid, worldId)}/${snapshot.id}-${i}`)))
    if (parts.some((p) => !p)) throw new WorldFormatError('Part of the world’s saved state is missing')
    const body = parts.map((p) => String(p!.data)).join('')
    if (body.length !== snapshot.chars) throw new WorldFormatError('The world’s saved state is incomplete')
    return { listing: listing(worldId, raw), raw, body }
  }

  /**
   * Saves a world: a new one if `existingId` is absent, else over that one,
   * keeping its createdAt (an update, not a set — as configs.ts learned).
   * Returns the world's id.
   */
  async function saveWorld(uid: string, name: string, head: WorldHead, body: string, existingId?: string): Promise<string> {
    const problem = validName(name)
    if (problem) throw new Error(problem)
    const id = existingId ?? docs.newId(worldsPath(uid))
    const path = `${worldsPath(uid)}/${id}`
    const previous = existingId ? ((await docs.get(path))?.snapshot as SnapshotRef | undefined) : undefined
    const snapshot = await writeSnapshot(uid, id, body)
    const fields = { ...head, name: name.trim(), ownerUid: uid, version: WORLD_VERSION, snapshot, updatedAt: STAMP }
    if (existingId) await docs.update(path, fields)
    else await docs.set(path, { ...fields, createdAt: STAMP })
    // The world now points at the new snapshot; the old one can go. If this
    // fails, stale chunks are left behind, which costs storage and nothing else.
    if (previous && previous.id !== snapshot.id) await deleteSnapshot(uid, id, previous).catch(() => {})
    return id
  }

  return {
    saveWorld,
    readWorld,

    async listWorlds(uid: string): Promise<WorldListing[]> {
      return (await docs.list(worldsPath(uid))).map((d) => listing(d.id, d.data))
    },

    async renameWorld(uid: string, worldId: string, name: string): Promise<void> {
      const problem = validName(name)
      if (problem) throw new Error(problem)
      await docs.update(`${worldsPath(uid)}/${worldId}`, { name: name.trim(), updatedAt: STAMP })
    },

    /** A copy with a new id and new times: the whole saved state, under the same owner. Returns the new id. */
    async duplicateWorld(uid: string, worldId: string, name: string): Promise<string> {
      const { raw, body } = await readWorld(uid, worldId)
      return saveWorld(uid, name, readHead(raw), body)
    },

    async deleteWorld(uid: string, worldId: string): Promise<void> {
      // Chunks first: a world document with no chunks can't be opened, but
      // chunks with no world document would be invisible clutter.
      const main = await docs.get(`${worldsPath(uid)}/${worldId}`)
      await deleteSnapshot(uid, worldId, main?.snapshot as SnapshotRef | undefined)
      await docs.batch([{ delete: `${worldsPath(uid)}/${worldId}` }])
    },
  }
}

/** Firestore as a `Docs`. Firebase is required at call time, not import time, so a build without .env still loads. */
export function firestoreDocs(): Docs {
  const db = () => requireFirebase().db
  const stamp = (data: DocData) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === STAMP ? serverTimestamp() : v]))
  return {
    newId: (path) => doc(collection(db(), path)).id,
    get: async (path) => {
      const s = await getDoc(doc(db(), path))
      return s.exists() ? s.data() : null
    },
    list: async (path) => (await getDocs(query(collection(db(), path), orderBy('updatedAt', 'desc')))).docs.map((d) => ({ id: d.id, data: d.data() })),
    set: (path, data) => setDoc(doc(db(), path), stamp(data)),
    update: (path, data) => updateDoc(doc(db(), path), stamp(data)),
    batch: async (ops) => {
      if (ops.length === 1 && 'delete' in ops[0]) return deleteDoc(doc(db(), ops[0].delete))
      const b = writeBatch(db())
      for (const op of ops) {
        if ('delete' in op) b.delete(doc(db(), op.delete))
        else b.set(doc(db(), op.set), stamp(op.data))
      }
      await b.commit()
    },
  }
}

export const firestoreWorlds = worldsApi(firestoreDocs())
