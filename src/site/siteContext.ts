import * as THREE from 'three'
import type { Point } from './siteData'
import { SCENE } from './siteLook'

/**
 * The real buildings across the river: Manhattan to the west, Queens to the
 * east, within 1.2 km of the island — fetched by
 * scripts/fetch-roosevelt-context.mjs into public/site/roosevelt-context.json.
 *
 * They replace the first version's hashed boxes, which read as a few rows of
 * placeholders. Real footprints and roof heights give the shores the density
 * and the skyline they have, while staying massing: one merged, lit,
 * unshadowed mesh in a muted stone, softened by the haze.
 */
export type SiteContext = {
  fetched: string
  buildings: { h: number; o: Point[] }[]
}

export async function loadContext(): Promise<SiteContext> {
  const res = await fetch('/site/roosevelt-context.json')
  if (!res.ok) throw new Error(`Context: HTTP ${res.status}`)
  return res.json()
}

/**
 * Every footprint extruded to its roof height as one geometry: a quad per
 * outline edge, and the roof triangulated. Built by hand rather than with
 * ExtrudeGeometry, which for 6,828 buildings is far slower and adds caps
 * and bevels nobody will see from across a river.
 */
export function massingGeometry(ctx: SiteContext): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const tri = (a: number[], b: number[], c: number[], n: number[]) => {
    pos.push(...a, ...b, ...c)
    nor.push(...n, ...n, ...n)
  }
  for (const { h, o } of ctx.buildings) {
    // Wind each outline the same way, so every wall's normal points out.
    let area = 0
    for (let i = 0; i < o.length; i++) {
      const [x0, z0] = o[i]
      const [x1, z1] = o[(i + 1) % o.length]
      area += x0 * z1 - x1 * z0
    }
    const ring = area < 0 ? o : [...o].reverse()
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]
      const [bx, bz] = ring[(i + 1) % ring.length]
      const len = Math.hypot(bx - ax, bz - az) || 1
      const n = [-(bz - az) / len, 0, (bx - ax) / len]
      tri([ax, 0, az], [bx, 0, bz], [bx, h, bz], n)
      tri([ax, 0, az], [bx, h, bz], [ax, h, az], n)
    }
    const flat = ring.map(([x, z]) => new THREE.Vector2(x, z))
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flat, [])) {
      // Upward: wound counter-clockwise seen from above (+y), which in (x, z) is clockwise.
      const p = (k: number) => [ring[k][0], h, ring[k][1]]
      const [ax, , az] = p(a)
      const [bx, , bz] = p(b)
      const [cx, , cz] = p(c)
      const up = (bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0
      if (up) tri(p(a), p(b), p(c), [0, 1, 0])
      else tri(p(a), p(c), p(b), [0, 1, 0])
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.computeBoundingSphere()
  return geo
}

export function massingMesh(ctx: SiteContext): THREE.Mesh {
  const mesh = new THREE.Mesh(massingGeometry(ctx), new THREE.MeshLambertMaterial({ color: SCENE.distant }))
  mesh.renderOrder = 19
  return mesh
}
