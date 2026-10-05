import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DOMAIN } from './density'
import type { Mesh as VoxelMesh } from './mesher'
import { rampIndex, type Ramp } from './palette'

type VoxelViewportProps = {
  mesh: VoxelMesh
  /** Colour ramp the height maps into. */
  ramp: Ramp
  /** Degrees per second the solid turns about its vertical axis. 0 is still. */
  spin: number
  /** Draws the sampling cube the shapes are evaluated inside. */
  showBounds: boolean
}

const CAMERA = { position: [2.3, 1.9, 2.9] as const, near: 0.1, far: 100 }

/**
 * Writes a mesh's colours from the height of each vertex.
 *
 * Height rather than the density value, because on the finished surface the
 * density is zero everywhere by construction — it is the isolevel. The only
 * signal left in the geometry is where it sits in space.
 */
function writeColours(geometry: THREE.BufferGeometry, positions: Float32Array, ramp: Ramp) {
  const count = positions.length / 3
  const colors = new Float32Array(count * 3)
  const lut = ramp.linear
  for (let i = 0; i < count; i++) {
    const c = rampIndex(ramp, positions[i * 3 + 1]) * 3
    colors[i * 3] = lut[c]
    colors[i * 3 + 1] = lut[c + 1]
    colors[i * 3 + 2] = lut[c + 2]
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

export function VoxelViewport({ mesh, ramp, spin, showBounds }: VoxelViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    spinner: THREE.Group
    solid: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    bounds: THREE.LineSegments
  } | null>(null)

  // Read by the render loop rather than closed over, so changing the speed
  // never tears the scene down.
  const spinRef = useRef(spin)
  useEffect(() => {
    spinRef.current = spin
  }, [spin])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111218)

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      CAMERA.near,
      CAMERA.far,
    )
    camera.position.set(...CAMERA.position)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 0.8
    controls.maxDistance = 16
    controls.update()

    // Flat ambient plus three directionals, matching Topic 2 so the two pages
    // read as the same world. A hemisphere light was tried here on the theory
    // that subtracted cavities need fill from below; it washed the palette out
    // and fixed nothing, because the dark openings in a carved solid are
    // usually the background seen straight through it rather than unlit
    // geometry.
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(3, 5, 2)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x88aaff, 0.3)
    fill.position.set(-3, 1, -3)
    scene.add(fill)
    // Cavities that are genuinely enclosed still face away from every light
    // above, so a dim warm source from below keeps them from reading as holes.
    const under = new THREE.DirectionalLight(0xffd9a0, 0.25)
    under.position.set(0, -4, 1)
    scene.add(under)

    const spinner = new THREE.Group()
    scene.add(spinner)

    const solid = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.04,
        // A subtracted cavity exposes back faces, and culling them would show
        // straight through the solid into the far wall.
        side: THREE.DoubleSide,
      }),
    )
    spinner.add(solid)

    const bounds = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(DOMAIN * 2, DOMAIN * 2, DOMAIN * 2)),
      new THREE.LineBasicMaterial({ color: 0x3a4152, transparent: true, opacity: 0.55 }),
    )
    spinner.add(bounds)

    sceneRef.current = { scene, camera, controls, spinner, solid, bounds }

    const resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    let frameId = 0
    let lastTime = performance.now()
    const animate = (time: number) => {
      // Clamped so a backgrounded tab does not resume with one enormous jump.
      const delta = Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time
      spinner.rotation.y += THREE.MathUtils.degToRad(spinRef.current) * delta
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      sceneRef.current = null
      solid.geometry.dispose()
      solid.material.dispose()
      bounds.geometry.dispose()
      ;(bounds.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    const objects = sceneRef.current
    if (!objects) return

    // The vertex count changes with every edit, so the geometry is replaced
    // rather than written into — unlike Topic 2's surface, whose lattice is
    // fixed by the resolution alone.
    objects.solid.geometry.dispose()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    writeColours(geometry, mesh.positions, ramp)
    geometry.computeBoundingSphere()
    objects.solid.geometry = geometry
    objects.solid.visible = mesh.triangles > 0
  }, [mesh, ramp])

  useEffect(() => {
    const objects = sceneRef.current
    if (!objects) return
    objects.bounds.visible = showBounds
  }, [showBounds])

  return <div ref={containerRef} className="voxel-viewport" />
}
