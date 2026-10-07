import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Cell } from './NoiseMapPreview'
import { rampIndex, type Ramp } from './palette'
import { createCameraGate, startRenderLoop, wakeOnInput, type RenderLoop } from './renderLoop'
import { VIEWPORT_BACKGROUND } from './theme'

export type GeometryMode = 'surface' | 'volume' | 'planet'

type NoiseViewportProps = {
  mode: GeometryMode
  resolution: number
  /** `resolution²` for surface mode, `resolution³` for volume mode. */
  field: Float32Array
  heightScale: number
  /** Cell to mark, in map coordinates. `z` is the slice in volume mode. */
  selected: (Cell & { z: number }) | null
  /** Colour ramp the cell value indexes into. */
  ramp: Ramp
  /**
   * Signed height change per cell to colour the surface by instead of the ramp:
   * negative where material was cut, positive where it was dropped. Surface mode
   * only, and `null` to colour by value as usual.
   */
  overlay: { cut: Float32Array; scale: number } | null
  /** Degrees per second the field turns about its vertical axis. 0 is still. */
  spin: number
  /** Draws the sampling lattice over the height field. Surface mode only. */
  wireframe: boolean
  /**
   * Sea level in field units, drawn as a flat plane at that height. Surface
   * mode only; omitted or 0 draws no water. Only the Lab passes it — the
   * workbench's low ground is coloured by the ramp instead.
   */
  water?: number
  /**
   * Camera distance relative to the default framing. The Lab draws the tile in
   * a square pane rather than a wide viewport, where the default leaves it
   * filling about half the width.
   */
  zoom?: number
}

const SPAN = 2.4 // width and depth of the field in world units
const VISIBILITY_FLOOR = 0.06 // below this a volume cell is omitted, not drawn dark

// Cut reads warm, fill reads cool, and untouched ground keeps a dimmed ramp
// colour so the terrain is still legible underneath the overlay.
const CUT_COLOUR: [number, number, number] = [0.94, 0.42, 0.22]
const FILL_COLOUR: [number, number, number] = [0.42, 0.86, 0.98]
const OVERLAY_BASE = 0.34 // how much of the ramp colour survives where nothing moved
const WATER_COLOUR = 0x3d6f8f

/** Default framing per mode: a flat sheet reads well closer in than a full cube. */
const FRAMING: Record<GeometryMode, { position: [number, number, number]; target: number }> = {
  surface: { position: [2.6, 2.4, 3.2], target: 0.3 },
  volume: { position: [3.4, 2.8, 4.1], target: 0 },
  planet: { position: [0.4, 1.5, 3.4], target: 0 },
}

// PolyhedronGeometry splits each edge into detail+1 segments, so this is
// 20·32² = 20,480 faces over 10,242 unique vertices — not 4^detail.
/**
 * How strongly the lattice is drawn, given how dense it is.
 *
 * Line count rises with the resolution while the viewport does not, so a fixed
 * opacity that reads as a lattice at 32² covers the terrain at 128² and the
 * colour is lost under it. Fading in proportion keeps roughly the same amount
 * of ink on screen either way, so the lines stay an annotation rather than
 * becoming the image.
 */
function latticeOpacity(resolution: number): number {
  return THREE.MathUtils.clamp(14 / resolution, 0.13, 0.5)
}

const PLANET_DETAIL = 31
const PLANET_RADIUS = 0.85

type Scene = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  /** Holds everything that turns. */
  spinner: THREE.Group
  surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  /** Lattice lines over the surface, sharing its position attribute. */
  lattice: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  cloud: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  planet: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  /** Unit-sphere direction per planet vertex, fixed for the life of the mesh. */
  planetDirections: Float32Array
  marker: THREE.Mesh
  water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  /** Resolution the surface grid was last built for; -1 forces a rebuild. */
  surfaceResolution: number
}

/**
 * Trilinear sample of the R³ field at a point in [-1, 1]³.
 *
 * Sampling the volume directly is what lets a sphere carry noise with no seam
 * and no polar pinching: there is no 2D parameterisation to wrap, so every
 * vertex is just a position in the same field the cloud draws.
 */
function sampleVolume(field: Float32Array, r: number, x: number, y: number, z: number): number {
  const scale = (v: number) => {
    const t = ((v + 1) / 2) * (r - 1)
    return t < 0 ? 0 : t > r - 1 ? r - 1 : t
  }
  const fx = scale(x)
  const fy = scale(y)
  const fz = scale(z)

  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const z0 = Math.floor(fz)
  const x1 = Math.min(x0 + 1, r - 1)
  const y1 = Math.min(y0 + 1, r - 1)
  const z1 = Math.min(z0 + 1, r - 1)
  const tx = fx - x0
  const ty = fy - y0
  const tz = fz - z0

  const at = (xi: number, yi: number, zi: number) => field[(zi * r + yi) * r + xi]
  const n00 = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * tx
  const n10 = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * tx
  const n01 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * tx
  const n11 = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * tx
  const near = n00 + (n10 - n00) * ty
  const far = n01 + (n11 - n01) * ty
  return near + (far - near) * tz
}

