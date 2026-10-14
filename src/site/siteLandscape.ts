import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Point, Site } from './siteData'
import { SCENE } from './siteLook'

/**
 * The south of the island — the Cornell Tech campus lawn, Southpoint Park and
 * Four Freedoms Park — as a landscape: ground cover, gentle relief, trees,
 * shrubs and flowers.
 *
 * The city's planimetric layers stop at the state parks' edge, so in the
 * island snapshot all of this was unmapped ground, drawn bare. The landscape
 * file (scripts/fetch-roosevelt-landscape.mjs) fills it from open data where
 * open data exists, and this module fills the rest procedurally:
 *
 *   real data where it exists → procedural filling where it doesn't
 *
 * - **Land cover** on a 1 m grid, in this order: the parks' outlines; lawns,
 *   planted beds, woods, grassland and the shingle shore from OpenStreetMap;
 *   then the city's roads, sidewalks, parking, medians and buildings, and
 *   OSM's footpaths at their width, over everything. What is still unmapped
 *   is naturalized green inside Southpoint Park, whose OSM lawns leave gaps
 *   that are meadow and planting on the ground, and paving everywhere else —
 *   Four Freedoms' granite, the campus plazas.
 * - **Relief** from the city's ground spot heights, smoothed (a Gaussian
 *   kernel, 18 m), above the median height of the points on paths and roads.
 *   It falls to zero within 10 m of any path, road or building, so the flat
 *   city layers still meet the ground exactly.
 * - **Slope** from the smoothed heights before that falloff — the slope the
 *   data says the land has, not the edge a lawn gets where it meets a path.
 * - **Trees.** Every mapped tree — the city's first, then OSM's — stands where
 *   it is mapped. Procedural trees only fill green that the data leaves
 *   empty: groves where a low-frequency noise is high, clearings where it is
 *   low, a rare specimen on open lawn, denser on slopes and in woods, and
 *   never within 5 m of another tree or 3 m of a path.
 * - **Shrubs and flowers**, clustered the same way: few on managed lawn, more
 *   on slopes and in naturalized ground, most in planted beds.
 *
 * Managed lawn reads clean — one even sage, ordered trees — and naturalized
 * ground varied, with denser, more mixed planting. All of it is scenery: no
 * growth model runs on it, and it doesn't touch the campus simulation or the
 * roadside study.
 */

export type LandscapeData = {
  fetched: string
  zoneZ: number
  sources: Record<string, string>
  trees: { x: number; z: number; src: 'nyc' | 'osm'; dbh?: number; species?: string; leaf?: string }[]
  areas: { kind: 'lawn' | 'garden' | 'wood' | 'meadow' | 'shingle' | 'park' | 'plaza'; name?: string; ring: Point[] }[]
  paths: { kind: string; width: number; line: Point[] }[]
  heights: [number, number, number][]
}

export async function loadLandscape(): Promise<LandscapeData> {
  const res = await fetch('/site/roosevelt-landscape.json')
  if (!res.ok) throw new Error(`Landscape: HTTP ${res.status}`)
  return res.json()
}

/** Land cover, one code per 1 m cell. */
export const COVER = {
  WATER: 0,
  /** Drawn by the city layers already: roads, sidewalks, parking, medians, buildings. */
  CITY: 1,
  PLAZA: 2,
  PATH: 3,
  LAWN: 4,
  GARDEN: 5,
  NATURAL: 6,
  WOOD: 7,
  ROCK: 8,
} as const
const GREEN = (c: number) => c >= COVER.LAWN && c <= COVER.WOOD
export const COVER_NAMES = ['water', 'city layers', 'paving', 'path', 'managed lawn', 'planted bed', 'naturalized', 'wood', 'rock shore']

/** Slope bands, from the data's smoothed heights (rise over run). */
export const GENTLE = 0.04
export const STEEP = 0.1

const SIGMA = 18
const FALLOFF = 10
const MESH = 2

