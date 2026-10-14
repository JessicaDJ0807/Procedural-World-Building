import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CELL, type Building, type WallSegment } from './building'

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
    const u1 = (seg.texU + seg.length / CELL) / W
    const v0 = seg.texV / H
    const v1 = (seg.texV + (seg.y1 - seg.y0) / CELL) / H
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
    const geo = new THREE.ShapeGeometry(shape).toNonIndexed()
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      positions.push(x, roof.y, z)
      normals.push(0, 1, 0)
      uvs.push((roof.texU + (x - roof.x0) / CELL) / W, (roof.texV + (z - roof.z0) / CELL) / H)
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
      // Ledges and cornices run the full segment and a little past each end,
      // so they meet at an outside corner instead of leaving a notch.
      parts.push(wallBox(seg, o.s0 - o.depth, o.s1 + o.depth, o.y, o.y + o.thickness, 0, o.depth, COLOURS.trim))
    }
  }

  // Rooftop units: stair housing and plant. They block growth beneath them and
  // cast shadows in the sunlight field; here they are just boxes.
  for (const unit of b.units) {
    const g = new THREE.BoxGeometry(unit.w, unit.h, unit.d)
    g.translate(unit.x, b.roofs[unit.roof].y + unit.h / 2, unit.z)
    parts.push(paint(g, unit.h > 1.5 ? COLOURS.wall : COLOURS.metal))
  }

  return mergeGeometries(parts.map((g) => g.toNonIndexed()))
}