/**
 * An icosphere, kept because its vertices are near-uniformly spread — a UV
 * sphere would crowd them at the poles and stretch the displacement there.
 * Directions are cached so updates only rewrite radii.
 */
function buildPlanetBase(): { geometry: THREE.BufferGeometry; directions: Float32Array } {
  // IcosahedronGeometry comes back non-indexed: every triangle owns three
  // vertices, so the same point is displaced repeatedly and computeVertexNormals
  // can only produce flat facets. Welding cuts 61k vertices to 10k and makes
  // the normals continuous.
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, PLANET_DETAIL))
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const directions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    directions[i * 3] = position.getX(i)
    directions[i * 3 + 1] = position.getY(i)
    directions[i * 3 + 2] = position.getZ(i)
  }
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(position.count * 3), 3),
  )
  return { geometry, directions }
}

function writePlanet(
  geometry: THREE.BufferGeometry,
  directions: Float32Array,
  field: Float32Array,
  resolution: number,
  relief: number,
  ramp: Ramp,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  const lut = ramp.linear

  for (let i = 0; i < position.count; i++) {
    const dx = directions[i * 3]
    const dy = directions[i * 3 + 1]
    const dz = directions[i * 3 + 2]
    const value = sampleVolume(field, resolution, dx, dy, dz)
    const radius = PLANET_RADIUS + value * relief
    position.setXYZ(i, dx * radius, dy * radius, dz * radius)
    const c = rampIndex(ramp, value) * 3
    color.setXYZ(i, lut[c], lut[c + 1], lut[c + 2])
  }
  position.needsUpdate = true
  color.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
}

/**
 * A welded grid of `resolution²` vertices. X and Z are fixed by the lattice and
 * only Y and colour change with the field, so this is built once per resolution
 * and then written into — rebuilding it per frame would dominate slider drags.
 */
function buildSurfaceGrid(resolution: number): THREE.BufferGeometry {
  const count = resolution * resolution
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const step = SPAN / Math.max(resolution - 1, 1)
  const origin = -SPAN / 2

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = (y * resolution + x) * 3
      positions[i] = origin + x * step
      positions[i + 1] = 0
      positions[i + 2] = origin + y * step
    }
  }

  const quads = (resolution - 1) * (resolution - 1)
  const indices = new Uint32Array(quads * 6)
  let t = 0
  for (let y = 0; y < resolution - 1; y++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = y * resolution + x
      const b = a + 1
      const c = a + resolution
      const d = c + 1
      indices[t] = a; indices[t + 1] = c; indices[t + 2] = b
      indices[t + 3] = b; indices[t + 4] = c; indices[t + 5] = d
      t += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}

/**
 * Lattice lines for the surface: rows and columns, nothing else.
 *
 * Deliberately not `material.wireframe`, which draws the TRIANGULATION — and
 * the diagonal across every quad is an artifact of how that quad was split,
 * not anything the field did. Drawing it would double the line count and
 * suggest a structure the sampling grid does not have.
 *
 * The geometry shares the surface's `position` attribute instance rather than
 * copying it, so every height `writeSurface` writes moves the lines too: there
 * is no second buffer that can fall out of step with the terrain.
 */
