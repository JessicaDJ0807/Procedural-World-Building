import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'

const DRAG_SPEED = 0.008 // radians per pixel of pointer travel

const AXES: { dir: THREE.Vector3; color: number; label: string }[] = [
  { dir: new THREE.Vector3(1, 0, 0), color: 0xff6b6b, label: 'X' },
  { dir: new THREE.Vector3(0, 1, 0), color: 0x7ee787, label: 'Y' },
  { dir: new THREE.Vector3(0, 0, 1), color: 0x6ea8fe, label: 'Z' },
]

function createAxisLabel(text: string, color: number): THREE.Sprite | null {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  ctx.font = 'bold 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 32, 32)

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false, // labels stay readable when an axis points away from us
    }),
  )
  sprite.scale.setScalar(0.42)
  return sprite
}

type RotationGizmoProps = {
  /** Shared orientation. Dragging the gizmo mutates it; the main scene reads it. */
  rotationRef: RefObject<THREE.Quaternion>
  size?: number
}

export function RotationGizmo({ rotationRef, size = 140 }: RotationGizmoProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(2.4, 1.9, 2.8)
    camera.lookAt(0, 0, 0)

    // alpha so the widget sits on the panel background rather than a black tile
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const group = new THREE.Group()
    scene.add(group)

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x59617a, metalness: 0.1, roughness: 0.6 }),
    )
    group.add(cube)

    const cubeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      new THREE.LineBasicMaterial({ color: 0xdce8ff }),
    )
    cube.add(cubeEdges)

    const disposables: { dispose: () => void }[] = []
    for (const axis of AXES) {
      const arrow = new THREE.ArrowHelper(axis.dir, new THREE.Vector3(), 1.2, axis.color, 0.24, 0.13)
      group.add(arrow)
      disposables.push(arrow)

      const label = createAxisLabel(axis.label, axis.color)
      if (label) {
        label.position.copy(axis.dir).multiplyScalar(1.5)
        group.add(label)
        disposables.push({
          dispose: () => {
            label.material.map?.dispose()
            label.material.dispose()
          },
        })
      }
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0)
    keyLight.position.set(2, 3, 4)
    scene.add(keyLight)

    // Yaw about world up, pitch about the gizmo camera's right vector, so a drag
    // moves the widget the way the pointer moves regardless of current orientation.
    const yawAxis = new THREE.Vector3(0, 1, 0)
    const forward = new THREE.Vector3(0, 0, 0).sub(camera.position).normalize()
    const pitchAxis = new THREE.Vector3().crossVectors(forward, yawAxis).normalize()

    const canvas = renderer.domElement
    const delta = new THREE.Quaternion()
    let dragging = false
    let lastX = 0
    let lastY = 0

    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY

      const rotation = rotationRef.current
      // Pre-multiplying applies each step in world space, which is what makes the
      // drag keep matching the pointer after the object has tumbled.
      delta.setFromAxisAngle(yawAxis, dx * DRAG_SPEED)
      rotation.premultiply(delta)
      delta.setFromAxisAngle(pitchAxis, dy * DRAG_SPEED)
      rotation.premultiply(delta)
      rotation.normalize()
    }

    const endDrag = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)

    let frameId = 0
    const animate = () => {
      group.quaternion.copy(rotationRef.current)
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameId)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      for (const item of disposables) item.dispose()
      cube.geometry.dispose()
      cube.material.dispose()
      cubeEdges.geometry.dispose()
      cubeEdges.material.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [rotationRef, size])

  return <div ref={containerRef} className="gizmo" />
}
