import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createGeometry, type ShapeName } from './shapes'

type SceneCanvasProps = {
  shape: ShapeName
  /** Shared orientation, driven by the rotation gizmo. */
  rotationRef: RefObject<THREE.Quaternion>
  spinSpeed: number
  scale: number
  color: string
  metalness: number
  roughness: number
  wireframe: boolean
}

type SceneObjects = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
}

export function SceneCanvas(props: SceneCanvasProps) {
  const { shape, color, metalness, roughness, wireframe } = props

  const containerRef = useRef<HTMLDivElement>(null)

  // The render loop reads continuous values (rotation, spin, scale) from this ref
  // so changing them never tears the scene down.
  const propsRef = useRef(props)
  useEffect(() => {
    propsRef.current = props
  })

  // Populated by the setup effect so the geometry/material effects below can
  // mutate the live scene in place.
  const objectsRef = useRef<SceneObjects | null>(null)
  const appliedShapeRef = useRef<ShapeName | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111218)

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    )
    camera.position.set(2.4, 1.8, 3.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    // Metal reflects its surroundings, so without an environment the metalness
    // control would only darken the surface. The room gives it something to see.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const envTarget = pmrem.fromScene(room, 0.04)
    scene.environment = envTarget.texture
    room.dispose()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)
    controls.update()

    const initial = propsRef.current
    const mesh = new THREE.Mesh(
      createGeometry(initial.shape),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(initial.color),
        metalness: initial.metalness,
        roughness: initial.roughness,
        wireframe: initial.wireframe,
      }),
    )
    scene.add(mesh)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0xdce8ff }),
    )
    edges.visible = !initial.wireframe
    mesh.add(edges)

    objectsRef.current = { mesh, edges }
    appliedShapeRef.current = initial.shape

    scene.add(new THREE.AmbientLight(0xffffff, 0.45))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1)
    keyLight.position.set(3, 5, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x88aaff, 0.35)
    fillLight.position.set(-4, -1, -2)
    scene.add(fillLight)

    const resize = () => {
      const { clientWidth, clientHeight } = container
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const spinQuaternion = new THREE.Quaternion()
    const spinAxis = new THREE.Vector3(0, 1, 0)
    let spinOffset = 0
    let frameId = 0
    let lastTime = performance.now()
    const animate = (time: number) => {
      // Clamped so a backgrounded tab doesn't resume with one enormous jump.
      const delta = Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time
      const current = propsRef.current

      // Auto-spin is layered on top of the gizmo orientation in world space, so
      // spinning never accumulates into the orientation the user set by dragging.
      spinOffset = (spinOffset + current.spinSpeed * delta) % 360
      spinQuaternion.setFromAxisAngle(spinAxis, THREE.MathUtils.degToRad(spinOffset))
      mesh.quaternion.copy(spinQuaternion).multiply(current.rotationRef.current)
      mesh.scale.setScalar(current.scale)

      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate(lastTime)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      objectsRef.current = null
      appliedShapeRef.current = null
      mesh.geometry.dispose()
      mesh.material.dispose()
      edges.geometry.dispose()
      edges.material.dispose()
      envTarget.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // Swapping geometry in place keeps the mesh identity the render loop closed over.
  useEffect(() => {
    const objects = objectsRef.current
    if (!objects || appliedShapeRef.current === shape) return

    objects.mesh.geometry.dispose()
    objects.mesh.geometry = createGeometry(shape)
    objects.edges.geometry.dispose()
    objects.edges.geometry = new THREE.EdgesGeometry(objects.mesh.geometry)
    appliedShapeRef.current = shape
  }, [shape])

  // Material properties are live-mutable, so these need an effect rather than a
  // per-frame write.
  useEffect(() => {
    const objects = objectsRef.current
    if (!objects) return

    objects.mesh.material.color.set(color)
    objects.mesh.material.metalness = metalness
    objects.mesh.material.roughness = roughness
    objects.mesh.material.wireframe = wireframe
    objects.edges.visible = !wireframe
  }, [color, metalness, roughness, wireframe])

  return <div ref={containerRef} className="scene-canvas" />
}
