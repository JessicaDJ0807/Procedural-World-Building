import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { startRenderLoop, type RenderLoop } from '../renderLoop'
import { ChunkField, RADIUS, CHUNK_SIZE, scatterGeometry } from './chunks'
import { createControls, EYE_HEIGHT } from './controls'
import { buildRelief } from './relief'
import { buildSurvey, type Survey } from './survey'
import { createRiverSurface, createWater, type Water } from './water'
import type { WorldSpec } from './worlds'

/*
 * The backdrop's reach and resolution.
 *
 * 5,200 units across because the fog is effectively total past 2,600, so a
 * half-width of 2,600 is as far as anything can be seen from the middle; wider
 * would be triangles behind an opaque wall of haze. 160 cells is 32.5 units a
 * cell — at the 1,300 units where the mountains stand that is 1.4 degrees of
 * arc, which is finer than the silhouette needs, and it is 51k triangles in one
 * draw call built once per world.
 */
const BACKDROP_EXTENT = 5200
const BACKDROP_RESOLUTION = 160

export type Telemetry = {
  x: number
  z: number
  y: number
  chunk: string
  fps: number
  triangles: number
  instances: number
  buildMs: number
}

type Props = {
  world: WorldSpec
  onTelemetry: (t: Telemetry) => void
  onLockChange: (locked: boolean) => void
  /**
   * Filled in with a function that takes the pointer, and emptied when the
   * scene goes away.
   *
   * A handle rather than a counter the page increments. The counter version
   * fired its effect on mount as well as on change and was never reset, so the
   * first world entered behaved and every one after it grabbed the pointer
   * while the curtain was still up — leaving no cursor to click the curtain
   * with. A handle has nothing to go stale.
   */
  requestLockRef: MutableRefObject<(() => void) | null>
  /** Survey lifts the camera off the ground and shows the world from above. */
  mode: 'fly' | 'survey'
}

/**
 * One scene per world, rebuilt from scratch when the world changes.
 *
 * Switching worlds tears the whole scene down rather than mutating it. Every
 * number in a `WorldSpec` reaches something — fog, light, ramp, chunk geometry,
 * scatter — so a mutating path would be a long list of individually correct
 * updates with no way to tell when one had been forgotten. A rebuild costs
 * about as much as the first load, which happens behind a click either way.
 */
