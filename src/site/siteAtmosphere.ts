import * as THREE from 'three'
import { inside } from '../green/building'
import type { Point, Site } from './siteData'
import { SCENE } from './siteLook'
import type { SunNow } from './sunClock'

/**
 * The Site page's golden hour: sky, haze, light, and the scenery that is mood
 * rather than data — far shores and generic trees.
 *
 * None of it changes the growth. The sun is the real sun for the day showing
 * (sunClock.ts), placed late in the afternoon while the growth plays, or at
 * any hour when paused; sky, haze and light take their colour from its
 * height, so the page keeps its golden hour and only drifts toward plain
 * daylight when the sun is scrubbed high.
 */

/**
 * The first, fixed sun — south-west, 12° up — kept as the light before the
 * date-following sun first arrives. West-south-west was the first try for
 * it; from the page's south-eastern views it lit faces the camera barely sees.
 */
const SUN_AZIMUTH = 238
const SUN_ELEVATION = 12

export function sunsetDirection(): THREE.Vector3 {
  const az = (SUN_AZIMUTH * Math.PI) / 180
  const el = (SUN_ELEVATION * Math.PI) / 180
  // North is −z, east +x.
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az))
}

/**
 * A sky dome: peach at the horizon, deepening to dusty rose, then blue-violet
 * overhead, with a soft glow around the sun. Unfogged — it *is* the haze's
 * backdrop — and drawn behind everything.
 */
/** The sky's colours and sun, shared by the dome and everything that reflects it. */
export const SKY = {
  uHorizon: { value: new THREE.Color(SCENE.skyHorizon) },
  uLow: { value: new THREE.Color(SCENE.skyLow) },
  uHigh: { value: new THREE.Color(SCENE.skyHigh) },
  uSun: { value: sunsetDirection() },
  uSunColour: { value: new THREE.Color(SCENE.sun) },
}

export function skyDome(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: SKY,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon, uLow, uHigh, uSun, uSunColour;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 c = mix(uHorizon, uLow, smoothstep(0.0, 0.12, h));
        c = mix(c, uHigh, smoothstep(0.08, 0.55, h));
        // Toward the sun the horizon stays warm and bright; away from it, cooler.
        float toward = dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSun.x, 0.0, uSun.z)));
        c = mix(c, c * vec3(0.86, 0.88, 1.0), (1.0 - toward) * 0.25 * (1.0 - smoothstep(0.0, 0.4, h)));
        float glow = pow(max(dot(vDir, uSun), 0.0), 24.0);
        c += uSunColour * glow * 0.55;
        // Below the horizon, the river's haze.
        if (vDir.y < 0.0) c = mix(uHorizon, uLow * 0.9, smoothstep(0.0, -0.2, vDir.y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(11000, 32, 16), material)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  return mesh
}

/**
 * Glass that reflects the sky. Without an environment map a lit glass box is
 * just a dark colour — the first façades' glass, '#2f3a47', read as black
 * holes in the warm walls. Here each pane takes its tint from the vertex
 * colour, then adds the sky it would mirror: the same horizon-to-zenith
 * gradient as the dome, sampled along the reflected view ray, more of it at
 * grazing angles (Schlick's Fresnel), and a glint where it mirrors the sun.
 * So vertical glass mostly shows the warm low sky, and a pane turned to the
 * sun flares. The reflection is not shadowed: a window in shadow still
 * mirrors the sky, as a real one does.
 */
export function glassMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SKY)
    shader.fragmentShader =
      'uniform vec3 uHorizon, uLow, uHigh, uSun, uSunColour;\n' +
      shader.fragmentShader.replace(
        '#include <aomap_fragment>',
        /* glsl */ `#include <aomap_fragment>
        {
          vec3 viewDir = normalize(vViewPosition);
          vec3 r = (vec4(reflect(-viewDir, normal), 0.0) * viewMatrix).xyz;
          float h = max(r.y, 0.0);
          vec3 sky = mix(uHorizon, uLow, smoothstep(0.0, 0.12, h));
          sky = mix(sky, uHigh, smoothstep(0.08, 0.55, h));
          // Below the horizon it mirrors the ground and the street: darker.
          if (r.y < 0.0) sky = mix(uLow, uLow * 0.45, smoothstep(0.0, -0.3, r.y));
          // A share of the cool zenith in every pane, or the warm horizon
          // turns all the glass pink.
          sky = mix(sky, uHigh, 0.4);
          float fresnel = 0.12 + 0.88 * pow(1.0 - saturate(dot(normal, viewDir)), 5.0);
          // No glint once the sun is down: a set sun mirrored low in the
          // glass read as lit windows.
          float glint = pow(max(dot(r, uSun), 0.0), 64.0) * smoothstep(-0.01, 0.04, uSun.y);
          totalEmissiveRadiance += sky * (0.14 + fresnel * 0.5) + uSunColour * glint * 1.2;
        }`,
      )
  }
  return material
}

