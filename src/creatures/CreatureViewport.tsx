import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyViewControls } from '../cameraControls'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import { STEP } from './animate'
import { CreatureRig } from './creatureMeshes'
import { report, type Lab, type LabReport } from './lab'
import { HabitatMeshes, Overlay } from './labMeshes'

export type DebugShow = { skeleton: boolean; joints: boolean; attachments: boolean; sensors: boolean; target: boolean; path: boolean }

type Props = {
  lab: Lab
  running: boolean
  /** Simulated seconds per real second. */
  animSpeed: number
  /** Bumped to advance exactly one step while paused. */
  stepToken: number
  /** Bumped when the scene changes, to reframe the camera. */
  frameToken: number
  show: DebugShow
  follow: boolean
  selected: number
  onSelect: (joint: number) => void
  onReport: (r: LabReport) => void
}

/** The largest dimension of the creature as it stands: nose to tail, leg span, or height. */
function extent(c: Lab['creature']): number {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  let y1 = 0
  for (const j of c.joints) {
    x0 = Math.min(x0, j.bind.x)
    x1 = Math.max(x1, j.bind.x)
    z0 = Math.min(z0, j.bind.z)
    z1 = Math.max(z1, j.bind.z)
    y1 = Math.max(y1, j.bind.y)
  }
  return Math.max(x1 - x0 + c.headRadii.x, z1 - z0, y1)
}

/** Half the gap between parent and offspring, side by side: each one's width and legs, and a margin. */
function separation(lab: Lab): number {
  if (!lab.parent) return 0
  const half = (c: Lab['creature']) => c.width / 2 + (c.limbs.length ? c.genome.legLength * c.genome.scale * 0.8 : 0) + (c.wings.length ? c.genome.wingSpan * c.length * 0.3 : 0)
  return Math.max(half(lab.creature), half(lab.parent.creature)) + 0.5
}

/**
 * The creature lab's 3D view. It owns the renderer and the render loop; the
 * lab owns the creature. Each frame it runs as many fixed steps as real time
 * × speed covers, then copies the pose into the meshes. When the lab's
 * creature, parent or habitat is a different object from the one drawn, the
 * meshes for it are rebuilt — so a slider that changes a gene costs one
 * rebuild, and a frame that changes nothing costs none.
 */
