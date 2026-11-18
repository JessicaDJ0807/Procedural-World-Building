import { mulberry32 } from '../noise'

/**
 * A parametric building, as a list of parts.
 *
 * No meshes here: a building is boxes and one prism, each with a position, a
 * size and a colour, in the building's own frame — x across the front, z
 * toward the street, y up, origin at the centre of the footprint on the
 * ground. The renderer draws every part of every building with one instanced
 * mesh per kind, so a site of hundreds of buildings is a dozen draw calls, and
 * a test can count balconies without a GPU.
 *
 * The parameters, and what each one is allowed to change:
 *
 *   width, depth      the footprint
 *   floors            3 world units each; sets the height
 *   roof              flat (a parapet, sometimes a plant room) or pitched
 *                     (a gable, its ridge along the longer side)
 *   roofSlope         degrees, for a pitched roof
 *   balconyChance     per bay on the front and back: a bay that gets them has
 *                     one on every floor above the ground, stacked
 *   facadeVariation   0 is a perfectly regular building. Raising it widens
 *                     the bay, varies the window size, leaves some bays blank,
 *                     adds floor bands, may set the top floor back, and draws
 *                     the colour from a wider range, and knocks some balconies
 *                     out of their stacks — each by a seeded roll,
 *                     so the same seed is the same building.
 */
export type RoofType = 'flat' | 'pitched'

export type BuildingParams = {
  width: number
  depth: number
  floors: number
  roof: RoofType
  roofSlope: number
  balconyChance: number
  facadeVariation: number
  seed: number
}

export type PartKind = 'wall' | 'band' | 'window' | 'door' | 'balcony' | 'rail' | 'slab' | 'parapet' | 'gable' | 'plant'
export const PART_KINDS: PartKind[] = ['wall', 'band', 'window', 'door', 'balcony', 'rail', 'slab', 'parapet', 'gable', 'plant']

export type Part = {
  kind: PartKind
  /** Centre, in the building's frame. A gable's y is its base. */
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  /** Rotation about y; only gables use it, to turn the ridge. */
  rot: number
  colour: number
}

export type BuildingResult = {
  parts: Part[]
  height: number
  windows: number
  balconies: number
  /** True when the top floor was set back. */
  setback: boolean
}

export const FLOOR = 3

/** Muted stone, render and slate — the palette's whole range. */
export const WALL_COLOURS = [0xc9c3b6, 0xbdb6a8, 0xa9a59c, 0xb4b8b4, 0x9ea6a8, 0xc2b9a7, 0x939d95, 0xd2cdc2]
export const ROOF_COLOURS = [0x5d6670, 0x6b6560, 0x4f5a63, 0x726a62]
const GLASS = 0x3c4b58
const DOOR = 0x4a4038
const METAL = 0x7f8588

function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k))
  const b = Math.min(255, Math.round((hex & 255) * k))
  return (r << 16) | (g << 8) | b
}