/**
 * Atmospheric perspective, scaled to the view: haze begins a little short of
 * what the camera looks at and is complete at 3.5 times that distance. So
 * whatever you are looking at is clear, the far end of the island softens
 * behind it, and the far shores are mostly haze — from the campus close up or
 * from the island view alike. A fixed 900 m start was the first try; from the
 * island view, 4 km out, it fogged the island itself.
 */
export function haze(): THREE.Fog {
  return new THREE.Fog(new THREE.Color(SCENE.haze), 900, 7500)
}

export function fitHaze(fog: THREE.Fog, distance: number) {
  fog.near = Math.max(250, distance * 0.8)
  fog.far = Math.max(1500, distance * 3.5)
}

/**
 * The light. A low orange sun gives the warmth; a cool lavender sky light and
 * a mauve bounce from below fill the shadows, so faces turned from the sun
 * read cool rather than dark. The sun casts shadows, refitted to the view:
 * a box around what the camera looks at, sized to the camera's distance, so a
 * close view gets crisp shadows and the island view still gets them all.
 */
export class SunsetLight {
  readonly sun: THREE.DirectionalLight
  readonly ambient: THREE.HemisphereLight
  private readonly dir = sunsetDirection()
  private fitCentre = new THREE.Vector3(Infinity, 0, 0)
  private fitSize = 0
  private readonly tint = new THREE.Color()

  constructor(scene: THREE.Scene) {
    // The sky light is strong: the faces turned from the sun should read cool
    // and mauve, not dark. At 0.9 they went nearly black.
    this.ambient = new THREE.HemisphereLight(new THREE.Color(SCENE.sky), new THREE.Color(SCENE.bounce), 1.7)
    this.sun = new THREE.DirectionalLight(new THREE.Color(SCENE.sun), 3.8)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 9000
    this.sun.shadow.bias = -0.0004
    scene.add(this.ambient, this.sun, this.sun.target)
  }

  /** Refits the shadow box if the view has moved enough to need it. Returns true when the shadow map needs redrawing. */
  fit(target: THREE.Vector3, distance: number): boolean {
    const size = Math.min(1800, Math.max(140, distance * 0.75))
    if (this.fitCentre.distanceTo(target) < size * 0.15 && Math.abs(size - this.fitSize) < this.fitSize * 0.2) return false
    this.fitCentre.copy(target)
    this.fitSize = size
    const cam = this.sun.shadow.camera
    cam.left = -size
    cam.right = size
    cam.top = size
    cam.bottom = -size
    cam.updateProjectionMatrix()
    // A texel or two of normal offset, whatever the box: shadow acne grows with texel size.
    this.sun.shadow.normalBias = ((2 * size) / 4096) * 1.5
    this.place()
    return true
  }

  private place() {
    if (!Number.isFinite(this.fitCentre.x)) return
    this.sun.target.position.copy(this.fitCentre)
    this.sun.position.copy(this.fitCentre).addScaledVector(this.dir, 4000)
  }

