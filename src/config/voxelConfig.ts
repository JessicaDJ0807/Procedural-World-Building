import { CSG_OPS, SCENES, SHAPES, getShape, type CsgNode, type CsgOpName, type ShapeName } from '../density'
import { PALETTES, type PaletteName } from '../palette'

/**
 * Which mesher the page is using. It lives here rather than in VoxelPage
 * because this module owns the saved-document contract, and VoxelPage imports
 * from it — the other direction would be a cycle.
 */
export type RenderMode = 'surface' | 'dual' | 'marching' | 'blocks'

export const CONFIG_SCHEMA_VERSION = 1

export const DEFAULT_RESOLUTION = 56
export const MIN_RESOLUTION = 8
export const MAX_RESOLUTION = 96

/**
 * A node as stored: the live `CsgNode` without its `id`.
 *
 * The id is a React key and a lookup handle, regenerated on every load — it
 * describes the editing session, not the shape. Dropping it also removes the
 * duplicate-id hazard at the data level rather than only at the generator.
 */
export type StoredNode = Omit<CsgNode, 'id'>

/** Everything needed to rebuild the page. Nothing derived from it. */
export type VoxelSettings = {
  sceneName: string
  nodes: StoredNode[]
  mode: RenderMode
  greedy: boolean
  resolution: number
  iso: number
  spin: number
  showBounds: boolean
  palette: PaletteName
}

/** The Firestore document at users/{uid}/configs/{configId}. */
export type VoxelConfig = {
  id: string
  name: string
  topic: 'voxels'
  schemaVersion: number
  ownerUid: string
  createdAt: Date | null
  updatedAt: Date | null
  storagePath?: string
  settings: VoxelSettings
  /** What parseSettings had to substitute. Empty for a document written by this build. */
  repairs: string[]
}

const RENDER_MODES: RenderMode[] = ['surface', 'dual', 'marching', 'blocks']
const SHAPE_NAMES = SHAPES.map((s) => s.value)
const OP_NAMES = CSG_OPS.map((o) => o.value)
const SCENE_NAMES = SCENES.map((s) => s.value)
const PALETTE_NAMES = PALETTES.map((p) => p.value)

export function defaultSettings(): VoxelSettings {
  return {
    sceneName: SCENES[0].value,
    nodes: SCENES[0].nodes.map((node) => structuredClone(node)),
    mode: 'surface',
    greedy: true,
    resolution: DEFAULT_RESOLUTION,
    iso: 0,
    spin: 0,
    showBounds: true,
    palette: 'terrain',
  }
}

/**
 * Strip a live page state down to what is worth storing.
 *
 * The field, the mesh and the colour ramp are all deliberately absent: the
 * world is deterministic, so every one of them is reproducible from these
 * values alone. A 96³ field is 3.4 MB of Float32Array and Firestore's document
 * limit is 1 MB, so storing it is not merely wasteful — it does not fit.
 */