export function buildBuilding(params: BuildingParams): BuildingResult {
  const rand = mulberry32(params.seed * 9301 + 49297)
  const v = params.facadeVariation
  const w = params.width
  const d = params.depth
  const floors = Math.max(1, Math.round(params.floors))
  const height = floors * FLOOR
  const parts: Part[] = []
  const add = (kind: PartKind, x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: number, rot = 0) =>
    parts.push({ kind, x, y, z, sx, sy, sz, rot, colour })

  // Colour: with no variation every building is the first stone; the range
  // opens up as variation rises, and lightness wanders a little within it.
  const pick = Math.floor(rand() * Math.max(1, Math.round(1 + v * (WALL_COLOURS.length - 1))))
  const wall = shade(WALL_COLOURS[pick % WALL_COLOURS.length], 1 + (rand() - 0.5) * 0.12 * v)
  const roofColour = ROOF_COLOURS[Math.floor(rand() * ROOF_COLOURS.length * Math.max(v, 0.26)) % ROOF_COLOURS.length]

  const setback = params.roof === 'flat' && floors >= 4 && rand() < v * 0.6
  const lowerFloors = setback ? floors - 1 : floors
  add('wall', 0, (lowerFloors * FLOOR) / 2, 0, w, lowerFloors * FLOOR, d, wall)
  const inset = 1.4
  const topW = Math.max(2, w - inset * 2)
  const topD = Math.max(2, d - inset * 2)
  if (setback) add('wall', 0, lowerFloors * FLOOR + FLOOR / 2, 0, topW, FLOOR, topD, shade(wall, 0.96))

  if (rand() < v * 0.8 && floors > 1) {
    for (let f = 1; f < lowerFloors; f++) add('band', 0, f * FLOOR, 0, w + 0.24, 0.2, d + 0.24, shade(wall, 0.82))
  }

  // Bays: one window per bay, centred in it. Wider bays as variation rises.
  const bay = 2.8 + v * rand() * 1.6
  const winW = Math.min(bay - 0.8, 1.3 + (rand() - 0.5) * v * 0.8)
  const winH = 1.6
  const skip = v * 0.22
  let windows = 0
  let balconies = 0
  type Face = { nx: number; nz: number; length: number; front: boolean; balconies: boolean }
  const faces: Face[] = [
    { nx: 0, nz: 1, length: w, front: true, balconies: true },
    { nx: 0, nz: -1, length: w, front: false, balconies: true },
    { nx: 1, nz: 0, length: d, front: false, balconies: false },
    { nx: -1, nz: 0, length: d, front: false, balconies: false },
  ]
  for (const face of faces) {
    const bays = Math.max(1, Math.floor((face.length - 0.8) / bay))
    const span = face.length / bays
    const door = face.front ? Math.floor(bays / 2) : -1
    // Balconies are decided per bay and stacked, as real buildings stack them;
    // rolled per window they scattered, and seed 1's front got one of sixteen.
    const balconyBay = Array.from({ length: bays }, () => face.balconies && rand() < params.balconyChance)
    for (let f = 0; f < floors; f++) {
      const top = setback && f === floors - 1
      const halfW = top ? topW / 2 : w / 2
      const halfD = top ? topD / 2 : d / 2
      const length = face.nz !== 0 ? halfW * 2 : halfD * 2
      const n = top ? Math.max(1, Math.floor((length - 0.8) / bay)) : bays
      const s = top ? length / n : span
      for (let b = 0; b < n; b++) {
        const along = -length / 2 + s * (b + 0.5)
        const ox = face.nx !== 0 ? face.nx * (halfW + 0.04) : along
        const oz = face.nz !== 0 ? face.nz * (halfD + 0.04) : along
        const sx = face.nx !== 0 ? 0.1 : winW
        const sz = face.nz !== 0 ? 0.1 : winW
        if (f === 0 && b === door && !top) {
          add('door', ox, 1.1, oz, face.nx !== 0 ? 0.1 : 1.3, 2.2, face.nz !== 0 ? 0.1 : 1.3, DOOR)
          continue
        }
        if (rand() < skip) continue
        add('window', ox, f * FLOOR + 1.65, oz, sx, winH, sz, GLASS)
        windows++
        if (balconyBay[b] && f > 0 && !top && rand() >= v * 0.3) {
          const bw = winW + 0.8
          const depth = 1.0
          const bx = face.nx !== 0 ? face.nx * (halfW + depth / 2) : along
          const bz = face.nz !== 0 ? face.nz * (halfD + depth / 2) : along
          add('balcony', bx, f * FLOOR + 0.08, bz, face.nx !== 0 ? depth : bw, 0.16, face.nz !== 0 ? depth : bw, shade(wall, 0.9))
          const rx = face.nx !== 0 ? face.nx * (halfW + depth) : along
          const rz = face.nz !== 0 ? face.nz * (halfD + depth) : along
          add('rail', rx, f * FLOOR + 0.6, rz, face.nx !== 0 ? 0.06 : bw, 0.9, face.nz !== 0 ? 0.06 : bw, METAL)
          balconies++
        }
      }
    }
  }

  if (params.roof === 'flat') {
    const rw = setback ? topW : w
    const rd = setback ? topD : d
    const y = height
    add('slab', 0, y + 0.06, 0, rw, 0.12, rd, roofColour)
    const t = 0.28
    const ph = 0.6
    add('parapet', 0, y + ph / 2, rd / 2 - t / 2, rw, ph, t, shade(wall, 0.92))
    add('parapet', 0, y + ph / 2, -rd / 2 + t / 2, rw, ph, t, shade(wall, 0.92))
    add('parapet', rw / 2 - t / 2, y + ph / 2, 0, t, ph, rd - t * 2, shade(wall, 0.92))
    add('parapet', -rw / 2 + t / 2, y + ph / 2, 0, t, ph, rd - t * 2, shade(wall, 0.92))
    if (floors >= 3 && rand() < 0.6) {
      const pw = Math.min(rw * 0.35, 4)
      const pd = Math.min(rd * 0.35, 4)
      add('plant', (rand() - 0.5) * (rw - pw - 1), y + 0.9, (rand() - 0.5) * (rd - pd - 1), pw, 1.8, pd, METAL)
    }
  } else {
    // The ridge runs along the longer side, so the roof rises across the short one.
    const overhang = 0.4
    const alongX = w >= d
    const span = alongX ? d : w
    const rise = (span / 2) * Math.tan((params.roofSlope * Math.PI) / 180)
    const lx = (alongX ? w : d) + overhang * 2
    const lz = span + overhang * 2
    add('gable', 0, height, 0, lx, rise, lz, roofColour, alongX ? 0 : Math.PI / 2)
  }

  return { parts, height: height + (params.roof === 'pitched' ? (Math.min(w, d) / 2) * Math.tan((params.roofSlope * Math.PI) / 180) : 0.6), windows, balconies, setback }
}
