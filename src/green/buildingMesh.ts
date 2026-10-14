import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { type Building, type WallSegment } from './building'

/**
 * The building as something to look at.
 *
 * Two meshes. The **shell** is every surface the simulation knows — one quad
 * per wall segment and one polygon per roof — with UVs laid so that each cell
 * lands on its own texel of one shared field texture. That is how the debug
 * views paint a field onto the building: they swap the shell's material, and
 * nothing has to be projected. Walls and roofs are told apart by vertex colour,
 * which the lit material multiplies in and the flat field material ignores.
 * The **details** — window panes, frames, sills, ledges, cornices, balconies,
 * rooftop units — are merged boxes in vertex colour, one draw call.
 *
 * Built once. Nothing here changes while the simulation runs.
 */

export const COLOURS = {
  wall: new THREE.Color('#b8b0a3'),
  trim: new THREE.Color('#d4cec3'),
  glass: new THREE.Color('#27313a'),
  metal: new THREE.Color('#3b3e42'),
  roof: new THREE.Color('#8a8379'),
  door: new THREE.Color('#5b4a3c'),
  pad: new THREE.Color('#9d968b'),
  unit: new THREE.Color('#a7adb0'),
  louvre: new THREE.Color('#6f767a'),
  fanWell: new THREE.Color('#24272a'),
  fanRim: new THREE.Color('#c3c8ca'),
  blade: new THREE.Color('#80878b'),
}

/** A box by size and centre, painted. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, colour: THREE.Color) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return paint(g, colour)
}

/**
 * A stair housing: where the stairs come out onto the roof. A plain box read as
 * nothing in particular — the first question about it was "what's that" — so
 * it gets what makes one recognisable from a distance: a door on the front with
 * a frame and a light over it, a cap, and a louvred vent on the side.
 */
function stairHousing(x: number, y: number, z: number, w: number, d: number, h: number): THREE.BufferGeometry[] {
  const parts = [box(w, h, d, x, y + h / 2, z, COLOURS.wall)]
  parts.push(box(w + 0.16, 0.14, d + 0.16, x, y + h + 0.07, z, COLOURS.trim))
  // The door faces +z, toward the Front camera, and sits off-centre like a real one.
  const doorW = 0.9
  const doorH = Math.min(1.9, h - 0.3)
  const dx = x - w / 2 + 0.25 + doorW / 2
  const face = z + d / 2
  parts.push(box(doorW + 0.16, doorH + 0.08, 0.04, dx, y + (doorH + 0.08) / 2, face + 0.02, COLOURS.trim))
  parts.push(box(doorW, doorH, 0.06, dx, y + doorH / 2, face + 0.03, COLOURS.door))
  parts.push(box(0.05, 0.05, 0.09, dx + doorW / 2 - 0.12, y + doorH * 0.5, face + 0.07, COLOURS.metal))
  parts.push(box(0.2, 0.1, 0.1, dx, y + doorH + 0.22, face + 0.05, COLOURS.metal))
  // A vent on the west side, where the Corner camera sees it.
  const ventH = 0.5
  for (let k = 0; k < 6; k++) {
    parts.push(box(0.04, 0.03, 0.8, x - w / 2 - 0.02, y + h - 0.5 - ventH + (k + 0.5) * (ventH / 6), z, COLOURS.louvre))
  }
  return parts
}

/**
 * Rooftop plant — air-handling units. Galvanised boxes on a concrete pad,
 * louvres down every side and a fan in the top, which is what tells them
 * apart from the stair housing at a glance. The bigger unit gets two fans.
 */
