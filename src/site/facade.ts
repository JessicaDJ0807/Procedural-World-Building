import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { EDGE, FRAME, GLASS, LEDGE, ROOF, SHELTER, inside, type Building, type WallSegment } from '../green/building'
import type { Campus } from './campus'
import { SURFACES, surfaceCode, type SurfaceType } from './facadeSurfaces'
import type { Point, Site } from './siteData'

/**
 * Procedural façades for the Cornell Tech buildings.
 *
 *   building mass → façade rules → a surface type per cell → flags and
 *   coefficients for the growth, and boxes for the eye
 *
 * Each archetype is a small set of rules — floor height, bay width, window
 * size, louver spacing and so on — and one layout per wall worked out from
 * them. The same layout answers two questions: what is the surface at this
 * point of this wall (for every campus cell), and what boxes make it visible
 * (windows, seams, louvers, ledges, slabs). Because both come from one layout,
 * the glass the plants avoid is exactly the glass you see.
 *
 * Every campus building has an archetype, from its published descriptions
 * and photographs, not its drawings — the rhythm and the materials, not the
 * exact panel count:
 *
 * - **The House** — a 26-storey Passive House tower in prefabricated metal
 *   panels: a regular grid of punched windows, panel seams at every bay and
 *   floor, one full-height band of louvers, glazed storefront below, a parapet.
 * - **Verizon Executive Education Center** — glazed ground floor; the floors
 *   above wrapped in vertical cedar-clad louvers, with a band at each floor.
 * - **Tata Innovation Center** — crystalline glazing in ribbons with opaque
 *   spandrels and bays, a cantilevered first floor over a recessed, shaded
 *   ground floor on its long sides, a railed roof terrace with planting.
 * - **Bloomberg Center** — four storeys: a glazed ground floor, ribbon
 *   windows above, and between them a skin of perforated aluminium panels,
 *   each set at its own depth so the wall reads pixelated; a photovoltaic
 *   canopy on posts over the whole roof, overhanging it.
 * - **Graduate Hotel** — an 18-storey slab of floor-to-ceiling glass and solid
 *   panels in a vertical rhythm, the solid panels shifting floor by floor,
 *   with a fin at every module; a glazed top floor under an overhanging roof.
 * - **8 North Loop Road** — no published façade description was found, so
 *   generic service-building rules: precast panels, a high band of windows on
 *   each floor, a louvered screen round the plant on the roof.
 *
 * `massingRules` (opaque panel, a damp base, a ledge at the top) remains for
 * any building without an archetype. Adding one is adding a rules function;
 * nothing else changes.
 */

export type Archetype = 'house' | 'louvered' | 'glazed' | 'perforated' | 'tower' | 'service' | 'massing'

export const ARCHETYPES: Record<string, Archetype> = {
  'The House': 'house',
  'Verizon Executive Education Center': 'louvered',
  'Tata Innovation Center': 'glazed',
  'Bloomberg Center': 'perforated',
  'Graduate Hotel': 'tower',
  '8 North Loop Road': 'service',
}

/** Each archetype's wall colour, behind its details. */
const WALL: Record<Archetype, string | null> = {
  house: '#ddd5c9',
  louvered: '#58616b',
  glazed: '#d9d1c4',
  perforated: '#cbc6be',
  tower: '#c2b8aa',
  service: '#cdc4b6',
  massing: null,
}

export type Facade = {
  /** Each cell's surface type, as an index into SURFACE_TYPES. */
  surface: Uint8Array
  /** The building's flags with the façade's features set: glass, frames, ledges, shelter. */
  flags: Uint8Array
  /** Per species (ivy, moss, vine): the multiplier on env and suitability. */
  habitat: Float32Array[]
  moisture: Float32Array
  light: Float32Array
  /** How far a cell's surface stands proud of the wall — a louver's depth — so leaves and stems sit on it, not behind it. */
  lift: Float32Array
  /** Where automatic planting seeds: the damp base of every wall, and roof gardens. */
  sources: Int32Array
  /** The façade's visible parts, merged, in vertex colour. */
  geometry: THREE.BufferGeometry
  /** Its glass, apart, for a material that reflects the sky. */
  glass: THREE.BufferGeometry
  /** Per campus building (index into site.buildings): its wall colour behind the details. */
  wallColour: Map<number, THREE.Color>
  ms: number
}