const PALETTE = {
  lawn: '#86905e',
  garden: '#76804f',
  meadowDry: '#8f905d',
  meadowGreen: '#717b4b',
  wood: '#5f6943',
  soil: '#8b7c60',
  rock: '#9b958b',
  plaza: '#c2b6a2',
  path: '#b7ab96',
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const hash2 = (i: number, j: number, salt: number) => hash(Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(salt, 83492791))

/** Smooth value noise, 0–1, coherent at the scale given in metres. */
function noise(x: number, z: number, scale: number, salt: number): number {
  const u = x / scale
  const v = z / scale
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fu = u - i
  const fv = v - j
  const su = fu * fu * (3 - 2 * fu)
  const sv = fv * fv * (3 - 2 * fv)
  const a = hash2(i, j, salt)
  const b = hash2(i + 1, j, salt)
  const c = hash2(i, j + 1, salt)
  const d = hash2(i + 1, j + 1, salt)
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv
}
const fbm = (x: number, z: number, scale: number, salt: number) => noise(x, z, scale, salt) * 0.65 + noise(x, z, scale / 2.3, salt + 7) * 0.35
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export type Landscape = {
  group: THREE.Group
  stats: {
    cells: number[]
    slope: [number, number, number]
    base: number
    relief: number
    knownTrees: number
    proceduralTrees: number
    shrubs: number
    flowers: number
    triangles: number
    ms: number
  }
  /** Whether a point falls in the landscape's zone — where it, not the generic context trees, plants the island. */
  covers: (x: number, z: number) => boolean
  dispose: () => void
}

export function buildLandscape(site: Site, data: LandscapeData): Landscape {
  const start = performance.now()
  const zone = site.island.filter((p) => p[1] >= data.zoneZ)
  const x0 = Math.floor(Math.min(...zone.map((p) => p[0]))) - 2
  const x1 = Math.ceil(Math.max(...zone.map((p) => p[0]))) + 2
  const z0 = data.zoneZ
  const z1 = Math.ceil(Math.max(...site.island.map((p) => p[1]))) + 2
  const W = x1 - x0
  const H = z1 - z0
  const cover = new Uint8Array(W * H)

  // --- land cover: later layers overwrite earlier ones ---
  /** Scanline fill, even–odd over all the rings, so holes stay holes. */
  const fill = (rings: Point[][], code: number, where?: (c: number) => boolean) => {
    const xs: number[] = []
    // Only the polygon's own rows.
    let lo = Infinity
    let hi = -Infinity
    for (const ring of rings) {
      for (const p of ring) {
        lo = Math.min(lo, p[1])
        hi = Math.max(hi, p[1])
      }
    }
    for (let j = Math.max(0, Math.floor(lo - z0)); j < Math.min(H, Math.ceil(hi - z0) + 1); j++) {
      const z = z0 + j + 0.5
      xs.length = 0
      for (const ring of rings) {
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const [xa, za] = ring[a]
          const [xb, zb] = ring[b]
          if (za > z !== zb > z) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za))
        }
      }
      if (xs.length < 2) continue
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ia = Math.max(0, Math.ceil(xs[k] - x0 - 0.5))
        const ib = Math.min(W - 1, Math.floor(xs[k + 1] - x0 - 0.5))
        for (let i = ia; i <= ib; i++) {
          const c = j * W + i
          if (!where || where(cover[c])) cover[c] = code
        }
      }
    }
  }
  const UNMAPPED = 255
  fill([site.island], UNMAPPED)
  const onLand = (c: number) => c !== COVER.WATER
  // Southpoint Park's unmapped ground is naturalized; elsewhere it is paving.
  const SOUTHPOINT = 254
  for (const a of data.areas) if (a.kind === 'park' && a.name === 'Southpoint Park') fill([a.ring], SOUTHPOINT, onLand)
  const order: [LandscapeData['areas'][number]['kind'], number][] = [
    ['lawn', COVER.LAWN],
    ['meadow', COVER.NATURAL],
    ['garden', COVER.GARDEN],
    ['wood', COVER.WOOD],
    ['shingle', COVER.ROCK],
    ['plaza', COVER.PLAZA],
  ]
  for (const [kind, code] of order) for (const a of data.areas) if (a.kind === kind) fill([a.ring], code, onLand)
  // The city's green polygons are lawn; its hard ones, and the buildings, it draws itself.
  for (const kind of ['recreation', 'park', 'openSpace'] as const) for (const p of site.surfaces[kind] ?? []) fill(p, COVER.LAWN, onLand)
  for (const kind of ['roadbed', 'sidewalk', 'parking', 'median', 'vacant'] as const) for (const p of site.surfaces[kind] ?? []) fill(p, COVER.CITY, onLand)
  for (const b of site.buildings) fill(b.outline, COVER.CITY, onLand)
  // Footpaths, at their width, over everything but the city's own surfaces.
  for (const path of data.paths) {
    const r = path.width / 2
    for (let k = 0; k + 1 < path.line.length; k++) {
      const [ax, az] = path.line[k]
      const [bx, bz] = path.line[k + 1]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const ia = Math.max(0, Math.floor(Math.min(ax, bx) - r - x0))
      const ib = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r - x0))
      const ja = Math.max(0, Math.floor(Math.min(az, bz) - r - z0))
      const jb = Math.min(H - 1, Math.ceil(Math.max(az, bz) + r - z0))
      for (let j = ja; j <= jb; j++) {
        for (let i = ia; i <= ib; i++) {
          const x = x0 + i + 0.5
          const z = z0 + j + 0.5
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
          const c = j * W + i
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= r && cover[c] !== COVER.WATER && cover[c] !== COVER.CITY) cover[c] = COVER.PATH
        }
      }
    }
  }
  for (let c = 0; c < cover.length; c++) {
    if (cover[c] === UNMAPPED) cover[c] = COVER.PLAZA
    else if (cover[c] === SOUTHPOINT) cover[c] = COVER.NATURAL
  }

  // --- distance to anything not green (chamfer, in metres) ---
  const dist = new Float32Array(W * H)
  for (let c = 0; c < cover.length; c++) dist[c] = GREEN(cover[c]) ? 1e9 : 0
  const D = Math.SQRT2
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i
      if (!dist[c]) continue
      let d = dist[c]
      if (i > 0) d = Math.min(d, dist[c - 1] + 1)
      if (j > 0) {
        d = Math.min(d, dist[c - W] + 1)
        if (i > 0) d = Math.min(d, dist[c - W - 1] + D)
        if (i < W - 1) d = Math.min(d, dist[c - W + 1] + D)
      }
      dist[c] = d
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const c = j * W + i
      if (!dist[c]) continue
      let d = dist[c]
      if (i < W - 1) d = Math.min(d, dist[c + 1] + 1)
      if (j < H - 1) {
        d = Math.min(d, dist[c + W] + 1)
        if (i < W - 1) d = Math.min(d, dist[c + W + 1] + D)
        if (i > 0) d = Math.min(d, dist[c + W - 1] + D)
      }
      dist[c] = d
    }
  }
  const cellAt = (x: number, z: number) => {
    const i = Math.floor(x - x0)
    const j = Math.floor(z - z0)
    return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i
  }

  // --- relief: the data's heights, smoothed, above the paths' level ---
  const onHard = data.heights.filter(([x, z]) => {
    const c = cellAt(x, z)
    return c >= 0 && !GREEN(cover[c])
  })
  const levels = (onHard.length ? onHard : data.heights).map((h) => h[2]).sort((a, b) => a - b)
  const base = levels[Math.floor(levels.length / 2)] ?? 0
  const VW = Math.ceil(W / MESH) + 1
  const VH = Math.ceil(H / MESH) + 1
  const raw = new Float32Array(VW * VH).fill(base)
  for (let b = 0; b < VH; b++) {
    for (let a = 0; a < VW; a++) {
      const x = x0 + a * MESH
      const z = z0 + b * MESH
      // Only on land: most of the zone's box is river.
      const c = cellAt(Math.min(x, x1 - 1), Math.min(z, z1 - 1))
      if (c < 0 || cover[c] === COVER.WATER) continue
      // A faint pull to the base level, so far from every point the ground is flat, not undefined.
      let sw = 1e-4
      let sh = 1e-4 * base
      for (const [px, pz, e] of data.heights) {
        const d2 = (px - x) ** 2 + (pz - z) ** 2
        if (d2 > 9 * SIGMA * SIGMA) continue
        const w = Math.exp(-d2 / (2 * SIGMA * SIGMA))
        sw += w
        sh += w * e
      }
      raw[b * VW + a] = sh / sw
    }
  }
  const slopeAt = (x: number, z: number) => {
    const a = Math.min(VW - 2, Math.max(1, Math.round((x - x0) / MESH)))
    const b = Math.min(VH - 2, Math.max(1, Math.round((z - z0) / MESH)))
    const gx = (raw[b * VW + a + 1] - raw[b * VW + a - 1]) / (2 * MESH)
    const gz = (raw[(b + 1) * VW + a] - raw[(b - 1) * VW + a]) / (2 * MESH)
    return Math.hypot(gx, gz)
  }
  const height = new Float32Array(VW * VH)
  let relief = 0
  for (let b = 0; b < VH; b++) {
    for (let a = 0; a < VW; a++) {
      const c = cellAt(x0 + a * MESH, z0 + b * MESH)
      const d = c >= 0 ? dist[c] : 0
      const h = Math.max(0, raw[b * VW + a] - base) * smooth(0, FALLOFF, d)
      height[b * VW + a] = h
      relief = Math.max(relief, h)
    }
  }
  const heightAt = (x: number, z: number) => {
    const u = Math.min(VW - 1.001, Math.max(0, (x - x0) / MESH))
    const v = Math.min(VH - 1.001, Math.max(0, (z - z0) / MESH))
    const a = Math.floor(u)
    const b = Math.floor(v)
    const fu = u - a
    const fv = v - b
    const h = (p: number, q: number) => height[q * VW + p]
    return (h(a, b) * (1 - fu) + h(a + 1, b) * fu) * (1 - fv) + (h(a, b + 1) * (1 - fu) + h(a + 1, b + 1) * fu) * fv
  }

  // --- ground: a colour texture, one texel a cell, alpha where it is drawn ---
  const tex = new Uint8Array(W * H * 4)
  const col = new THREE.Color()
  const tint = new THREE.Color()
  const rgb = { r: 0, g: 0, b: 0 }
  const P = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof typeof PALETTE, THREE.Color>
  const cells = new Array(COVER_NAMES.length).fill(0)
  const slopeBands: [number, number, number] = [0, 0, 0]
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i
      const k = cover[c]
      cells[k]++
      if (k === COVER.WATER || k === COVER.CITY) continue
      const x = x0 + i + 0.5
      const z = z0 + j + 0.5
      const s = slopeAt(x, z)
      if (GREEN(k)) slopeBands[s < GENTLE ? 0 : s < STEEP ? 1 : 2]++
      const fine = noise(x, z, 3, 11)
      if (k === COVER.LAWN) col.copy(P.lawn).multiplyScalar(0.97 + fine * 0.06)
      else if (k === COVER.GARDEN) col.copy(P.garden).multiplyScalar(0.88 + fbm(x, z, 4, 12) * 0.22)
      else if (k === COVER.NATURAL) col.copy(P.meadowGreen).lerp(P.meadowDry, fbm(x, z, 14, 13)).multiplyScalar(0.9 + fine * 0.18)
      else if (k === COVER.WOOD) col.copy(P.wood).multiplyScalar(0.9 + fine * 0.16)
      else if (k === COVER.ROCK) col.copy(P.rock).multiplyScalar(0.88 + fine * 0.2)
      else if (k === COVER.PATH) col.copy(P.path)
      else col.copy(P.plaza).multiplyScalar(0.98 + fine * 0.04)
      // Steep naturalized ground: grass thins to soil.
      if ((k === COVER.NATURAL || k === COVER.WOOD) && s > STEEP) col.lerp(tint.copy(P.soil), Math.min(0.45, (s - STEEP) * 4) * fbm(x, z, 6, 14))
      const t = c * 4
      const srgb = col.getRGB(rgb, THREE.SRGBColorSpace)
      tex[t] = Math.round(srgb.r * 255)
      tex[t + 1] = Math.round(srgb.g * 255)
      tex[t + 2] = Math.round(srgb.b * 255)
      tex[t + 3] = 255
    }
  }
  // Bleed colour into the undrawn texels next to drawn ones: filtering
  // blends them in at every edge, and left black they drew a dark, ragged
  // fringe along the shore and the paths.
  for (let pass = 0; pass < 2; pass++) {
    const src = tex.slice()
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const t = (j * W + i) * 4
        if (src[t + 3] || src[t] || src[t + 1] || src[t + 2]) continue
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue
          const u = (jj * W + ii) * 4
          if (!src[u] && !src[u + 1] && !src[u + 2]) continue
          tex[t] = src[u]
          tex[t + 1] = src[u + 1]
          tex[t + 2] = src[u + 2]
          break
        }
      }
    }
  }
  const texture = new THREE.DataTexture(tex, W, H, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  // No mipmaps: averaged down, the alpha edge frayed into a sawtooth along
  // the shore under the alpha test. The colours are smooth enough not to shimmer.
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  // The ground mesh: a 2 m grid over the zone, displaced, only where it is drawn.
  const drawn = (a: number, b: number) => {
    for (let j = b * MESH - 1; j <= (b + 1) * MESH; j++) {
      for (let i = a * MESH - 1; i <= (a + 1) * MESH; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue
        const k = cover[j * W + i]
        if (k !== COVER.WATER && k !== COVER.CITY) return true
      }
    }
    return false
  }
  const positions = new Float32Array(VW * VH * 3)
  const uvs = new Float32Array(VW * VH * 2)
  for (let b = 0; b < VH; b++) {
    for (let a = 0; a < VW; a++) {
      const v = b * VW + a
      const x = x0 + a * MESH
      const z = z0 + b * MESH
      // 2 cm down, behind the city's roads and sidewalks where the 1 m cells
      // overlap their edges: those are drawn flat at 0, after it. A polygon
      // offset did the same for the eye but frayed the shadows along every
      // edge into a sawtooth.
      positions.set([x, height[v] - 0.02, z], v * 3)
      uvs.set([(x - x0) / W, (z - z0) / H], v * 2)
    }
  }
  const index: number[] = []
  for (let b = 0; b < VH - 1; b++) {
    for (let a = 0; a < VW - 1; a++) {
      if (!drawn(a, b)) continue
      const v = b * VW + a
      index.push(v, v + VW, v + 1, v + 1, v + VW, v + VW + 1)
    }
  }
  const groundGeo = new THREE.BufferGeometry()
  groundGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  groundGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  groundGeo.setIndex(index)
  groundGeo.computeVertexNormals()
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({
      map: texture,
      alphaTest: 0.5,
    }),
  )
  ground.renderOrder = -0.5
  ground.receiveShadow = true

  // --- planting ---
  type Spot = { x: number; z: number; s: number; kind: number; colour: THREE.Color }
  const treeSpots: { x: number; z: number; s: number; arch: number; colour: THREE.Color }[] = []
  const grid = new Map<number, Point[]>()
  const key = (x: number, z: number) => Math.floor(x / 6) * 100003 + Math.floor(z / 6)
  const near = (x: number, z: number, r: number) => {
    for (let dx = -6; dx <= 6; dx += 6) {
      for (let dz = -6; dz <= 6; dz += 6) {
        for (const [px, pz] of grid.get(key(x + dx, z + dz)) ?? []) if (Math.hypot(px - x, pz - z) < r) return true
      }
    }
    return false
  }
  const countNear = (x: number, z: number, r: number) => {
    let n = 0
    for (let dx = -12; dx <= 12; dx += 6) {
      for (let dz = -12; dz <= 12; dz += 6) {
        for (const [px, pz] of grid.get(key(x + dx, z + dz)) ?? []) if (Math.hypot(px - x, pz - z) < r) n++
      }
    }
    return n
  }
  const remember = (x: number, z: number) => {
    const k = key(x, z)
    const list = grid.get(k)
    if (list) list.push([x, z])
    else grid.set(k, [[x, z]])
  }
  const TREE_COLOURS = SCENE.trees.map((c) => new THREE.Color(c))
  const WARM = new THREE.Color('#8c8a52')
  const COOL = new THREE.Color('#5f6d4a')
  const WILD_COLOURS = [...SCENE.trees, '#5f6b45', '#6a7448', '#78804f', '#646e48'].map((c) => new THREE.Color(c))
  const fourFreedoms = data.areas.find((a) => a.kind === 'park' && a.name?.startsWith('FDR Four Freedoms'))?.ring
  const inRing = (ring: Point[] | undefined, x: number, z: number) => {
    if (!ring) return false
    let inside = false
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, za] = ring[a]
      const [xb, zb] = ring[b]
      if (za > z !== zb > z && x < xa + ((z - za) * (xb - xa)) / (zb - za)) inside = !inside
    }
    return inside
  }

  // Mapped trees first, exactly where they are. Four Freedoms' allées are
  // one species in rows — the formal park — so they share one shape;
  // a city tree's trunk sets its size.
  let n = 0
  for (const t of data.trees) {
    n++
    const c = cellAt(t.x, t.z)
    if (c < 0 || cover[c] === COVER.WATER) continue
    const formal = inRing(fourFreedoms, t.x, t.z)
    // The allée keeps one shape, but no two trees are identical: ±8% in
    // size and a shift in colour. Cloned at one size and one green, the rows
    // read as generated.
    const s = formal ? 0.95 * (0.92 + hash(n * 3 + 1) * 0.16) : t.dbh ? Math.min(1.8, Math.max(0.6, (3 + 0.3 * t.dbh) / 9)) : 0.8 + hash(n * 3 + 1) * 0.45
    const arch = formal ? 1 : hash(n * 3 + 2) < 0.6 ? 0 : 2
    const colour = formal
      ? TREE_COLOURS[1]
          .clone()
          .lerp(hash(n * 3 + 4) < 0.5 ? WARM : COOL, hash(n * 3 + 5) * 0.35)
          .multiplyScalar(0.93 + hash(n * 3 + 3) * 0.14)
      : TREE_COLOURS[Math.floor(hash(n * 3 + 3) * TREE_COLOURS.length)]
    treeSpots.push({ x: t.x, z: t.z, s, arch, colour })
    remember(t.x, t.z)
  }
  const knownTrees = treeSpots.length

  // Procedural trees: candidates on a jittered 7 m grid, kept by cover,
  // slope and a grove noise — so they come in groves with clearings between —
  // and only where the mapped trees leave room.
  const GROVE = 45
  for (let j = 0; j < H; j += 7) {
    for (let i = 0; i < W; i += 7) {
      const x = x0 + i + hash2(i, j, 21) * 7
      const z = z0 + j + hash2(i, j, 22) * 7
      const c = cellAt(x, z)
      if (c < 0) continue
      const k = cover[c]
      if (!GREEN(k) || dist[c] < 3) continue
      const s = slopeAt(x, z)
      const grove = smooth(0.42, 0.72, fbm(x, z, GROVE, 23))
      let p = 0
      if (k === COVER.WOOD) p = 0.8
      else if (k === COVER.NATURAL) p = (s < GENTLE ? 0.18 : s < STEEP ? 0.4 : 0.6) * grove + 0.015
      else if (k === COVER.GARDEN) p = 0.12 * grove
      // Managed lawn stays open: a specimen tree now and then, groves only on its slopes.
      else if (k === COVER.LAWN) p = s < GENTLE ? 0.012 : (s < STEEP ? 0.2 : 0.4) * grove
      if (hash2(i, j, 24) >= p) continue
      // Where the data already has trees, it has said what is there.
      if (near(x, z, 5) || countNear(x, z, 14) >= 3) continue
      if (k === COVER.LAWN && s < GENTLE && near(x, z, 16)) continue
      const wild = k !== COVER.LAWN
      treeSpots.push({
        x,
        z,
        s: 0.7 + hash2(i, j, 25) * (wild ? 0.6 : 0.4),
        arch: wild ? Math.floor(hash2(i, j, 26) * 3) : hash2(i, j, 26) < 0.5 ? 0 : 2,
        colour: (wild ? WILD_COLOURS : TREE_COLOURS)[Math.floor(hash2(i, j, 27) * (wild ? WILD_COLOURS.length : TREE_COLOURS.length))],
      })
      remember(x, z)
    }
  }
  const proceduralTrees = treeSpots.length - knownTrees

  // Shrubs on a 3.5 m grid, clustered by a finer noise; flowers in patches.
  const SHRUB_COLOURS = ['#76824f', '#6c784a', '#828a58', '#7a7f50'].map((c) => new THREE.Color(c))
  const FLOWER_COLOURS = ['#c9a0a8', '#e2d7c0', '#a99bc0', '#d0b071'].map((c) => new THREE.Color(c))
  const shrubs: Spot[] = []
  const flowers: Spot[] = []
  for (let j = 0; j < H; j += 3.5) {
    for (let i = 0; i < W; i += 3.5) {
      const x = x0 + i + hash2(i * 2, j * 2, 31) * 3.5
      const z = z0 + j + hash2(i * 2, j * 2, 32) * 3.5
      const c = cellAt(x, z)
      if (c < 0) continue
      const k = cover[c]
      if (!GREEN(k) || dist[c] < 1.2) continue
      const s = slopeAt(x, z)
      const patch = smooth(0.45, 0.75, fbm(x, z, 16, 33))
      let p = 0
      if (k === COVER.WOOD) p = 0.35
      else if (k === COVER.GARDEN) p = 0.45 * (0.4 + 0.6 * patch)
      else if (k === COVER.NATURAL) p = (s < GENTLE ? 0.08 : s < STEEP ? 0.22 : 0.45) * patch
      else if (k === COVER.LAWN) p = s < GENTLE ? 0 : (s < STEEP ? 0.12 : 0.3) * patch
      const r = hash2(i * 2, j * 2, 34)
      if (r < p && !near(x, z, 1.8)) {
        shrubs.push({ x, z, s: 1 + hash2(i * 2, j * 2, 35) * 0.8, kind: 0, colour: SHRUB_COLOURS[Math.floor(hash2(i * 2, j * 2, 36) * SHRUB_COLOURS.length)] })
        continue
      }
      // Flowers: most in planted beds, a few patches in meadow and on open lawn.
      const bloom = noise(x, z, 9, 37)
      const pf = k === COVER.GARDEN ? 0.3 * smooth(0.5, 0.7, bloom) : k === COVER.NATURAL ? 0.05 * smooth(0.6, 0.8, bloom) : k === COVER.LAWN && s < GENTLE ? 0.03 * smooth(0.75, 0.9, bloom) : 0
      if (hash2(i * 2, j * 2, 38) < pf) {
        const colour = FLOWER_COLOURS[Math.floor(noise(x, z, 20, 39) * FLOWER_COLOURS.length * 0.999)]
        for (let f = 0; f < 6; f++) {
          const a = hash2(i * 2 + f, j * 2, 40) * Math.PI * 2
          const d = hash2(i * 2 + f, j * 2, 41) * 1.3
          flowers.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: 0.8 + hash2(i * 2 + f, j * 2, 42) * 0.5, kind: 0, colour })
        }
      }
    }
  }

  // --- the instanced meshes: three tree shapes, one trunk, shrubs, flowers ---
  const lumpy = (parts: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(parts.map((p) => {
      const ng = p.index ? p.toNonIndexed() : p
      ng.deleteAttribute('uv')
      return ng
    }))
    for (const p of parts) p.dispose()
    return g
  }
  const canopies = [
    // Round: three lumps, as the generic context trees.
    lumpy([
      new THREE.IcosahedronGeometry(2.6, 1).translate(0, 6.2, 0),
      new THREE.IcosahedronGeometry(2.0, 1).translate(1.4, 5.4, 0.6),
      new THREE.IcosahedronGeometry(1.9, 1).translate(-1.2, 5.6, -0.8),
    ]),
    // Oval, upright: the allées' lindens.
    lumpy([new THREE.IcosahedronGeometry(2.1, 1).scale(1, 1.55, 1).translate(0, 7.0, 0), new THREE.IcosahedronGeometry(1.5, 1).translate(0.6, 5.2, 0.4)]),
    // Spreading: broad and low.
    lumpy([
      new THREE.IcosahedronGeometry(2.9, 1).scale(1, 0.62, 1).translate(0, 5.6, 0),
      new THREE.IcosahedronGeometry(2.1, 1).scale(1, 0.7, 1).translate(2.3, 5.0, 0.8),
      new THREE.IcosahedronGeometry(2.0, 1).scale(1, 0.7, 1).translate(-2.1, 5.1, -1.0),
    ]),
  ]
  const TRUNK_HEIGHT = [4.2, 4.6, 3.8]
  const group = new THREE.Group()
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const v = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const leafMaterial = new THREE.MeshLambertMaterial({ flatShading: true })
  // Every tree leans a little — up to 3°, any way — trunk and canopy
  // together: dead upright, they looked planted by a machine.
  const tilt = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  const lean = (x: number, z: number, out: THREE.Quaternion) => {
    const seed = Math.round(x * 53 + z * 29)
    const dir = hash(seed) * Math.PI * 2
    out.setFromAxisAngle(axis.set(Math.cos(dir), 0, Math.sin(dir)), hash(seed + 1) * (3 * Math.PI) / 180)
  }
  canopies.forEach((geo, arch) => {
    const spots = treeSpots.filter((t) => t.arch === arch)
    const mesh = new THREE.InstancedMesh(geo, leafMaterial, Math.max(1, spots.length))
    mesh.count = spots.length
    spots.forEach((t, i) => {
      lean(t.x, t.z, tilt)
      q.setFromAxisAngle(up, hash(Math.round(t.x * 31 + t.z * 17)) * Math.PI * 2).premultiply(tilt)
      m.compose(v.set(t.x, heightAt(t.x, t.z), t.z), q, sc.set(t.s, t.s, t.s))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, t.colour)
    })
    mesh.castShadow = mesh.receiveShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
  })
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: SCENE.trunk }), Math.max(1, treeSpots.length))
  trunk.count = treeSpots.length
  treeSpots.forEach((t, i) => {
    lean(t.x, t.z, tilt)
    m.compose(v.set(t.x, heightAt(t.x, t.z), t.z), tilt, sc.set(t.s, TRUNK_HEIGHT[t.arch] * t.s, t.s))
    trunk.setMatrixAt(i, m)
  })
  trunk.castShadow = trunk.receiveShadow = true
  trunk.frustumCulled = false
  group.add(trunk)
  const scatter = (geo: THREE.BufferGeometry, spots: Spot[], shadow: boolean) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), Math.max(1, spots.length))
    mesh.count = spots.length
    spots.forEach((t, i) => {
      q.setFromAxisAngle(up, hash(Math.round(t.x * 13 + t.z * 7)) * Math.PI * 2)
      m.compose(v.set(t.x, heightAt(t.x, t.z), t.z), q, sc.set(t.s, t.s, t.s))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, t.colour)
    })
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
  }
  // A shrub: two soft lumps, so it reads as a bush and not a stone.
  scatter(
    lumpy([new THREE.IcosahedronGeometry(1, 1).scale(1, 0.75, 1).translate(0, 0.6, 0), new THREE.IcosahedronGeometry(0.7, 1).scale(1, 0.8, 1).translate(0.6, 0.45, 0.3)]),
    shrubs,
    true,
  )
  scatter(new THREE.IcosahedronGeometry(0.22, 0).translate(0, 0.16, 0), flowers, false)
  group.add(ground)

  const triangles = index.length / 3
  return {
    group,
    stats: {
      cells,
      slope: slopeBands,
      base,
      relief,
      knownTrees,
      proceduralTrees,
      shrubs: shrubs.length,
      flowers: flowers.length,
      triangles,
      ms: performance.now() - start,
    },
    covers: (_x, z) => z >= data.zoneZ,
    dispose: () => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          ;(Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => mat.dispose())
        }
      })
      texture.dispose()
    },
  }
}