function equipmentUnit(x: number, y: number, z: number, w: number, d: number, h: number): THREE.BufferGeometry[] {
  const pad = 0.1
  const parts = [box(w + 0.3, pad, d + 0.3, x, y + pad / 2, z, COLOURS.pad)]
  const base = y + pad
  parts.push(box(w, h - pad, d, x, base + (h - pad) / 2, z, COLOURS.unit))
  for (let sy = base + 0.12; sy < base + h - pad - 0.08; sy += 0.1) {
    for (const side of [-1, 1]) {
      parts.push(box(w * 0.82, 0.025, 0.03, x, sy, z + side * (d / 2 + 0.015), COLOURS.louvre))
      parts.push(box(0.03, 0.025, d * 0.82, x + side * (w / 2 + 0.015), sy, z, COLOURS.louvre))
    }
  }
  const top = base + h - pad
  const fans = w >= 1.4 ? 2 : 1
  const r = Math.min(w / fans, d) * 0.36
  for (let f = 0; f < fans; f++) {
    const fx = x - w / 2 + (w / fans) * (f + 0.5)
    const rim = new THREE.CylinderGeometry(r, r, 0.04, 28)
    rim.translate(fx, top + 0.02, z)
    parts.push(paint(rim, COLOURS.fanRim))
    const well = new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.05, 28)
    well.translate(fx, top + 0.026, z)
    parts.push(paint(well, COLOURS.fanWell))
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.BoxGeometry(r * 1.5, 0.012, r * 0.28)
      blade.rotateY((k * Math.PI) / 3 + 0.3)
      blade.translate(fx, top + 0.056, z)
      parts.push(paint(blade, COLOURS.blade))
    }
    const hub = new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.03, 16)
    hub.translate(fx, top + 0.064, z)
    parts.push(paint(hub, COLOURS.metal))
  }
  return parts
}

/**
 * The tall unit is the stair housing; the low ones are plant. The split is by
 * height because that is the only thing the building's unit list says.
 */
export function isStairHousing(h: number) {
  return h > 1.5
}

/** A box spanning `a`→`b` along a segment, `y0`→`y1` up it, `out0`→`out1` off it. */
function wallBox(seg: WallSegment, a: number, b: number, y0: number, y1: number, out0: number, out1: number, colour: THREE.Color) {
  const geo = new THREE.BoxGeometry(b - a, y1 - y0, out1 - out0)
  const mid = (a + b) / 2
  const out = (out0 + out1) / 2
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(seg.dx, 0, seg.dz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(seg.nx, 0, seg.nz),
  )
  m.setPosition(seg.ax + seg.dx * mid + seg.nx * out, (y0 + y1) / 2, seg.az + seg.dz * mid + seg.nz * out)
  geo.applyMatrix4(m)
  return paint(geo, colour)
}

function paint(geo: THREE.BufferGeometry, colour: THREE.Color) {
  const count = geo.attributes.position.count
  const colours = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colour.toArray(colours, i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  // Box UVs would otherwise collide in a merge; none of the details need them.
  geo.deleteAttribute('uv')
  return geo
}

export function shellGeometry(b: Building): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colours: number[] = []
  const W = b.texW
  const H = b.texH

  for (const seg of b.segments) {
    const x1 = seg.ax + seg.dx * seg.length
    const z1 = seg.az + seg.dz * seg.length
    const u0 = seg.texU / W
    const u1 = (seg.texU + seg.cols) / W
    const v0 = seg.texV / H
    const v1 = (seg.texV + seg.rows) / H
    const quad = [
      [seg.ax, seg.y0, seg.az, u0, v0],
      [x1, seg.y0, z1, u1, v0],
      [x1, seg.y1, z1, u1, v1],
      [seg.ax, seg.y0, seg.az, u0, v0],
      [x1, seg.y1, z1, u1, v1],
      [seg.ax, seg.y1, seg.az, u0, v1],
    ]
    for (const [x, y, z, u, v] of quad) {
      positions.push(x, y, z)
      normals.push(seg.nx, 0, seg.nz)
      uvs.push(u, v)
      colours.push(COLOURS.wall.r, COLOURS.wall.g, COLOURS.wall.b)
    }
  }

  for (const roof of b.roofs) {
    // Shape in (x, −z), so rotating −90° about x lays it flat with +z intact.
    const shape = new THREE.Shape(roof.polygon.map(([x, z]) => new THREE.Vector2(x, -z)))
    for (const hole of roof.holes ?? []) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))))
    const geo = new THREE.ShapeGeometry(shape).toNonIndexed()
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      positions.push(x, roof.y, z)
      normals.push(0, 1, 0)
      uvs.push((roof.texU + (x - roof.x0) / b.cell) / W, (roof.texV + (z - roof.z0) / b.cell) / H)
      colours.push(COLOURS.roof.r, COLOURS.roof.g, COLOURS.roof.b)
    }
    geo.dispose()
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  return geo
}

/**
 * What a wall meets at one end, at height y: another wall turning outward
 * (an outside corner), inward (an inside corner), carrying straight on, or
 * nothing. Found from the segments themselves — the wall that starts where
 * this one ends, or ends where it starts — so it holds for any outline.
 */