export function toSettings(state: {
  sceneName: string
  nodes: CsgNode[]
  mode: RenderMode
  greedy: boolean
  resolution: number
  iso: number
  spin: number
  showBounds: boolean
  palette: PaletteName
}): VoxelSettings {
  return {
    sceneName: state.sceneName,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    nodes: state.nodes.map(({ id, ...rest }) => ({
      ...rest,
      params: { ...rest.params },
      offset: { ...rest.offset },
    })),
    mode: state.mode,
    greedy: state.greedy,
    resolution: state.resolution,
    iso: state.iso,
    spin: state.spin,
    showBounds: state.showBounds,
    palette: state.palette,
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseNode(raw: unknown, repairs: string[], index: number): StoredNode | null {
  if (!isRecord(raw)) {
    repairs.push(`shape ${index + 1} was not an object and was dropped`)
    return null
  }
  const shape = pick<ShapeName>(raw.shape, SHAPE_NAMES, 'sphere')
  if (shape !== raw.shape) repairs.push(`shape ${index + 1} had an unknown type, reset to Sphere`)

  // Parameters are per-shape, so an unrecognised key is meaningless to this
  // shape — rebuild from its own definition rather than carrying it across.
  const rawParams = isRecord(raw.params) ? raw.params : {}
  const params: Record<string, number> = {}
  for (const param of getShape(shape).params) {
    params[param.key] = num(rawParams[param.key], param.min, param.max, param.defaultValue)
  }

  const offset = isRecord(raw.offset) ? raw.offset : {}
  return {
    shape,
    params,
    op: pick<CsgOpName>(raw.op, OP_NAMES, 'union'),
    blend: num(raw.blend, 0, 0.5, 0),
    offset: {
      x: num(offset.x, -1.2, 1.2, 0),
      y: num(offset.y, -1.2, 1.2, 0),
      z: num(offset.z, -1.2, 1.2, 0),
    },
    seed: Math.trunc(num(raw.seed, 0, 1e6, 1)),
    enabled: bool(raw.enabled, true),
  }
}

/**
 * Turn whatever came back from Firestore into settings the page can mount.
 *
 * Everything here is untrusted: a document can be hand-edited in the console,
 * written by an older build, or simply be a different shape than expected. Each
 * field falls back to a default rather than throwing, and every substitution is
 * recorded, so the UI can say what it had to repair instead of silently showing
 * something other than what was saved.
 */
export function parseSettings(raw: unknown): { settings: VoxelSettings; repairs: string[] } {
  const repairs: string[] = []
  const defaults = defaultSettings()
  if (!isRecord(raw)) {
    return { settings: defaults, repairs: ['the document had no settings; defaults were used'] }
  }

  let nodes: StoredNode[] = []
  if (Array.isArray(raw.nodes)) {
    nodes = raw.nodes
      .map((node, i) => parseNode(node, repairs, i))
      .filter((node): node is StoredNode => node !== null)
  }
  if (nodes.length === 0) {
    repairs.push('no usable shapes in the document; the default scene was used')
    nodes = defaults.nodes
  }

  const sceneName = pick(raw.sceneName, SCENE_NAMES, defaults.sceneName)
  if (sceneName !== raw.sceneName) repairs.push('unknown scene name, reset to the default')

  const resolution = Math.round(num(raw.resolution, MIN_RESOLUTION, MAX_RESOLUTION, DEFAULT_RESOLUTION))
  if (typeof raw.resolution === 'number' && raw.resolution !== resolution) {
    repairs.push(`resolution ${raw.resolution} is out of range, clamped to ${resolution}`)
  }

  return {
    settings: {
      sceneName,
      nodes,
      mode: pick<RenderMode>(raw.mode, RENDER_MODES, defaults.mode),
      greedy: bool(raw.greedy, defaults.greedy),
      resolution,
      iso: num(raw.iso, -0.3, 0.3, defaults.iso),
      spin: num(raw.spin, 0, 90, defaults.spin),
      showBounds: bool(raw.showBounds, defaults.showBounds),
      palette: pick<PaletteName>(raw.palette, PALETTE_NAMES, defaults.palette),
    },
    repairs,
  }
}

/** Fresh ids on load — see StoredNode. */
export function withIds(nodes: StoredNode[]): CsgNode[] {
  return nodes.map((node) => ({ ...node, id: newNodeId() }))
}

/**
 * `crypto.randomUUID` rather than a module-level counter. The counter restarted
 * at zero on every reload, so loading a config whose shapes were saved as
 * node-0..node-3 guaranteed the next added shape collided with one of them.
 * Needs a secure context, which localhost and Firebase Hosting both are.
 */
export function newNodeId(): string {
  return crypto.randomUUID()
}

/** The exact bytes uploaded to Storage, and the same ones a download produces. */
export function configToJson(name: string, settings: VoxelSettings): string {
  return JSON.stringify(
    { name, topic: 'voxels', schemaVersion: CONFIG_SCHEMA_VERSION, settings },
    null,
    2,
  )
}
