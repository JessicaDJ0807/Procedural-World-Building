import { SHAPES, type ShapeName } from '../shapes'
import { ACCENT_BLUE } from '../theme'
import { bool, hex, isRecord, num, pick, type ConfigSpec } from './spec'

export type ObjectSettings = {
  shape: ShapeName
  spinSpeed: number
  scale: number
  color: string
  metalness: number
  roughness: number
  wireframe: boolean
}

const SHAPE_NAMES = SHAPES.map((s) => s.value)

export function defaultObjectSettings(): ObjectSettings {
  return {
    shape: 'box',
    spinSpeed: 0,
    scale: 1,
    color: ACCENT_BLUE,
    metalness: 0.2,
    roughness: 0.35,
    wireframe: false,
  }
}

/**
 * Orientation is deliberately not stored. It lives in a ref the gizmo mutates
 * on every pointermove, never in state, because a React round trip per frame
 * would be far too hot — and a saved camera angle is not what makes two worlds
 * different.
 */
function parse(raw: unknown): { settings: ObjectSettings; repairs: string[] } {
  const repairs: string[] = []
  const d = defaultObjectSettings()
  if (!isRecord(raw)) {
    return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  }
  const shape = pick<ShapeName>(raw.shape, SHAPE_NAMES, d.shape)
  if (raw.shape !== undefined && shape !== raw.shape) {
    repairs.push('unknown shape, reset to Box')
  }
  const color = hex(raw.color, d.color)
  if (raw.color !== undefined && color !== raw.color) repairs.push('colour was not a hex value')

  return {
    settings: {
      shape,
      spinSpeed: num(raw.spinSpeed, 0, 180, d.spinSpeed),
      scale: num(raw.scale, 0.2, 3, d.scale),
      color,
      metalness: num(raw.metalness, 0, 1, d.metalness),
      roughness: num(raw.roughness, 0, 1, d.roughness),
      wireframe: bool(raw.wireframe, d.wireframe),
    },
    repairs,
  }
}

export const objectSpec: ConfigSpec<ObjectSettings> = {
  topic: 'objects',
  schemaVersion: 1,
  defaults: defaultObjectSettings,
  parse,
  summary: (s) => {
    const label = SHAPES.find((o) => o.value === s.shape)?.label ?? s.shape
    return `${label} · ${s.scale.toFixed(2)}×${s.wireframe ? ' · wireframe' : ''}`
  },
}