const C = {
  frame: new THREE.Color('#d8d0c4'),
  // A tint, not the glass's whole look: the glass material adds the sky's
  // reflection on top (siteAtmosphere.ts). '#2f3a47', unreflective, read as
  // black holes in the warm walls.
  glass: new THREE.Color('#6f7b88'),
  metal: new THREE.Color('#c9c4bb'),
  seam: new THREE.Color('#a9a297'),
  cedar: new THREE.Color('#a8714a'),
  band: new THREE.Color('#d6cdbf'),
  slab: new THREE.Color('#e2d9cb'),
  rail: new THREE.Color('#5e5f63'),
  planting: new THREE.Color('#6d7a4c'),
  canopy: new THREE.Color('#cfc8bd'),
  solar: new THREE.Color('#9aa1ad'),
  panels: ['#c9c6c0', '#bdbab4', '#d3cfc8'].map((c) => new THREE.Color(c)),
  towerPanels: ['#cbc1b3', '#c0b5a7', '#d4cabd'].map((c) => new THREE.Color(c)),
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A box spanning `a`→`b` along a wall, `y0`→`y1` up it, `out0`→`out1` off it (negative is inward). */
function wallBox(seg: WallSegment, a: number, b: number, y0: number, y1: number, out0: number, out1: number, colour: THREE.Color) {
  const geo = new THREE.BoxGeometry(Math.max(0.01, b - a), Math.max(0.01, y1 - y0), Math.max(0.005, out1 - out0))
  const mid = (a + b) / 2
  const out = (out0 + out1) / 2
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(seg.dx, 0, seg.dz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(seg.nx, 0, seg.nz),
  )
  m.setPosition(seg.ax + seg.dx * mid + seg.nx * out, (y0 + y1) / 2, seg.az + seg.dz * mid + seg.nz * out)
  geo.applyMatrix4(m)
  const g = geo.toNonIndexed()
  geo.dispose()
  g.deleteAttribute('uv')
  const colours = new Float32Array(g.attributes.position.count * 3)
  for (let i = 0; i < g.attributes.position.count; i++) colour.toArray(colours, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return g
}

/** Paints a geometry one colour, as an attribute, without uv: ready to merge with the boxes. */
function paint(geo: THREE.BufferGeometry, colour: THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  g.deleteAttribute('uv')
  const colours = new Float32Array(g.attributes.position.count * 3)
  for (let i = 0; i < g.attributes.position.count; i++) colour.toArray(colours, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return g
}

type Push = (g: THREE.BufferGeometry) => void

/** One wall's façade: what is where, and the boxes that show it. */
type WallRules = {
  classify: (along: number, y: number) => SurfaceType
  /** Pushes the wall's boxes: solid parts to `push`, glass to `glass`. */
  boxes: (push: Push, glass: Push) => void
  lift?: (type: SurfaceType) => number
}

/** Evenly spaced bays along a wall, centred, at least `end` clear of each end. */
function bays(length: number, width: number, end: number) {
  const n = Math.max(0, Math.floor((length - 2 * end) / width))
  const margin = (length - n * width) / 2
  return { n, margin, centre: (k: number) => margin + (k + 0.5) * width, edge: (k: number) => margin + k * width }
}

/** The nearest of a set of regularly spaced lines, as a distance. */
const nearLine = (x: number, start: number, step: number) => {
  const t = (x - start) / step
  return Math.abs(t - Math.round(t)) * step
}

function massingRules(height: number): WallRules {
  return {
    classify: (_, y) => (y < 0.6 ? 'GROUND_CONTACT' : y > height - 0.5 ? 'LEDGE' : 'OPAQUE_PANEL'),
    boxes: () => {},
  }
}

/**
 * The House. Floors are the building's height over its 26 storeys; the
 * ground floor is half as tall again, glazed between mullions every 3 m.
 * Above it, 1.6 m bays each hold a 0.9 × 1.7 m window, 0.85 m above the
 * floor, in a ring of frame; panel seams run up every bay line and along every
 * floor line. One band of louvers, 3 m wide, runs the full height of the
 * longest wall. A parapet caps it.
 */
function houseRules(seg: WallSegment, height: number, louverBand: number | null): WallRules {
  const fh = height / 26
  const groundH = fh * 1.5
  const BAY = 1.6
  const WIN_W = 0.9
  const WIN_H = 1.7
  const SILL = 0.85
  const lay = bays(seg.length, BAY, 0.5)
  const floors = Math.max(0, Math.floor((height - 1.2 - groundH - SILL - WIN_H) / fh) + 1)
  const inBand = (a: number) => louverBand !== null && Math.abs(a - louverBand) < 1.5
  const storefront = bays(seg.length, 3, 0.6)
  return {
    classify: (a, y) => {
      if (y < 0.6) return 'GROUND_CONTACT'
      if (y > height - 0.75) return 'LEDGE'
      if (y < groundH) {
        if (a < 0.6 || a > seg.length - 0.6 || y > groundH - 0.5) return 'OPAQUE_PANEL'
        return nearLine(a, storefront.margin, 3) < 0.25 ? 'PANEL_SEAM' : 'GLASS'
      }
      if (inBand(a)) return 'LOUVER'
      const rel = (y - groundH) % fh
      const floor = Math.floor((y - groundH) / fh)
      if (floor < floors && lay.n > 0) {
        const k = Math.min(lay.n - 1, Math.max(0, Math.floor((a - lay.margin) / BAY)))
        const dx = Math.abs(a - lay.centre(k))
        if (dx < WIN_W / 2 && rel > SILL && rel < SILL + WIN_H) return 'GLASS'
        if (dx < WIN_W / 2 + 0.5 && rel > SILL - 0.5 && rel < SILL + WIN_H + 0.5) return 'PANEL_SEAM'
      }
      if (rel < 0.25) return 'PANEL_SEAM'
      if (lay.n > 0 && nearLine(a, lay.margin, BAY) < 0.25) return 'PANEL_SEAM'
      return 'SMOOTH_METAL'
    },
    boxes: (push, glass) => {
      // Storefront: glass between mullions.
      for (let k = 0; k < storefront.n; k++) {
        glass(wallBox(seg, storefront.edge(k) + 0.08, storefront.edge(k + 1) - 0.08, 0.6, groundH - 0.5, 0, 0.05, C.glass))
        push(wallBox(seg, storefront.edge(k) - 0.08, storefront.edge(k) + 0.08, 0.6, groundH - 0.5, 0, 0.1, C.metal))
      }
      for (let f = 0; f < floors; f++) {
        const base = groundH + f * fh
        for (let k = 0; k < lay.n; k++) {
          const c = lay.centre(k)
          if (inBand(c)) continue
          push(wallBox(seg, c - WIN_W / 2 - 0.09, c + WIN_W / 2 + 0.09, base + SILL - 0.09, base + SILL + WIN_H + 0.09, 0, 0.04, C.frame))
          glass(wallBox(seg, c - WIN_W / 2, c + WIN_W / 2, base + SILL, base + SILL + WIN_H, 0, 0.06, C.glass))
        }
        // Floor-line seam.
        push(wallBox(seg, 0, seg.length, base - 0.03, base + 0.03, 0, 0.02, C.seam))
      }
      // Bay-line seams, up the panelled floors.
      for (let k = 0; k <= lay.n; k++) {
        const e = lay.edge(k)
        if (inBand(e)) continue
        push(wallBox(seg, e - 0.03, e + 0.03, groundH, height - 0.75, 0, 0.02, C.seam))
      }
      // The louver band: horizontal slats every 0.3 m.
      if (louverBand !== null) {
        for (let y = groundH + 0.2; y < height - 0.9; y += 0.3) {
          push(wallBox(seg, louverBand - 1.5, louverBand + 1.5, y, y + 0.05, 0, 0.35, C.metal))
        }
      }
      push(wallBox(seg, -0.1, seg.length + 0.1, height - 0.45, height + 0.15, 0, 0.25, C.frame))
    },
    lift: (t) => (t === 'LOUVER' ? 0.36 : t === 'LEDGE' ? 0.2 : 0),
  }
}

/**
 * Verizon. A 6 m glazed ground floor, mullions every 3 m, a band where it
 * meets the floors above; those floors (three, sharing the rest of the
 * height) wrapped in vertical cedar louvers about 0.55 m apart, their spacing
 * and depth varying a little, with a band at every floor line. A parapet.
 */
function louveredRules(seg: WallSegment, height: number, salt: number): WallRules {
  const groundH = 6
  const fh = (height - groundH) / 3
  const storefront = bays(seg.length, 3, 0.4)
  // Fin positions, each nudged from an even 0.55 m.
  const fins: { a: number; depth: number }[] = []
  for (let a = 0.3, k = 0; a < seg.length - 0.2; k++) {
    fins.push({ a, depth: 0.28 + hash(salt + k) * 0.14 })
    a += 0.55 + (hash(salt + k + 999) - 0.5) * 0.16
  }
  return {
    classify: (a, y) => {
      if (y < 0.6) return 'GROUND_CONTACT'
      if (y > height - 0.75) return 'LEDGE'
      if (y < groundH - 0.4) return nearLine(a, storefront.margin, 3) < 0.25 || a < 0.4 || a > seg.length - 0.4 ? 'PANEL_SEAM' : 'GLASS'
      if (y < groundH) return 'LEDGE'
      return (y - groundH) % fh < 0.4 ? 'LEDGE' : 'LOUVER'
    },
    boxes: (push, glass) => {
      for (let k = 0; k < storefront.n; k++) {
        glass(wallBox(seg, storefront.edge(k) + 0.06, storefront.edge(k + 1) - 0.06, 0.6, groundH - 0.4, 0, 0.05, C.glass))
        push(wallBox(seg, storefront.edge(k) - 0.06, storefront.edge(k) + 0.06, 0.6, groundH - 0.4, 0, 0.12, C.metal))
      }
      for (let f = 0; f < 3; f++) {
        const base = groundH + f * fh
        push(wallBox(seg, -0.1, seg.length + 0.1, base - 0.4, base + 0.05, 0, 0.45, C.band))
        for (const fin of fins) push(wallBox(seg, fin.a - 0.035, fin.a + 0.035, base + 0.15, base + fh - 0.45, 0.02, fin.depth, C.cedar))
      }
      push(wallBox(seg, -0.1, seg.length + 0.1, height - 0.45, height + 0.15, 0, 0.45, C.band))
    },
    lift: (t) => (t === 'LOUVER' ? 0.42 : t === 'LEDGE' ? 0.3 : 0),
  }
}

/**
 * Tata. Six floors. On the long walls (over 20 m) the first floor
 * cantilevers 2.5 m over a recessed, shaded ground floor; the short walls
 * have glazed storefronts. Above, each floor is an opaque spandrel to 0.9 m,
 * a ribbon of glass in 2.4 m bays to 0.8 m below the next floor — a quarter of
 * the bays opaque, for the crystalline mix of clear and solid — and a ledge
 * at the floor line. A railed roof terrace, with planting set in from the edge.
 */
function glazedRules(seg: WallSegment, height: number, salt: number): WallRules {
  const fh = height / 6
  const groundH = fh
  const long = seg.length > 20
  const BAY = 2.4
  const lay = bays(seg.length, BAY, 0.3)
  const opaque = (k: number, f: number) => hash(salt + k * 7 + f * 131) < 0.25
  return {
    classify: (a, y) => {
      if (y > height - 1.0) return 'RAILING'
      if (y < groundH) {
        if (long) return y < 0.6 ? 'GROUND_CONTACT' : 'RECESSED'
        if (y < 0.6) return 'GROUND_CONTACT'
        return nearLine(a, lay.margin, BAY) < 0.25 ? 'PANEL_SEAM' : 'GLASS'
      }
      const rel = (y - groundH) % fh
      const f = Math.floor((y - groundH) / fh)
      if (rel < 0.25) return 'LEDGE'
      if (rel < 0.9 || rel > fh - 0.8) return 'OPAQUE_PANEL'
      if (lay.n === 0) return 'OPAQUE_PANEL'
      const k = Math.min(lay.n - 1, Math.max(0, Math.floor((a - lay.margin) / BAY)))
      if (nearLine(a, lay.margin, BAY) < 0.25) return 'PANEL_SEAM'
      return opaque(k, f) ? 'OPAQUE_PANEL' : 'GLASS'
    },
    boxes: (push, glass) => {
      if (long) push(wallBox(seg, -0.2, seg.length + 0.2, groundH - 0.6, groundH, 0, 2.5, C.slab))
      else {
        for (let k = 0; k < lay.n; k++) glass(wallBox(seg, lay.edge(k) + 0.06, lay.edge(k + 1) - 0.06, 0.6, groundH - 0.3, 0, 0.05, C.glass))
      }
      for (let f = 0; f < 5; f++) {
        const base = groundH + f * fh
        if (base + fh > height - 0.5) break
        push(wallBox(seg, -0.05, seg.length + 0.05, base, base + 0.25, 0, 0.18, C.band))
        for (let k = 0; k < lay.n; k++) {
          if (opaque(k, f)) continue
          glass(wallBox(seg, lay.edge(k) + 0.05, lay.edge(k + 1) - 0.05, base + 0.9, base + fh - 0.8, 0, 0.06, C.glass))
        }
        for (let k = 0; k <= lay.n; k++) push(wallBox(seg, lay.edge(k) - 0.05, lay.edge(k) + 0.05, base + 0.9, base + fh - 0.8, 0, 0.1, C.metal))
      }
      // Roof terrace: a rail on posts at the edge, planting set in behind it.
      push(wallBox(seg, 0, seg.length, height + 0.95, height + 1.0, 0, 0.06, C.rail))
      for (let a = 0.2; a < seg.length; a += 1.2) push(wallBox(seg, a - 0.025, a + 0.025, height, height + 1.0, 0.01, 0.05, C.rail))
      if (seg.length > 6) push(wallBox(seg, 2.5, seg.length - 2.5, height, height + 0.4, -4.0, -2.5, C.planting))
    },
    lift: (t) => (t === 'RAILING' ? 0.1 : t === 'LEDGE' ? 0.2 : 0),
  }
}

/**
 * The Bloomberg Center. Four equal floors; a glazed ground floor; on each
 * floor above, a ribbon window 1.6 m tall, 1.1 m above the floor, mullioned
 * every 3 m, and perforated aluminium panels 1.5 m wide filling the rest —
 * each panel at its own depth off the wall, between 3 and 15 cm, so the skin
 * reads pixelated. The panels meet in open joints every 3 m that a climber
 * can follow.
 */
function perforatedRules(seg: WallSegment, height: number, salt: number): WallRules {
  const fh = height / 4
  const groundH = fh
  const WIN0 = 1.1
  const WIN1 = 2.7
  const PANEL = 1.5
  const storefront = bays(seg.length, 3, 0.4)
  const panels = bays(seg.length, PANEL, 0.2)
  return {
    classify: (a, y) => {
      if (y < 0.6) return 'GROUND_CONTACT'
      if (y > height - 0.6) return 'LEDGE'
      if (y < groundH - 0.4) return nearLine(a, storefront.margin, 3) < 0.25 || a < 0.4 || a > seg.length - 0.4 ? 'PANEL_SEAM' : 'GLASS'
      if (y < groundH) return 'LEDGE'
      const rel = (y - groundH) % fh
      if (rel < 0.2) return 'PANEL_SEAM'
      if (rel > WIN0 && rel < WIN1) return nearLine(a, storefront.margin, 3) < 0.25 ? 'PANEL_SEAM' : 'GLASS'
      return nearLine(a, panels.margin, PANEL * 2) < 0.25 ? 'PANEL_SEAM' : 'PERFORATED_METAL'
    },
    boxes: (push, glass) => {
      for (let k = 0; k < storefront.n; k++) {
        glass(wallBox(seg, storefront.edge(k) + 0.06, storefront.edge(k + 1) - 0.06, 0.6, groundH - 0.4, 0, 0.05, C.glass))
        push(wallBox(seg, storefront.edge(k) - 0.06, storefront.edge(k) + 0.06, 0.6, groundH - 0.4, 0, 0.12, C.metal))
      }
      push(wallBox(seg, -0.1, seg.length + 0.1, groundH - 0.4, groundH + 0.05, 0, 0.3, C.band))
      for (let f = 0; f < 3; f++) {
        const base = groundH + f * fh
        for (let k = 0; k < storefront.n; k++) {
          glass(wallBox(seg, storefront.edge(k) + 0.05, storefront.edge(k + 1) - 0.05, base + WIN0, base + WIN1, 0, 0.05, C.glass))
          push(wallBox(seg, storefront.edge(k) - 0.05, storefront.edge(k) + 0.05, base + WIN0, base + WIN1, 0, 0.1, C.metal))
        }
        for (let k = 0; k < panels.n; k++) {
          for (const [y0, y1] of [[base + 0.2, base + WIN0], [base + WIN1, base + fh - 0.02]]) {
            const h = hash(salt + k * 13 + f * 977 + (y0 > base + 1 ? 5 : 0))
            const colour = C.panels[Math.floor(h * C.panels.length)]
            push(wallBox(seg, panels.edge(k) + 0.03, panels.edge(k + 1) - 0.03, y0 + 0.02, y1 - 0.02, 0, 0.03 + h * 0.12, colour))
          }
        }
      }
      push(wallBox(seg, -0.1, seg.length + 0.1, height - 0.45, height + 0.15, 0, 0.3, C.frame))
    },
    lift: (t) => (t === 'PERFORATED_METAL' ? 0.1 : t === 'LEDGE' ? 0.25 : 0),
  }
}

/**
 * The Graduate Hotel. A 5.5 m ground floor in storefront; 16 floors sharing
 * the height up to a 5 m glazed top floor. On each floor, 1.5 m modules,
 * floor-to-ceiling glass or a solid metal panel — about a third solid, the
 * pattern shifting floor by floor — with a fin 30 cm deep between modules, a
 * slab edge at each floor, and an overhanging roof over the top floor.
 */
function towerRules(seg: WallSegment, height: number, salt: number): WallRules {
  const groundH = 5.5
  const crownH = 5
  const fh = (height - groundH - crownH) / 16
  const MOD = 1.5
  const lay = bays(seg.length, MOD, 0.3)
  const storefront = bays(seg.length, 3, 0.4)
  const solid = (k: number, f: number) => hash(salt + k * 7 + f * 131) < 0.34
  return {
    classify: (a, y) => {
      if (y < 0.6) return 'GROUND_CONTACT'
      if (y > height - 0.6) return 'LEDGE'
      if (y < groundH) return nearLine(a, storefront.margin, 3) < 0.25 ? 'PANEL_SEAM' : 'GLASS'
      if (lay.n > 0 && nearLine(a, lay.margin, MOD) < 0.25) return 'PANEL_SEAM'
      if (y > height - crownH) return 'GLASS'
      const rel = (y - groundH) % fh
      if (rel < 0.3) return 'PANEL_SEAM'
      if (lay.n === 0) return 'SMOOTH_METAL'
      const k = Math.min(lay.n - 1, Math.max(0, Math.floor((a - lay.margin) / MOD)))
      return solid(k, Math.floor((y - groundH) / fh)) ? 'SMOOTH_METAL' : 'GLASS'
    },
    boxes: (push, glass) => {
      for (let k = 0; k < storefront.n; k++) {
        glass(wallBox(seg, storefront.edge(k) + 0.06, storefront.edge(k + 1) - 0.06, 0.6, groundH - 0.3, 0, 0.05, C.glass))
        push(wallBox(seg, storefront.edge(k) - 0.06, storefront.edge(k) + 0.06, 0.6, groundH - 0.3, 0, 0.12, C.metal))
      }
      for (let f = 0; f < 16; f++) {
        const base = groundH + f * fh
        push(wallBox(seg, -0.05, seg.length + 0.05, base, base + 0.3, 0, 0.12, C.band))
        for (let k = 0; k < lay.n; k++) {
          const box = wallBox(seg, lay.edge(k) + 0.04, lay.edge(k + 1) - 0.04, base + 0.3, base + fh, 0, 0.05, C.glass)
          if (solid(k, f)) push(paint(box, C.towerPanels[Math.floor(hash(salt + k + f * 31) * C.towerPanels.length)]))
          else glass(box)
        }
      }
      const crown = height - crownH
      push(wallBox(seg, -0.05, seg.length + 0.05, crown, crown + 0.3, 0, 0.12, C.band))
      for (let k = 0; k < lay.n; k++) glass(wallBox(seg, lay.edge(k) + 0.04, lay.edge(k + 1) - 0.04, crown + 0.3, height - 0.6, 0, 0.05, C.glass))
      // Fins between modules, from the storefront to the roof.
      for (let k = 0; k <= lay.n; k++) push(wallBox(seg, lay.edge(k) - 0.04, lay.edge(k) + 0.04, groundH, height - 0.6, 0, 0.3, C.metal))
      push(wallBox(seg, -1.5, seg.length + 1.5, height - 0.6, height, 0, 1.5, C.slab))
    },
    lift: (t) => (t === 'PANEL_SEAM' ? 0.15 : t === 'LEDGE' ? 0.3 : 0),
  }
}

/**
 * 8 North Loop Road: generic service-building rules, there being no
 * published façade to follow. Three floors of precast panels jointed every
 * 3 m and at every floor; a high band of windows on each floor, 2.2 m wide
 * in each 3 m bay, 0.6 m below the floor above; a coping at the top. Its roof
 * plant is screened by louvers set 3 m in from the edge (drawn in
 * buildFacade, which knows the whole roof).
 */
function serviceRules(seg: WallSegment, height: number): WallRules {
  const fh = height / 3
  const lay = bays(seg.length, 3, 0.4)
  return {
    classify: (a, y) => {
      if (y < 0.6) return 'GROUND_CONTACT'
      if (y > height - 0.5) return 'LEDGE'
      const rel = y % fh
      if (rel < 0.25) return 'PANEL_SEAM'
      if (lay.n > 0) {
        const k = Math.min(lay.n - 1, Math.max(0, Math.floor((a - lay.margin) / 3)))
        if (Math.abs(a - lay.centre(k)) < 1.1 && rel > fh - 1.5 && rel < fh - 0.6) return 'GLASS'
        if (nearLine(a, lay.margin, 3) < 0.25) return 'PANEL_SEAM'
      }
      return 'OPAQUE_PANEL'
    },
    boxes: (push, glass) => {
      for (let f = 0; f < 3; f++) {
        const base = f * fh
        if (f > 0) push(wallBox(seg, 0, seg.length, base - 0.03, base + 0.03, 0, 0.02, C.seam))
        for (let k = 0; k < lay.n; k++) {
          const c = lay.centre(k)
          push(wallBox(seg, c - 1.18, c + 1.18, base + fh - 1.58, base + fh - 0.52, 0, 0.04, C.frame))
          glass(wallBox(seg, c - 1.1, c + 1.1, base + fh - 1.5, base + fh - 0.6, 0, 0.06, C.glass))
        }
      }
      for (let k = 0; k <= lay.n; k++) push(wallBox(seg, lay.edge(k) - 0.03, lay.edge(k) + 0.03, 0.6, height - 0.5, 0, 0.02, C.seam))
      push(wallBox(seg, -0.1, seg.length + 0.1, height - 0.35, height + 0.1, 0, 0.2, C.frame))
      // The roof plant's louvered screen, 3 m in.
      if (seg.length > 8) for (let y = height + 0.2; y < height + 2.6; y += 0.3) push(wallBox(seg, 3, seg.length - 3, y, y + 0.06, -3.25, -3.0, C.metal))
    },
    lift: (t) => (t === 'LEDGE' ? 0.2 : 0),
  }
}

/** An outline pushed outward by `d` metres, mitred at the corners. */
function offsetRing(ring: Point[], d: number): Point[] {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]
    const [x2, z2] = ring[(i + 1) % ring.length]
    area += x1 * z2 - x2 * z1
  }
  const side = area > 0 ? 1 : -1
  const normal = (a: Point, b: Point): Point => {
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l = Math.hypot(dx, dz) || 1
    return [(dz / l) * side, (-dx / l) * side]
  }
  return ring.map((p, i) => {
    const n1 = normal(ring[(i - 1 + ring.length) % ring.length], p)
    const n2 = normal(p, ring[(i + 1) % ring.length])
    let nx = n1[0] + n2[0]
    let nz = n1[1] + n2[1]
    const l = Math.hypot(nx, nz) || 1
    nx /= l
    nz /= l
    const k = d / Math.max(0.35, nx * n1[0] + nz * n1[1])
    return [p[0] + nx * k, p[1] + nz * k]
  })
}

/** A flat slab over an outline, `y0`→`y1`. */
function slab(ring: Point[], y0: number, y1: number, colour: THREE.Color) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y0, 0)
  return paint(geo, colour)
}