  /**
   * Moves the sun, and recolours the light, sky and haze for its height.
   * Three palettes, blended by elevation: the page's golden hour up to about
   * 12°, a warm daylight by 40°, and a dusk as the sun goes down — the sun
   * fading out by 1° below the horizon and the sky light cooling and dimming,
   * never to black, so a scrubbed night still shows the campus.
   */
  setSun(sun: SunNow, fog: THREE.Fog) {
    const el = sun.elevation
    // Below the horizon the light still has to come from above, or the
    // shadow camera would look up through the ground; it is out anyway.
    const lift = Math.max(el, 2) * (Math.PI / 180)
    const flat = Math.hypot(sun.dir[0], sun.dir[2]) || 1
    this.dir.set((sun.dir[0] / flat) * Math.cos(lift), Math.sin(lift), (sun.dir[2] / flat) * Math.cos(lift))
    SKY.uSun.value.set(sun.dir[0], sun.dir[1], sun.dir[2])
    const day = smooth(12, 40, el)
    const dusk = 1 - smooth(-6, 4, el)
    const mixPalette = (key: keyof typeof PALETTE.golden, out: THREE.Color) =>
      out.set(PALETTE.golden[key]).lerp(this.tint.set(PALETTE.day[key]), day).lerp(this.tint.set(PALETTE.dusk[key]), dusk)
    mixPalette('sun', this.sun.color)
    mixPalette('sky', this.ambient.color)
    mixPalette('bounce', this.ambient.groundColor)
    mixPalette('horizon', SKY.uHorizon.value)
    mixPalette('low', SKY.uLow.value)
    mixPalette('high', SKY.uHigh.value)
    mixPalette('sun', SKY.uSunColour.value)
    mixPalette('haze', fog.color)
    this.sun.intensity = 3.8 * smooth(-1, 3, el)
    this.ambient.intensity = 1.7 - 0.8 * dusk
    this.place()
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The golden hour is the page's own palette (siteLook's SCENE). Daylight keeps
 * it warm — a cream sun, a pale warm horizon, a clearer blue overhead —
 * rather than a neutral noon. Dusk deepens the horizon and dims the sky to
 * lavender-blue.
 */
const PALETTE = {
  golden: { sun: SCENE.sun, sky: SCENE.sky, bounce: SCENE.bounce, horizon: SCENE.skyHorizon, low: SCENE.skyLow, high: SCENE.skyHigh, haze: SCENE.haze },
  day: { sun: '#fff0da', sky: '#aab4cf', bounce: '#8f8178', horizon: '#ecd6c0', low: '#c5c4cf', high: '#7b92bf', haze: '#cbbfba' },
  dusk: { sun: '#ff8f5a', sky: '#6f76a0', bounce: '#5e4f5c', horizon: '#d98a6c', low: '#8e7486', high: '#3c4568', haze: '#8e7c86' },
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Generic trees for the island's planted context: street trees along the
 * roads, and a scatter through the lawns and parks. Sage and olive, a little
 * varied, and quieter than the simulated plants. Not from data — the city's
 * street-tree census would be the source for real ones.
 *
 * Street trees stand 3 m off each road edge every 10 m, where that point is
 * on sidewalk or unmapped ground; park trees on a 14 m grid, a third of the
 * points kept. Neither stands in a building footprint or on a road.
 */
export function contextTrees(site: Site, skip?: (x: number, z: number) => boolean): THREE.Group {
  const roads = site.surfaces.roadbed ?? []
  const lawns = [...(site.surfaces.recreation ?? []), ...(site.surfaces.park ?? [])]
  const inPolygon = (polygon: Point[][], x: number, z: number) => inside(polygon[0], x, z) && !polygon.slice(1).some((h) => inside(h, x, z))
  // `skip`: where something better plants the island — the south's landscape.
  const blocked = (x: number, z: number) =>
    !!skip?.(x, z) ||
    !inside(site.island, x, z) ||
    site.buildings.some((b) => inPolygon(b.outline, x, z)) ||
    roads.some((r) => inPolygon(r, x, z))
  const spots: { x: number; z: number; s: number; c: number }[] = []
  let n = 0
  for (const road of roads) {
    const ring = road[0]
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]
      const [bx, bz] = ring[(i + 1) % ring.length]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 6) continue
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      for (let t = 5; t < len - 3; t += 10) {
        n++
        if (hash(n) < 0.3) continue
        for (const side of [1, -1]) {
          const x = ax + dx * t - dz * 3 * side
          const z = az + dz * t + dx * 3 * side
          if (blocked(x, z)) continue
          spots.push({ x, z, s: 0.8 + hash(n + 11) * 0.5, c: Math.floor(hash(n + 12) * SCENE.trees.length) })
          break
        }
      }
    }
  }
  for (const lawn of lawns) {
    const xs = lawn[0].map((p) => p[0])
    const zs = lawn[0].map((p) => p[1])
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 14) {
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 14) {
        n++
        if (hash(n) > 0.33) continue
        const px = x + (hash(n + 1) - 0.5) * 9
        const pz = z + (hash(n + 2) - 0.5) * 9
        if (!inPolygon(lawn, px, pz) || blocked(px, pz)) continue
        spots.push({ x: px, z: pz, s: 0.9 + hash(n + 3) * 0.7, c: Math.floor(hash(n + 4) * SCENE.trees.length) })
      }
    }
  }

  // A canopy of a few lumps, so a tree isn't a ball.
  const lumps = [
    new THREE.IcosahedronGeometry(2.6, 1).translate(0, 6.2, 0),
    new THREE.IcosahedronGeometry(2.0, 1).translate(1.4, 5.4, 0.6),
    new THREE.IcosahedronGeometry(1.9, 1).translate(-1.2, 5.6, -0.8),
  ]
  // Merge the lumps by hand: three spheres into one.
  const merged = new THREE.BufferGeometry()
  const pos: number[] = []
  const nor: number[] = []
  for (const g of lumps) {
    const ng = g.index ? g.toNonIndexed() : g
    pos.push(...(ng.attributes.position.array as Float32Array))
    nor.push(...(ng.attributes.normal.array as Float32Array))
  }
  for (const g of lumps) g.dispose()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 4.2, 6).translate(0, 2.1, 0)
  const canopy = new THREE.InstancedMesh(merged, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length)
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: SCENE.trunk }), spots.length)
  const colours = SCENE.trees.map((c) => new THREE.Color(c))
  const m = new THREE.Matrix4()
  spots.forEach((t, i) => {
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i * 3 + 1) * Math.PI * 2)
    m.compose(new THREE.Vector3(t.x, 0, t.z), spin, new THREE.Vector3(t.s, t.s, t.s))
    canopy.setMatrixAt(i, m)
    trunk.setMatrixAt(i, m)
    canopy.setColorAt(i, colours[t.c])
  })
  for (const mesh of [canopy, trunk]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
  }
  const group = new THREE.Group()
  group.add(trunk, canopy)
  group.userData.count = spots.length
  return group
}