export function CreatureViewport(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const wakeRef = useRef<() => void>(() => {})
  const stepRef = useRef<() => void>(() => {})
  const frameRef = useRef<() => void>(() => {})
  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    // The floor fades into the background before its edge, so there is no horizon line.
    scene.fog = new THREE.Fog(VIEWPORT_BACKGROUND, 22, 70)
    // Soft and cool from above, a near-white key: clean light, no warm cast.
    scene.add(new THREE.HemisphereLight(0xc4d0dc, 0x4c4f48, 1.25))
    const key = new THREE.DirectionalLight(0xfffaf2, 1.9)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0005
    key.shadow.normalBias = 0.03
    key.shadow.radius = 3
    scene.add(key, key.target)

    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / Math.max(container.clientHeight, 1), 0.05, 400)
    const controls = new OrbitControls(camera, renderer.domElement)
    applyViewControls(controls, { ground: true })
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 1.2
    controls.maxDistance = 80
    const gate = createCameraGate(0.002)

    // The studio: a pad and a grid that slides under a creature walking in place.
    const studio = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.CircleGeometry(120, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7d8379, roughness: 1 }))
    pad.receiveShadow = true
    const grid = new THREE.GridHelper(40, 40, 0x939a8f, 0x8a9087)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.45
    grid.position.y = 0.005
    studio.add(pad, grid)
    scene.add(studio)

    // Everything tied to the creature's world position: moved as one when it walks in place.
    const world = new THREE.Group()
    scene.add(world)
    const overlay = new Overlay()
    world.add(overlay.group)
    let rig: CreatureRig | null = null
    let parentRig: CreatureRig | null = null
    let habitat: HabitatMeshes | null = null
    const tmp = new THREE.Vector3()
    const focus = new THREE.Vector3()
    let focused = false

    const sync = () => {
      const lab = latest.current.lab
      if (!rig || rig.creature !== lab.creature) {
        if (rig) {
          world.remove(rig.group)
          rig.dispose()
        }
        rig = new CreatureRig(lab.creature)
        world.add(rig.group)
      }
      const pc = lab.parent?.creature ?? null
      if ((parentRig?.creature ?? null) !== pc) {
        if (parentRig) {
          scene.remove(parentRig.group)
          parentRig.dispose()
          parentRig = null
        }
        if (pc) {
          parentRig = new CreatureRig(pc, { ghost: false })
          scene.add(parentRig.group)
        }
      }
      const wantHabitat = lab.scene === 'habitat' ? lab.habitat : null
      if ((habitat?.habitat ?? null) !== wantHabitat) {
        if (habitat) {
          world.remove(habitat.group)
          habitat.dispose()
          habitat = null
        }
        if (wantHabitat) {
          habitat = new HabitatMeshes(wantHabitat)
          world.add(habitat.group)
        }
      }
      studio.visible = lab.scene === 'studio'
    }

    /** Where the camera looks: the creature's centre, as drawn. */
    const subject = (out: THREE.Vector3) => {
      const lab = latest.current.lab
      const c = lab.body.centre()
      return out.set(c.x + world.position.x, c.y * 0.6, c.z + world.position.z)
    }

    const frame = () => {
      const lab = latest.current.lab
      sync()
      const size = extent(lab.creature)
      subject(focus)
      if (lab.scene === 'habitat') {
        camera.position.set(focus.x + size * 1.6 + 7, 9 + size * 1.2, focus.z + size * 1.8 + 9)
      } else if (lab.inPlace || lab.parent) {
        // Side by side, look between the two.
        const span = lab.parent ? separation(lab) * 1.3 : 0
        if (lab.parent) focus.x = 0
        const d = size * 1.55 + 1.2 + span
        camera.position.set(focus.x + d * 0.62, focus.y + d * 0.45, focus.z + d * 0.72)
      } else {
        const R = lab.studioRadius()
        focus.set(0, 0.3, 0)
        camera.position.set(R * 1.3 + 2, R * 1.1 + 2, R * 1.5 + 3)
      }
      controls.target.copy(focus)
      controls.update()
      focused = true
    }
    // Reframing waits for the next frame, so it reads the lab after every
    // effect of this render has run — a child's effects run before its parent's.
    let pending = false
    let lastScene = ''
    frameRef.current = () => {
      pending = true
      loop.wake()
    }

    const draw = () => {
      const p = latest.current
      const lab = p.lab
      sync()
      const body = lab.body
      const c = body.centre()
      // In place: the world slides back under the creature, so the creature
      // stays put and its planted feet are seen to move backward — a treadmill.
      const inPlace = lab.scene === 'studio' && (lab.inPlace || lab.parent !== null)
      const sep = separation(lab)
      if (inPlace) world.position.set(-c.x + sep, 0, -c.z)
      else world.position.set(0, 0, 0)
      grid.position.set(inPlace ? (((-c.x + sep) % 1) + 1) % 1 : 0, 0.005, inPlace ? (((-c.z) % 1) + 1) % 1 : 0)
      rig!.update(body, p.show, p.selected, camera)
      if (parentRig && lab.parent) {
        const pcentre = lab.parent.body.centre()
        parentRig.group.position.set(-pcentre.x - sep, 0, -pcentre.z)
        parentRig.update(lab.parent.body, { skeleton: p.show.skeleton, joints: false, attachments: false }, -1, camera)
      }
      habitat?.update()
      overlay.update(lab.creature, body, lab.scene === 'habitat' ? lab.brain : null, lab.scene === 'habitat' ? lab.habitat : null, p.show, lab.scene === 'studio' && !inPlace ? lab.studioRadius() : null)

      // Follow: move the camera with the creature, keeping the user's angle.
      if (p.follow && focused && (lab.scene === 'habitat' || !inPlace)) {
        subject(tmp)
        const dx = (tmp.x - controls.target.x) * 0.08
        const dz = (tmp.z - controls.target.z) * 0.08
        controls.target.x += dx
        controls.target.z += dz
        camera.position.x += dx
        camera.position.z += dz
      }
      // The shadow follows the view, sized to what is on screen.
      const span = Math.max(6, Math.min(40, camera.position.distanceTo(controls.target) * 0.9))
      key.position.set(controls.target.x - span * 0.5, span * 1.2 + 4, controls.target.z + span * 0.4)
      key.target.position.copy(controls.target)
      const cam = key.shadow.camera
      if (cam.right !== span) {
        cam.left = cam.bottom = -span
        cam.right = cam.top = span
        cam.near = 0.5
        cam.far = span * 4 + 20
        cam.updateProjectionMatrix()
      }
    }

    let owed = 0
    let lastReport = 0
    const loop = startRenderLoop((delta) => {
      const p = latest.current

      if (p.running) {
        owed += delta * p.animSpeed
        let n = 0
        while (owed >= STEP && n < 12) {
          p.lab.step()
          owed -= STEP
          n++
        }
        if (n === 12) owed = 0
      }
      draw()
      // A new scene, or the parent appearing or leaving, frames the view anew.
      // After draw, so the walk-in-place offset is already applied.
      const sceneKey = `${p.lab.scene}|${p.lab.parent !== null}`
      if (!focused || pending || sceneKey !== lastScene) {
        frame()
        pending = false
        lastScene = sceneKey
      }
      controls.update()
      const moved = gate(camera.position, controls.target)
      renderer.render(scene, camera)
      const now = performance.now()
      if (now - lastReport > 200) {
        lastReport = now
        p.onReport(report(p.lab))
      }
      return p.running || moved
    })
    wakeRef.current = () => loop.wake()
    stepRef.current = () => {
      latest.current.lab.step()
      latest.current.onReport(report(latest.current.lab))
      loop.wake()
    }

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      loop.drawNow()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const stopWaking = wakeOnInput(loop)

    // Click (not drag) to select a joint.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downX = 0
    let downY = 0
    const onDown = (e: PointerEvent) => {
      downX = e.clientX
      downY = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      if (e.target !== renderer.domElement || Math.hypot(e.clientX - downX, e.clientY - downY) > 5 || !rig) return
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      latest.current.onSelect(rig.pick(raycaster, latest.current.lab.body))
      loop.wake()
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      rig?.dispose()
      parentRig?.dispose()
      habitat?.dispose()
      overlay.dispose()
      pad.geometry.dispose()
      ;(pad.material as THREE.Material).dispose()
      grid.geometry.dispose()
      ;(grid.material as THREE.Material).dispose()
      key.shadow.map?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // One step while paused.
  const firstStep = useRef(props.stepToken)
  useEffect(() => {
    if (props.stepToken !== firstStep.current) stepRef.current()
  }, [props.stepToken])

  const firstFrame = useRef(props.frameToken)
  useEffect(() => {
    if (props.frameToken !== firstFrame.current) frameRef.current()
  }, [props.frameToken])

  // Anything else that changes the picture while paused needs a frame.
  useEffect(() => {
    wakeRef.current()
  })

  return <div ref={containerRef} className="scene-canvas creature-viewport" />
}