/**
 * The Bloomberg Center's solar canopy: a slab 3.2 m over the roof, 2.5 m
 * past its edge, photovoltaic on top, on posts every 9 m.
 */
function solarCanopy(ring: Point[], height: number, push: Push) {
  const over = offsetRing(ring, 2.5)
  const y = height + 3.2
  push(slab(over, y, y + 0.35, C.canopy))
  push(slab(offsetRing(ring, 2.3), y + 0.35, y + 0.4, C.solar))
  const xs = ring.map((p) => p[0])
  const zs = ring.map((p) => p[1])
  for (let x = Math.min(...xs) + 4; x < Math.max(...xs); x += 9) {
    for (let z = Math.min(...zs) + 4; z < Math.max(...zs); z += 9) {
      if (!inside(ring, x, z) || distanceToOutline(ring, x, z) < 1.5) continue
      push(paint(new THREE.BoxGeometry(0.3, 3.2, 0.3).translate(x, height + 1.6, z), C.metal))
    }
  }
}

/** Distance from a point to a closed outline. */
function distanceToOutline(ring: Point[], x: number, z: number) {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]
    const [bx, bz] = ring[(i + 1) % ring.length]
    const dx = bx - ax
    const dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return best
}

export function buildFacade(campus: Campus, site: Site): Facade {
  const start = performance.now()
  const b: Building = campus.building
  const n = b.count
  const surface = new Uint8Array(n)
  const flags = Uint8Array.from(b.flags)
  const habitat = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const moisture = new Float32Array(n)
  const light = new Float32Array(n)
  const lift = new Float32Array(n)

  // Which building each wall belongs to, from its cells.
  const segmentOwner = new Int16Array(b.segments.length).fill(-1)
  for (let i = 0; i < n; i++) if (b.segment[i] >= 0) segmentOwner[b.segment[i]] = campus.owner[i]
  // The House's louver band goes on its longest wall, a third of the way along.
  const longest = new Map<number, number>()
  b.segments.forEach((s, si) => {
    const o = segmentOwner[si]
    if (o < 0) return
    const cur = longest.get(o)
    if (cur === undefined || b.segments[cur].length < s.length) longest.set(o, si)
  })

  const rules: (WallRules | null)[] = b.segments.map((seg, si) => {
    const o = segmentOwner[si]
    if (o < 0) return null
    const building = site.buildings[o]
    const archetype = ARCHETYPES[building.name ?? ''] ?? 'massing'
    if (archetype === 'house') return houseRules(seg, building.height, longest.get(o) === si ? seg.length / 3 : null)
    if (archetype === 'louvered') return louveredRules(seg, building.height, si * 1013)
    if (archetype === 'glazed') return glazedRules(seg, building.height, si * 1013)
    if (archetype === 'perforated') return perforatedRules(seg, building.height, si * 1013)
    if (archetype === 'tower') return towerRules(seg, building.height, si * 1013)
    if (archetype === 'service') return serviceRules(seg, building.height)
    return massingRules(building.height)
  })

  const code = (t: SurfaceType) => surfaceCode(t)
  const sources: number[] = []
  for (let i = 0; i < n; i++) {
    let type: SurfaceType
    if (b.flags[i] & ROOF) {
      const o = campus.owner[i]
      const building = o >= 0 ? site.buildings[o] : null
      const archetype = building ? ARCHETYPES[building.name ?? ''] : undefined
      const d = building ? distanceToOutline(building.outline[0], b.px[i], b.pz[i]) : 0
      if (b.flags[i] & EDGE) type = 'ROOF_EDGE'
      else if (archetype === 'glazed' && d < 4.2 && d > 2.3) type = 'ROOF_GARDEN'
      // Under the solar canopy: shaded, and out of the rain.
      else if (archetype === 'perforated') type = 'RECESSED'
      else type = 'ROOF'
    } else {
      const r = rules[b.segment[i]]
      type = r ? r.classify(b.along[i], b.py[i]) : 'OPAQUE_PANEL'
      lift[i] = r?.lift?.(type) ?? 0
    }
    const info = SURFACES[type]
    surface[i] = code(type)
    if (!info.growthAllowed) flags[i] |= GLASS
    if (info.follow) flags[i] |= FRAME
    if (info.holdsWater) flags[i] |= LEDGE
    if (info.sheltered) flags[i] |= SHELTER
    for (let s = 0; s < 3; s++) habitat[s][i] = info.species[s]
    moisture[i] = info.moisture
    light[i] = info.light
    if (info.source && (type !== 'GROUND_CONTACT' || b.py[i] < 0.5)) sources.push(i)
  }

  const parts: THREE.BufferGeometry[] = []
  const glassParts: THREE.BufferGeometry[] = []
  const push = (g: THREE.BufferGeometry) => parts.push(g)
  const glass = (g: THREE.BufferGeometry) => glassParts.push(g)
  rules.forEach((r) => r?.boxes(push, glass))
  const wallColour = new Map<number, THREE.Color>()
  for (const i of campus.indices) {
    const building = site.buildings[i]
    const a = ARCHETYPES[building.name ?? ''] ?? 'massing'
    if (WALL[a]) wallColour.set(i, new THREE.Color(WALL[a]))
    if (a === 'perforated') solarCanopy(building.outline[0], building.height, push)
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    const g = list.length ? mergeGeometries(list) : new THREE.BufferGeometry()
    for (const p of list) p.dispose()
    return g
  }
  const geometry = merge(parts)
  const glassGeometry = merge(glassParts)

  return { surface, flags, habitat, moisture, light, lift, sources: Int32Array.from(sources), geometry, glass: glassGeometry, wallColour, ms: performance.now() - start }
}

/** The building as the growth sees it with façades: same cells and neighbours, the façade's flags, and its seeds. */
export function facadeBuilding(b: Building, facade: Facade): Building {
  return { ...b, flags: facade.flags, ground: facade.sources }
}

