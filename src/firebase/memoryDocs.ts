import { STAMP, type DocData, type Docs } from './worlds'

/**
 * A document store in memory, standing in for Firestore where Firestore can't
 * be reached: the Node tests of saving and loading, and — in dev builds only —
 * the Build page's world menu in a headless browser, where nobody can sign in.
 *
 * It refuses what Firestore would: a document over 1 MiB (estimated as its
 * JSON, which is close for strings), and any write firestore.rules would
 * reject — the owner in the document not matching the path, a world without a
 * 1–120 character name or an integer version, a chunk whose data isn't a
 * string of at most 1,000,000 characters. So a test that passes here has
 * passed the same checks the rules make.
 */

const LIMIT = 1_048_576

export type MemoryDocs = Docs & { docs: Map<string, DocData>; writes: number }

/**
 * `persist`, a localStorage key, keeps the store across a page reload — for a
 * headless test of save → reload → open. Dates are revived on the way back.
 */
export function memoryDocs(persist?: string): MemoryDocs {
  const store = new Map<string, DocData>()
  const revive = (d: DocData) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (k === 'createdAt' || k === 'updatedAt') && typeof v === 'string' ? new Date(v) : v]))
  if (persist) {
    try {
      for (const [k, v] of JSON.parse(localStorage.getItem(persist) ?? '[]') as [string, DocData][]) store.set(k, revive(v))
    } catch {
      // Nothing saved yet, or storage blocked: start empty.
    }
  }
  const flush = () => {
    if (!persist) return
    try {
      localStorage.setItem(persist, JSON.stringify([...store.entries()]))
    } catch {
      // Storage full or blocked: the store still works for this page.
    }
  }
  let next = 0
  const check = (path: string, data: DocData) => {
    const size = JSON.stringify(data).length
    if (size > LIMIT) throw Object.assign(new Error(`Document too large: ${size} bytes`), { code: 'invalid-argument' })
    const m = path.match(/^users\/([^/]+)\/worlds\/[^/]+(\/chunks\/[^/]+)?$/)
    if (!m) throw Object.assign(new Error(`No rule allows ${path}`), { code: 'permission-denied' })
    const deny = () => {
      throw Object.assign(new Error(`Rules reject ${path}`), { code: 'permission-denied' })
    }
    if (data.ownerUid !== m[1]) deny()
    if (m[2]) {
      if (typeof data.data !== 'string' || data.data.length > 1_000_000 || !Number.isInteger(data.index)) deny()
    } else if (typeof data.name !== 'string' || !data.name.length || data.name.length > 120 || !Number.isInteger(data.version)) deny()
  }
  const stamp = (data: DocData) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === STAMP ? new Date(Date.now() + next++) : v]))
  const docs: MemoryDocs = {
    docs: store,
    writes: 0,
    newId: () => `m${(next++).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    get: async (path) => (store.has(path) ? structuredClone(store.get(path)!) : null),
    list: async (path) =>
      [...store.entries()]
        .filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
        .map(([p, data]) => ({ id: p.slice(path.length + 1), data: structuredClone(data) }))
        .sort((a, b) => Number(b.data.updatedAt) - Number(a.data.updatedAt)),
    set: async (path, data) => {
      const d = stamp(data)
      check(path, d)
      store.set(path, d)
      docs.writes++
      flush()
    },
    update: async (path, data) => {
      if (!store.has(path)) throw Object.assign(new Error('No document to update'), { code: 'not-found' })
      const d = { ...store.get(path)!, ...stamp(data) }
      check(path, d)
      store.set(path, d)
      docs.writes++
      flush()
    },
    batch: async (ops) => {
      // All or none: check everything first.
      const staged = ops.map((op) => ('delete' in op ? op : { set: op.set, data: stamp(op.data) }))
      for (const op of staged) if ('set' in op) check(op.set, op.data)
      for (const op of staged) {
        if ('delete' in op) store.delete(op.delete)
        else store.set(op.set, op.data)
        docs.writes++
      }
      flush()
    },
  }
  return docs
}