function buildSurfaceLattice(
  surface: THREE.BufferGeometry,
  resolution: number,
): THREE.BufferGeometry {
  const r = resolution
  // r rows and r columns, each spanning r-1 segments.
  const indices = new Uint32Array(2 * r * (r - 1) * 2)
  let i = 0
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r - 1; x++) {
      indices[i++] = y * r + x
      indices[i++] = y * r + x + 1
    }
  }
  for (let x = 0; x < r; x++) {
    for (let y = 0; y < r - 1; y++) {
      indices[i++] = y * r + x
      indices[i++] = (y + 1) * r + x
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', surface.getAttribute('position'))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}

function writeSurface(
  geometry: THREE.BufferGeometry,
  field: Float32Array,
  heightScale: number,
  ramp: Ramp,
  overlay: { cut: Float32Array; scale: number } | null,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  // Vertex colours are read as linear light, so the ramp's linear side is the
  // correct one here — the sRGB bytes the map uses would render washed out.
  const lut = ramp.linear
  // A zero scale means nothing has moved yet, so there is no overlay to draw.
  const cut = overlay && overlay.scale > 0 ? overlay : null

  for (let i = 0; i < field.length; i++) {
    const value = field[i]
    position.setY(i, value * heightScale)
    const c = rampIndex(ramp, value) * 3
    if (cut) {
      const delta = cut.cut[i]
      const magnitude = Math.min(1, (delta < 0 ? -delta : delta) / cut.scale)
      const [er, eg, eb] = delta < 0 ? CUT_COLOUR : FILL_COLOUR
      const br = lut[c] * OVERLAY_BASE
      const bg = lut[c + 1] * OVERLAY_BASE
      const bb = lut[c + 2] * OVERLAY_BASE
      color.setXYZ(
        i,
        br + (er - br) * magnitude,
        bg + (eg - bg) * magnitude,
        bb + (eb - bb) * magnitude,
      )
    } else {
      color.setXYZ(i, lut[c], lut[c + 1], lut[c + 2])
    }
  }
  position.needsUpdate = true
  color.needsUpdate = true
  geometry.computeVertexNormals() // heights moved, so the old normals are stale
  geometry.computeBoundingSphere()
}

/**
 * One point per cell. Cells below the visibility floor are dropped rather than
 * drawn black: a dense field is opaque from any angle, so leaving the dark
 * cells out is the only way to see into the volume.
 */
function buildCloud(resolution: number, field: Float32Array, ramp: Ramp): THREE.BufferGeometry {
  const lut = ramp.linear
  const step = SPAN / resolution
  const origin = -SPAN / 2 + step / 2

  let visible = 0
  for (let i = 0; i < field.length; i++) if (field[i] >= VISIBILITY_FLOOR) visible++

  const positions = new Float32Array(visible * 3)
  const colors = new Float32Array(visible * 3)
  let i = 0
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const value = field[(z * resolution + y) * resolution + x]
        if (value < VISIBILITY_FLOOR) continue
        positions[i] = origin + x * step
        positions[i + 1] = origin + y * step
        positions[i + 2] = origin + z * step
        const c = rampIndex(ramp, value) * 3
        colors[i] = lut[c]
        colors[i + 1] = lut[c + 1]
        colors[i + 2] = lut[c + 2]
        i += 3
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

export function NoiseViewport({
  mode,
  resolution,
  field,
  heightScale,
  selected,
  ramp,
  overlay,
  spin,
  wireframe,
  water = 0,
  zoom = 1,
}: NoiseViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<RenderLoop | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  // Read by the render loop rather than passed into it, so changing the speed
  // never tears the scene down — the same routing Topic 1 uses for its spin.
  const spinRef = useRef(spin)
  useEffect(() => {
    spinRef.current = spin
  }, [spin])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    )
    camera.position.set(...FRAMING.surface.position)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, FRAMING.surface.target, 0)
    controls.minDistance = 0.8
    controls.maxDistance = 14
    controls.update()

    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(3, 5, 2)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x88aaff, 0.3)
    fill.position.set(-3, 1, -3)
    scene.add(fill)

    // Everything that represents the field turns together, so the marker and
    // the lattice stay locked to the terrain they belong to.
    const spinner = new THREE.Group()
    scene.add(spinner)

    const surface = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide, // the underside is visible when orbiting below
        // The lattice lines sit exactly on the triangle edges they trace, so
        // without nudging the mesh back in depth the two z-fight into a
        // stipple. Offsetting the fill rather than lifting the lines keeps
        // them on the surface at every camera distance.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    )
    spinner.add(surface)

    const lattice = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xe6ecfa, transparent: true }),
    )
    // The shared position attribute is rewritten every tick and this geometry
    // never recomputes its bounds, so a stale sphere could cull the lines away.
    lattice.frustumCulled = false
    spinner.add(lattice)

    const { geometry: planetGeometry, directions: planetDirections } = buildPlanetBase()
    const planet = new THREE.Mesh(
      planetGeometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05 }),
    )
    spinner.add(planet)

    const cloud = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: 0.05 }),
    )
    spinner.add(cloud)

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb347 }),
    )
    marker.visible = false
    // Inside the group so the marker stays stuck to the cell it points at.
    spinner.add(marker)

    // Translucent so the drowned terrain still reads as a seabed: an opaque
    // plane would make sea level look like a cut rather than a fill.
    const waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(SPAN, SPAN).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: WATER_COLOUR,
        transparent: true,
        opacity: 0.72,
        roughness: 0.35,
        metalness: 0.1,
        side: THREE.DoubleSide,
      }),
    )
    waterPlane.visible = false
    spinner.add(waterPlane)

    sceneRef.current = {
      scene,
      camera,
      controls,
      spinner,
      surface,
      lattice,
      cloud,
      planet,
      planetDirections,
      marker,
      water: waterPlane,
      surfaceResolution: -1,
    }

    const resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight)
      // Resizing clears the drawing buffer, and an idle loop would leave it
      // blank until the pointer next moved — which is exactly what happened
      // when Topic 2's hidden view was first shown.
      loopRef.current?.wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const cameraGate = createCameraGate()
    const loop = startRenderLoop((delta) => {
      spinner.rotation.y += THREE.MathUtils.degToRad(spinRef.current) * delta
      controls.update()
      const moved = cameraGate(camera.position, controls.target)
      renderer.render(scene, camera)
      return spinRef.current !== 0 || moved
    })
    loopRef.current = loop
    const stopWaking = wakeOnInput(loop)

    return () => {
      stopWaking()
      loop.dispose()
      loopRef.current = null
      observer.disconnect()
      controls.dispose()
      sceneRef.current = null
      surface.geometry.dispose()
      surface.material.dispose()
      lattice.geometry.dispose()
      lattice.material.dispose()
      cloud.geometry.dispose()
      cloud.material.dispose()
      planet.geometry.dispose()
      planet.material.dispose()
      marker.geometry.dispose()
      ;(marker.material as THREE.Material).dispose()
      waterPlane.geometry.dispose()
      waterPlane.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // Any prop change means the view is out of date — a new mesh, a new ramp, a
  // changed spin. No dependency array on purpose: this runs after every
  // render, and waking an already-running loop is a no-op.
  useEffect(() => {
    loopRef.current?.wake()
  })

  // Reframing belongs with the mode, not the data: doing it in the geometry
  // effect below would yank the camera back on every slider drag.
  useEffect(() => {
    const objects = sceneRef.current
    if (!objects) return
    const framing = FRAMING[mode]
    const [px, py, pz] = framing.position
    objects.camera.position.set(px * zoom, framing.target + (py - framing.target) * zoom, pz * zoom)
    objects.controls.target.set(0, framing.target, 0)
    objects.controls.update()
  }, [mode, zoom])

  useEffect(() => {
    const objects = sceneRef.current
    if (!objects) return

    objects.surface.visible = mode === 'surface'
    objects.cloud.visible = mode === 'volume'
    objects.planet.visible = mode === 'planet'
    objects.lattice.visible = mode === 'surface' && wireframe
    objects.water.visible = mode === 'surface' && water > 0
    objects.water.position.y = water * heightScale

    if (mode === 'surface') {
      if (objects.surfaceResolution !== resolution) {
        objects.surface.geometry.dispose()
        objects.lattice.geometry.dispose()
        objects.surface.geometry = buildSurfaceGrid(resolution)
        // Rebuilt together: the lattice holds the surface's position attribute,
        // so a lattice left behind would index a buffer that no longer exists.
        objects.lattice.geometry = buildSurfaceLattice(objects.surface.geometry, resolution)
        objects.surfaceResolution = resolution
      }
      objects.lattice.material.opacity = latticeOpacity(resolution)
      writeSurface(objects.surface.geometry, field, heightScale, ramp, overlay)
    } else if (mode === 'planet') {
      writePlanet(objects.planet.geometry, objects.planetDirections, field, resolution, heightScale, ramp)
    } else {
      // The cull makes the point count vary, so this geometry cannot be reused.
      objects.cloud.geometry.dispose()
      objects.cloud.geometry = buildCloud(resolution, field, ramp)
      objects.cloud.material.size = Math.max((SPAN / resolution) * 0.75, 0.012)
    }
  }, [mode, resolution, field, heightScale, ramp, overlay, wireframe, water])

  useEffect(() => {
    const objects = sceneRef.current
    if (!objects) return

    if (!selected) {
      objects.marker.visible = false
      return
    }

    if (mode === 'planet') {
      // The selected cell is a point in the volume the planet is carved from,
      // so it can legitimately sit inside the surface and be hidden.
      const [dx, dy, dz] = [selected.x, selected.y, selected.z].map(
        (c) => (c / Math.max(resolution - 1, 1)) * 2 - 1,
      )
      const length = Math.hypot(dx, dy, dz) || 1
      const value = sampleVolume(field, resolution, dx, dy, dz)
      const radius = PLANET_RADIUS + value * heightScale
      objects.marker.position.set((dx / length) * radius, (dy / length) * radius, (dz / length) * radius)
    } else if (mode === 'surface') {
      const step = SPAN / Math.max(resolution - 1, 1)
      const value = field[selected.y * resolution + selected.x] ?? 0
      objects.marker.position.set(
        -SPAN / 2 + selected.x * step,
        value * heightScale,
        -SPAN / 2 + selected.y * step,
      )
    } else {
      const step = SPAN / resolution
      const origin = -SPAN / 2 + step / 2
      objects.marker.position.set(
        origin + selected.x * step,
        origin + selected.y * step,
        origin + selected.z * step,
      )
    }
    objects.marker.visible = true
  }, [selected, mode, resolution, field, heightScale])

  return <div ref={containerRef} className="noise-viewport" />
}
