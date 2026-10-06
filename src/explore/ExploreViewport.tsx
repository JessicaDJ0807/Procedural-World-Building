import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { startRenderLoop, type RenderLoop } from '../renderLoop'
import { ChunkField, RADIUS, CHUNK_SIZE, scatterGeometry } from './chunks'
import { createControls, EYE_HEIGHT } from './controls'
import { buildSurvey, type Survey } from './survey'
import type { WorldSpec } from './worlds'

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
  /** Bumped by the page to ask for pointer lock from a user gesture. */
  lockToken: number
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
export function ExploreViewport({ world, onTelemetry, onLockChange, lockToken, mode }: Props) {
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

    // Beyond the loaded ring there is nothing to draw, so the far plane sits
    // just past it rather than at a number that sounds generous.
    const FAR = (RADIUS + 1) * CHUNK_SIZE
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
     * At 0.45 this was nominal and every back slope went to near-black — the
     * foreground of all three worlds was a dark mass with a rim of light on the
     * ridges. Outdoors the sky is a hemisphere of light, not a point, and a
     * single directional with a token ambient is what makes a render look like
     * a render. Sky colour above, the ground's own darkest stop below, so a
     * slope picks up the world it is standing in.
     */
    const bounce = new THREE.HemisphereLight(world.sky, world.stops[0], 1.05)
    scene.add(bounce)

    const field = new ChunkField(world)
    scene.add(field.group)

    // Water is one plane that follows the camera. It is flat and unbounded in
    // effect, so there is nothing to chunk and nothing to seam.
    let water: THREE.Mesh | null = null
    if (world.water && world.terrain.seaLevel !== null) {
      const size = (RADIUS * 2 + 3) * CHUNK_SIZE
      water = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({
          color: world.water.color,
          transparent: world.water.opacity < 1,
          opacity: world.water.opacity,
          metalness: world.water.metalness,
          roughness: world.water.roughness,
        }),
      )
      water.rotation.x = -Math.PI / 2
      water.position.y = world.terrain.seaLevel
      scene.add(water)
    }

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
        survey.setMarker(controls.state.position.x, controls.state.position.z)
        field.group.visible = false
        for (const mesh of instanced.values()) mesh.visible = false
        if (water) water.visible = false

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
      for (const mesh of instanced.values()) mesh.visible = true
      if (water) water.visible = true
      if (camera.far !== FAR) {
        camera.far = FAR
        camera.updateProjectionMatrix()
      }

      const moved = controls.update(delta, camera, (x, z) => field.heightAt(x, z))
      if (moved && field.update(camera.position.x, camera.position.z)) syncScatter()
      if (water) {
        water.position.x = camera.position.x
        water.position.z = camera.position.z
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
    setReady(true)

    return () => {
      loopRef.current = null
      observer.disconnect()
      loop?.dispose()
      controls.dispose()
      controlsRef.current = null
      survey?.dispose()
      field.dispose()
      for (const mesh of instanced.values()) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        mesh.dispose()
      }
      instanced.clear()
      if (water) {
        water.geometry.dispose()
        ;(water.material as THREE.Material).dispose()
      }
      skyTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      setReady(false)
    }
  }, [world])

  /**
   * Taking the pointer lock, only ever from a click.
   *
   * This used to fire on mount as well, which was wrong twice over. Pointer
   * lock needs a user gesture, and entering a world is a click on a card in a
   * different component — but worse, StrictMode mounts this twice, so the first
   * request landed on a canvas that the cleanup immediately removed. The result
   * was a hidden cursor over a curtain that still wanted clicking, with no
   * pointer left to click it.
   *
   * The curtain is the gesture now, and it is the only path in.
   */
  useEffect(() => {
    if (lockToken > 0) controlsRef.current?.request()
  }, [lockToken])

  return <div className="explore-viewport" ref={containerRef} data-ready={ready} />
}
