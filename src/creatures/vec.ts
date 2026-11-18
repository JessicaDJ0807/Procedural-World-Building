/** Plain 3-vectors for the pure modules, so they never import three.js. */
export type V3 = { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const addScaled = (a: V3, b: V3, s: number): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s })
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z)
export const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
export const lerp = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
export function norm(a: V3): V3 {
  const l = len(a)
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 1, y: 0, z: 0 }
}

/** An orthonormal frame: t forward along the spine, u up, l to the creature's right. */
export type Frame = { o: V3; t: V3; u: V3; l: V3 }

/** A point given in frame coordinates (forward, up, right) to world. */
export const inFrame = (f: Frame, p: V3): V3 => ({
  x: f.o.x + f.t.x * p.x + f.u.x * p.y + f.l.x * p.z,
  y: f.o.y + f.t.y * p.x + f.u.y * p.y + f.l.y * p.z,
  z: f.o.z + f.t.z * p.x + f.u.z * p.y + f.l.z * p.z,
})

/** A direction given in frame coordinates to world. */
export const dirInFrame = (f: Frame, d: V3): V3 => ({
  x: f.t.x * d.x + f.u.x * d.y + f.l.x * d.z,
  y: f.t.y * d.x + f.u.y * d.y + f.l.y * d.z,
  z: f.t.z * d.x + f.u.z * d.y + f.l.z * d.z,
})

/** Frame from a forward direction, kept upright: up is world up made orthogonal. */
export function uprightFrame(o: V3, forward: V3): Frame {
  const t = norm(forward)
  let l = cross(t, { x: 0, y: 1, z: 0 })
  if (len(l) < 1e-6) l = { x: 0, y: 0, z: 1 }
  l = norm(l)
  const u = cross(l, t)
  return { o, t, u, l }
}

/** Rotate a vector about world up by an angle. */
export function yaw(a: V3, angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.z * s, y: a.y, z: a.x * s + a.z * c }
}