export function ExploreViewport({ world, onTelemetry, onLockChange, requestLockRef, mode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const controlsRef = useRef<ReturnType<typeof createControls> | null>(null)
  // Held so anything outside the scene effect can restart a stopped loop. Both
  // of this page's "nothing happens" bugs were a sleeping loop that no state
  // change had woken.
  const loopRef = useRef<RenderLoop | null>(null)
  const [ready, setReady] = useState(false)

  // Read by the loop rather than closed over, so a new callback identity does
  // not tear the scene down. Written in an effect rather than during render,
  // which is what the rule about refs is protecting against.
  const telemetryRef = useRef(onTelemetry)
  const lockRef = useRef(onLockChange)
  const modeRef = useRef(mode)
  useEffect(() => {
    telemetryRef.current = onTelemetry
    lockRef.current = onLockChange
    modeRef.current = mode
    // Switching to the overview while the pointer is released means the loop
    // has already gone idle, and the new camera would never be drawn.
    loopRef.current?.wake()
  }, [onTelemetry, onLockChange, mode])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'

    const scene = new THREE.Scene()
    /*
     * A gradient from the fog colour at the horizon to the sky colour overhead.
     *
     * A flat fill was the right first answer — matching the fog exactly is what
     * removes the hard line across the horizon — but it also means the sky
     * carries no information at all, and a quarter of most frames is sky. The
     * gradient keeps the horizon seamless, because its bottom *is* the fog
     * colour, while giving the upper half somewhere to go.
     *
     * Drawn into a 2×64 canvas rather than built as a dome: a texture on the
     * scene background costs one upload and no geometry, and the horizontal
     * resolution of a vertical gradient is two pixels.
     */
    const skyCanvas = document.createElement('canvas')
    skyCanvas.width = 2
    skyCanvas.height = 64
    const sky2d = skyCanvas.getContext('2d')
    if (sky2d) {
      const grad = sky2d.createLinearGradient(0, 0, 0, 64)
      grad.addColorStop(0, world.sky)
      grad.addColorStop(0.62, world.fog.color)
      grad.addColorStop(1, world.fog.color)
      sky2d.fillStyle = grad
      sky2d.fillRect(0, 0, 2, 64)
    }
    const skyTexture = new THREE.CanvasTexture(skyCanvas)
    skyTexture.colorSpace = THREE.SRGBColorSpace
    scene.background = skyTexture
    scene.backgroundIntensity = 1
    // Exponential rather than linear: it has no far plane to tune against the
    // chunk radius, and it thickens smoothly so the horizon has no visible end.
    scene.fog = new THREE.FogExp2(world.fog.color, world.fog.density)

    /*
     * The far plane has to clear the backdrop, not the chunk ring.
     *
     * It used to sit just past the ring at 480 units, which was right when the
     * ring was all there was to draw. It also meant this world's mountains —
     * measured at 1,300 to 2,200 units out, because the brief puts the big
     * relief away from the river — were behind the far plane and could never
     * appear. Nothing was wrong with the terrain; there was no distance to put
     * it in.
     *
     * Near stays at 0.5, so the depth range is 6,400:1. That is well inside
     * what a 24-bit depth buffer holds without z-fighting on the ground at the
     * viewer's feet, which is the thing a generous far plane usually breaks.
     */
    const FAR = BACKDROP_EXTENT * 0.62
    const camera = new THREE.PerspectiveCamera(
      72,
      container.clientWidth / container.clientHeight,
      0.5,
      FAR,
    )

    const sun = new THREE.DirectionalLight(world.sun.color, world.sun.intensity)
    const az = (world.sun.azimuth * Math.PI) / 180
    const el = (world.sun.elevation * Math.PI) / 180
    sun.position.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
    scene.add(sun)
    scene.add(new THREE.AmbientLight(world.ambient.color, world.ambient.intensity))
    /*
     * The fill, and it carries more than the sun does on anything facing away.
     *
     * At 0.45 this was nominal and every back slope went to near-black. At 1.05
     * it was the opposite fault: enough flat fill to erase the modelling
     * entirely, which is most of what made the surface look washed out. It is
     * per world now, because an overcast valley and a lava field at dusk do not
     * want the same amount of sky. Outdoors the sky is a hemisphere of light, not a point, and a
     * single directional with a token ambient is what makes a render look like
     * a render. Sky colour above, the ground's own darkest stop below, so a
     * slope picks up the world it is standing in.
     */
    const bounce = new THREE.HemisphereLight(world.sky, world.stops[0], world.fill)
    scene.add(bounce)

    const field = new ChunkField(world)
    scene.add(field.group)

    /*
     * The distant relief, behind the chunk ring.
     *
     * The ring reaches 400 units; the fog at this world's density is 70% opaque
     * by 1,300 units and 99% by 2,600, so the backdrop's job is the band in
     * between — far enough to read as distance, near enough to still be there
     * at all. It is the same height function, sunk 3 units so the detailed ring
     * wins wherever both are drawn.
     */
    const backdrop = buildRelief(world, {
      extent: BACKDROP_EXTENT,
      resolution: BACKDROP_RESOLUTION,
      drop: 3,
      belowGround: true,
    })
    scene.add(backdrop.mesh)

    // Water is one plane that follows the camera. It is flat and unbounded in
    // effect, so there is nothing to chunk and nothing to seam.
    // A river carries its own descending surface; a sea is one level plane that
    // follows the camera. Only one of the two is ever right for a world.
    const water: Water | null = field.river
      ? createRiverSurface(field.river, world)
      : createWater(world, (RADIUS * 2 + 3) * CHUNK_SIZE)
    if (water) scene.add(water.mesh)
    // The ribbon is a fixed object in the world, so it must not be dragged
    // along behind the camera the way the sea plane is.
    const waterFollows = !field.river

    // One InstancedMesh per scatter kind. Counts are set from the first ring
    // and the buffer is reused after that, so walking never allocates.
    let loop: RenderLoop | null = null
    const instanced = new Map<string, THREE.InstancedMesh>()
    // White, because the colour now comes from the per-instance buffer and
    // three.js multiplies the two. A tinted material would tint every instance
    // on top of its own drift and collapse the variation back down.
    const material = () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.92,
        metalness: 0.04,
        flatShading: true,
      })

    const controls = createControls(renderer.domElement, (locked) => {
      // Waking here is what makes movement work at all. The frame function
      // reports "still moving" only while the pointer is locked, so the loop
      // has already stopped by the time the lock is taken — and a stopped loop
      // never advances the camera no matter what keys are held.
      loop?.wake()
      lockRef.current(locked)
    })
    controlsRef.current = controls
    controls.state.yaw = world.spawn.yaw
    controls.state.pitch = world.spawn.pitch
    controls.state.position.set(
      world.spawn.x,
      field.heightAt(world.spawn.x, world.spawn.z) + EYE_HEIGHT + world.spawn.lift,
      world.spawn.z,
    )

    field.update(world.spawn.x, world.spawn.z)
    syncScatter()

    function syncScatter() {
      const byKind = new Map<string, typeof field.scatter>()
      for (const item of field.scatter) {
        const list = byKind.get(item.kind) ?? []
        list.push(item)
        byKind.set(item.kind, list)
      }
      for (const [kind, items] of byKind) {
        let mesh = instanced.get(kind)
        if (!mesh || mesh.count > 0 && items.length > mesh.instanceMatrix.count) {
          if (mesh) {
            scene.remove(mesh)
            mesh.dispose()
          }
          // Headroom, so an ordinary step across a boundary reuses the buffer
          // rather than reallocating a GPU resource mid-walk.
          const capacity = Math.ceil(items.length * 1.6) + 64
          mesh = new THREE.InstancedMesh(scatterGeometry(kind), material(), capacity)
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          // Allocated up front: assigning instanceColor after the fact needs a
          // second buffer and a second upload on the first frame it appears.
          mesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(capacity * 3),
            3,
          )
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
          mesh.frustumCulled = false
          scene.add(mesh)
          instanced.set(kind, mesh)
        }
        for (let i = 0; i < items.length; i++) {
          mesh.setMatrixAt(i, items[i].matrix)
          mesh.setColorAt(i, items[i].color)
        }
        mesh.count = items.length
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
      for (const [kind, mesh] of instanced) if (!byKind.has(kind)) mesh.count = 0
    }

    let survey: Survey | null = null
    let clock = 0
    let orbit = 0
    let frames = 0
    let sampled = 0
    let fps = 0

    const observer = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      loop?.wake()
    })
    observer.observe(container)

    loop = startRenderLoop((delta) => {
      const surveying = modeRef.current === 'survey'

      if (surveying) {
        if (!survey) {
          survey = buildSurvey(world)
          scene.add(survey.group)
        }
        /*
         * Fog has to be re-scaled, not merely left alone.
         *
         * It is tuned to hide the chunk ring 300 units away, and exp2 fog falls
         * off with the square of distance — at the 2,700 units the survey camera
         * sits from the far side of the map that is exp(-41), which is zero. The
         * first overview rendered an empty frame of pure fog colour.
         *
         * This keeps the far edge of the map at roughly half visibility, which
         * is enough haze to read depth without erasing the subject.
         */
        if (scene.fog instanceof THREE.FogExp2) scene.fog.density = 0.83 / (survey.extent * 1.7)
        survey.group.visible = true
        clock += delta
        survey.update(clock)
        survey.setMarker(controls.state.position.x, controls.state.position.z)
        field.group.visible = false
        // The survey builds its own, finer relief over the same ground.
        backdrop.mesh.visible = false
        for (const mesh of instanced.values()) mesh.visible = false
        if (water) water.mesh.visible = false

        // A slow orbit, because a still overhead shot of a procedural world is
        // hard to read as relief — the parallax is what makes the landform
        // legible. One revolution in about 50 seconds.
        orbit += delta * 0.125
        const radius = survey.extent * 1.05
        camera.position.set(
          Math.sin(orbit) * radius,
          survey.extent * 0.72,
          Math.cos(orbit) * radius,
        )
        camera.lookAt(0, 0, 0)
        // The far plane is sized for the chunk ring, which is nowhere near far
        // enough to see the other side of the survey from here.
        if (camera.far < survey.extent * 4) {
          camera.far = survey.extent * 4
          camera.updateProjectionMatrix()
        }
        renderer.render(scene, camera)
        frames++
        sampled += delta
        if (sampled >= 0.5) {
          fps = frames / sampled
          frames = 0
          sampled = 0
        }
        // Always moving: the orbit never stops while the overview is up.
        return true
      }

      if (survey) survey.group.visible = false
      if (scene.fog instanceof THREE.FogExp2) scene.fog.density = world.fog.density
      field.group.visible = true
      backdrop.mesh.visible = true
      for (const mesh of instanced.values()) mesh.visible = true
      if (water) water.mesh.visible = true
      if (camera.far !== FAR) {
        camera.far = FAR
        camera.updateProjectionMatrix()
      }

      const moved = controls.update(delta, camera, (x, z) => field.heightAt(x, z))
      if (moved && field.update(camera.position.x, camera.position.z)) syncScatter()
      if (water) {
        if (waterFollows) {
          water.mesh.position.x = camera.position.x
          water.mesh.position.z = camera.position.z
        }
        // Elapsed rather than per-frame delta: the ripples are a function of
        // time, so a dropped frame has to skip forward rather than fall behind.
        clock += delta
        water.update(clock)
      }
      renderer.render(scene, camera)

      frames++
      sampled += delta
      if (sampled >= 0.5) {
        fps = frames / sampled
        frames = 0
        sampled = 0
        const instances = [...instanced.values()].reduce((n, m) => n + m.count, 0)
        telemetryRef.current({
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
          chunk: `${Math.round(camera.position.x / CHUNK_SIZE)}, ${Math.round(camera.position.z / CHUNK_SIZE)}`,
          fps,
          triangles: field.stats.triangles,
          instances,
          buildMs: field.stats.lastBuildMs,
        })
      }
      // Keep drawing while the pointer is locked: the camera can move at any
      // moment and the cost of one wasted frame is far below the cost of a
      // view that does not respond. Unlocked, this settles to nothing.
      return controls.state.locked
    })

    loopRef.current = loop
    requestLockRef.current = () => controls.request()
    setReady(true)

    return () => {
      loopRef.current = null
      requestLockRef.current = null
      observer.disconnect()
      loop?.dispose()
      controls.dispose()
      controlsRef.current = null
      survey?.dispose()
      backdrop.dispose()
      field.dispose()
      for (const mesh of instanced.values()) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        mesh.dispose()
      }
      instanced.clear()
      water?.dispose()
      skyTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      setReady(false)
    }
  }, [world, requestLockRef])

  return <div className="explore-viewport" ref={containerRef} data-ready={ready} />
}