function cornerAt(b: Building, index: number, atEnd: boolean, y: number): 'outside' | 'inside' | 'straight' | 'none' {
  const seg = b.segments[index]
  const ex = atEnd ? seg.ax + seg.dx * seg.length : seg.ax
  const ez = atEnd ? seg.az + seg.dz * seg.length : seg.az
  for (let k = 0; k < b.segments.length; k++) {
    if (k === index) continue
    const other = b.segments[k]
    if (y < other.y0 || y > other.y1) continue
    // The neighbour starts where this one ends, or ends where this one starts.
    const ox = atEnd ? other.ax : other.ax + other.dx * other.length
    const oz = atEnd ? other.az : other.az + other.dz * other.length
    if (Math.hypot(ox - ex, oz - ez) > 1e-6) continue
    const [d1x, d1z, d2x, d2z] = atEnd ? [seg.dx, seg.dz, other.dx, other.dz] : [other.dx, other.dz, seg.dx, seg.dz]
    const turn = d1x * d2z - d1z * d2x
    if (Math.abs(turn) < 1e-6) return 'straight'
    // With the outside on the left, a positive turn is an inside corner — the
    // same sign rule fromFootprints uses.
    return turn > 0 ? 'inside' : 'outside'
  }
  return 'none'
}

export function detailGeometry(b: Building): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  for (const w of b.windows) {
    const seg = b.segments[w.segment]
    // Frame behind, pane just proud of it: a frame is a lighter ring around a
    // dark rectangle, which reads as a window from any distance.
    parts.push(wallBox(seg, w.s0 - 0.09, w.s1 + 0.09, w.y0 - 0.09, w.y1 + 0.09, 0, 0.05, COLOURS.trim))
    parts.push(wallBox(seg, w.s0, w.s1, w.y0, w.y1, 0, 0.07, COLOURS.glass))
    parts.push(wallBox(seg, w.s0 - 0.16, w.s1 + 0.16, w.y0 - 0.17, w.y0 - 0.07, 0, 0.14, COLOURS.trim))
  }

  for (const o of b.overhangs) {
    const seg = b.segments[o.segment]
    if (o.kind === 'balcony') {
      parts.push(wallBox(seg, o.s0, o.s1, o.y, o.y + o.thickness, 0, o.depth, COLOURS.trim))
      // Railing: a top rail on three sides and balusters under it.
      const top = o.y + o.thickness + 0.95
      parts.push(wallBox(seg, o.s0, o.s1, top - 0.05, top, o.depth - 0.06, o.depth, COLOURS.metal))
      parts.push(wallBox(seg, o.s0, o.s0 + 0.06, top - 0.05, top, 0, o.depth, COLOURS.metal))
      parts.push(wallBox(seg, o.s1 - 0.06, o.s1, top - 0.05, top, 0, o.depth, COLOURS.metal))
      for (let s = o.s0 + 0.03; s <= o.s1; s += 0.15) {
        parts.push(wallBox(seg, s - 0.015, s + 0.015, o.y + o.thickness, top, o.depth - 0.05, o.depth - 0.02, COLOURS.metal))
      }
    } else {
      // Ledges and cornices run past an end only where the wall turns an
      // outside corner, so the two meet instead of leaving a notch. At the
      // L's inside corner the same extension crossed into the other wall's
      // ledge, and the cornice's stub lay on the roof at exactly roof height —
      // two coincident faces the depth test could not order, which flickered.
      // There the wall that ends stops short by the depth, and the one that
      // starts begins at the corner: one ledge fills the corner square, once.
      const extend = (atEnd: boolean) => {
        const kind = cornerAt(b, o.segment, atEnd, o.y + o.thickness / 2)
        return kind === 'outside' ? o.depth : kind === 'inside' && atEnd ? -o.depth : 0
      }
      parts.push(wallBox(seg, o.s0 - extend(false), o.s1 + extend(true), o.y, o.y + o.thickness, 0, o.depth, COLOURS.trim))
    }
  }

  // Rooftop units: stair housing and plant. They block growth beneath them and
  // cast shadows in the sunlight field. Nothing grows on them: they are not
  // surfaces the simulation has cells on.
  for (const unit of b.units) {
    const y = b.roofs[unit.roof].y
    const make = isStairHousing(unit.h) ? stairHousing : equipmentUnit
    parts.push(...make(unit.x, y, unit.z, unit.w, unit.d, unit.h))
  }

  return mergeGeometries(parts.map((g) => g.toNonIndexed()))
}
