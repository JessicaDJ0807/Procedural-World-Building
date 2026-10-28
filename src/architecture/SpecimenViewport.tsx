import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyViewControls } from '../cameraControls'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { livingObject, type LivingObject } from '../build/livingMesh'
import { buildTown } from '../build/townMesh'
import { TOWN_SCALE } from '../build/townBuilding'
import type { Living, V3 } from '../build/living'
import type { Specimen } from './specimens'
import { GROWTH_COLOURS, STRUCTURE_COLOURS, type ViewMode } from './views'

type Label = { text: string; at: V3; modes: ViewMode[] }

/**
 * The studio, built once: a pale floor fading into a pale backdrop, soft sky
 * light and one shadowing key light. Per specimen, only its own objects are
 * swapped in: Build's `buildTown` geometry in one pale material for the
 * supporting buildings, Build's `livingObject` for the structure, and the
 * Growth view's picture of the plants. A view mode swaps materials and
 * visibility; the timeline calls the structure's own `grow(age)` — the same
 * function Build animates it with.
 *
 * Labels are HTML, placed each frame at points of the structure itself (its
 * node, its deck, a frame member, a root), and only in the views that explain.
 */
export function SpecimenViewport({ specimen, mode, age, resetToken }: { specimen: Specimen; mode: ViewMode; age: number; resetToken: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const api = useRef<{ show: (s: Specimen) => void; setMode: (m: ViewMode) => void; setAge: (a: number) => void; reset: () => void } | null>(null)
  const latest = useRef({ mode, age })
  useEffect(() => {
    latest.current = { mode, age }
  })

  // The studio: once.
  useEffect(() => {
    const container = containerRef.current
    const labelLayer = labelsRef.current
    if (!container || !labelLayer) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    container.insertBefore(renderer.domElement, labelLayer)

    const STUDIO = new THREE.Color('#eceae6')
    const scene = new THREE.Scene()
    scene.background = STUDIO
    scene.fog = new THREE.Fog(STUDIO, 40, 90)
    const camera = new THREE.PerspectiveCamera(30, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 400)
    const controls = new OrbitControls(camera, renderer.domElement)
    applyViewControls(controls, { ground: true })
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.49
    const gate = createCameraGate()

    scene.add(new THREE.HemisphereLight('#ffffff', '#cfc9bf', 1.7))
    const key = new THREE.DirectionalLight('#fff8ef', 2.2)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    scene.add(key, key.target)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e3e0da', roughness: 1 }))
    floor.position.y = -0.01
    floor.receiveShadow = true
    scene.add(floor)

    // Materials shared by every specimen.
    const townMaterial = new THREE.MeshStandardMaterial({ color: '#d6d2cb', roughness: 0.95 })
    const structDeck = new THREE.MeshStandardMaterial({ color: STRUCTURE_COLOURS.deck, roughness: 0.9, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide })
    const structFrame = new THREE.MeshStandardMaterial({ color: STRUCTURE_COLOURS.frame, roughness: 0.7 })
    const structRoots = new THREE.MeshStandardMaterial({ color: STRUCTURE_COLOURS.roots, roughness: 0.8 })
    const ghost = new THREE.MeshStandardMaterial({ color: '#c9c2b6', roughness: 0.9, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })
    const cellGeo = new THREE.PlaneGeometry(0.2, 0.2)
    const cellMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    const seedGeo = new THREE.SphereGeometry(0.12, 12, 8)

    type Current = {
      specimen: Specimen
      root: THREE.Group
      town: THREE.Mesh
      living: LivingObject
      originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>
      growth: THREE.Group
      disposables: { dispose: () => void }[]
      labels: { el: HTMLDivElement; at: THREE.Vector3; modes: ViewMode[] }[]
      centre: THREE.Vector3
      radius: number
    }
    let current: Current | null = null

    const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2])

    /** The Growth view's picture: plant layers as small squares on their cells, stems, seeds, the meeting, the headings. */
    const growthGroup = (s: Specimen, disposables: Current['disposables']) => {
      const g = new THREE.Group()
      const G = s.growth
      const col = new THREE.Color()
      const cells = new THREE.InstancedMesh(cellGeo, cellMat, Math.max(1, G.layers.length))
      const m4 = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const z = new THREE.Vector3(0, 0, 1)
      G.layers.forEach((L, k) => {
        const n = v3(L.n)
        q.setFromUnitVectors(z, n)
        // Each layer a little further off the wall than the one under it, as in Build.
        m4.compose(v3(L.p).addScaledVector(n, 0.04 + L.level * 0.06), q, new THREE.Vector3(1, 1, 1))
        cells.setMatrixAt(k, m4)
        cells.setColorAt(k, col.set(L.species === 0 ? GROWTH_COLOURS.climber : GROWTH_COLOURS.spreader))
      })
      cells.count = G.layers.length
      g.add(cells)
      disposables.push(cells)
      // Stems, coloured by species.
      for (const [sp, colour] of [
        [0, GROWTH_COLOURS.climber],
        [1, GROWTH_COLOURS.spreader],
      ] as const) {
        const pts: number[] = []
        for (const st of G.stems) if (st.species === sp) pts.push(...st.a, ...st.b)
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(0.6) })
        g.add(new THREE.LineSegments(geo, mat))
        disposables.push(geo, mat)
      }
      // The meeting: the cells whose combination made the node, outlined in amber.
      const meetMat = new THREE.MeshBasicMaterial({ color: GROWTH_COLOURS.meeting, side: THREE.DoubleSide })
      const ringGeo = new THREE.RingGeometry(0.13, 0.19, 16)
      disposables.push(meetMat, ringGeo)
      const nodeN = v3(s.living.normal)
      for (const p of G.meeting) {
        const ring = new THREE.Mesh(ringGeo, meetMat)
        ring.position.copy(v3(p)).addScaledVector(nodeN, 0.25)
        ring.quaternion.setFromUnitVectors(z, nodeN)
        g.add(ring)
      }
      for (const sd of G.seeds) {
        const m = new THREE.Mesh(seedGeo, new THREE.MeshBasicMaterial({ color: sd.species === 0 ? GROWTH_COLOURS.climber : GROWTH_COLOURS.spreader }))
        disposables.push(m.material as THREE.Material)
        m.position.copy(v3(sd.p))
        g.add(m)
      }
      // The headings the planner read, as arrows from the node.
      const node = v3(s.living.node).addScaledVector(nodeN, 0.4)
      for (const [dir, colour] of [
        [G.heading.climber, GROWTH_COLOURS.climber],
        [G.heading.spreader, GROWTH_COLOURS.spreader],
      ] as const) {
        if (Math.hypot(...dir) < 0.5) continue
        const arrow = new THREE.ArrowHelper(v3(dir), node, 3, new THREE.Color(colour).multiplyScalar(0.75), 0.7, 0.45)
        // Drawn over the ghosted structure, which would otherwise hide them.
        for (const part of [arrow.line, arrow.cone]) {
          ;(part.material as THREE.Material).depthTest = false
          part.renderOrder = 10
        }
        g.add(arrow)
        disposables.push(arrow)
      }
      return g
    }

    /** Points on the structure to label, from its own geometry. */
    const labelsFor = (s: Specimen): Label[] => {
      const l: Living = s.living
      const out: Label[] = [{ text: 'Mutation node', at: l.node, modes: ['structure', 'growth'] }]
      const d = l.decks[0]
      if (d) out.push({ text: l.kind === 'scaffold' ? 'Stair pad' : 'Deck', at: d.centre[Math.floor(d.centre.length / 2)], modes: ['structure'] })
      const f = l.frame[0]
      if (f) out.push({ text: l.kind === 'scaffold' ? 'Helical rail' : l.kind === 'terrace' || l.kind === 'canopy' ? 'Rib' : 'Rail', at: f[Math.floor(f.length * 0.7)], modes: ['structure'] })
      const r = l.roots.reduce((a, c) => (c[c.length - 1][1] < a[a.length - 1][1] ? c : a), l.roots[0])
      if (r) out.push({ text: r[r.length - 1][1] < 0.4 ? 'Column, rooted' : 'Roots', at: r[r.length - 1], modes: ['structure'] })
      if (l.ends.to) {
        const last = l.kind === 'bridge' ? l.decks[1]?.centre[0] : l.decks[l.decks.length - 1]?.centre.at(-1)
        if (last) out.push({ text: 'Reaches the neighbour', at: last, modes: ['structure'] })
      }
      const G = s.growth
      if (G.seeds.length) out.push({ text: 'Seeds', at: G.seeds[0].p, modes: ['growth'] })
      const n = l.node
      const head = (dir: V3, text: string) => {
        if (Math.hypot(...dir) < 0.5) return
        out.push({ text, at: [n[0] + l.normal[0] * 0.4 + dir[0] * 3.2, n[1], n[2] + l.normal[2] * 0.4 + dir[2] * 3.2], modes: ['growth'] })
      }
      head(G.heading.climber, 'Climber heading')
      head(G.heading.spreader, 'Spreader heading')
      return out
    }

    const applyMode = () => {
      if (!current) return
      const m = latest.current.mode
      const p = current.living.parts
      for (const [mesh, original] of current.originals) mesh.material = original
      if (m === 'structure') {
        for (const d of p.decks) d.material = structDeck
        for (const t of p.frame) t.material = structFrame
        for (const t of p.roots) t.material = structRoots
        p.leaves.visible = false
      } else if (m === 'growth') {
        for (const mesh of current.originals.keys()) mesh.material = ghost
        p.leaves.visible = false
        p.knot.visible = false
      }
      current.growth.visible = m === 'growth'
      for (const lab of current.labels) lab.el.hidden = !lab.modes.includes(m)
      loop.wake()
    }

    const setAge = (a: number) => {
      if (!current) return
      current.living.grow(a)
      // grow() shows the leaves and knot as their stages come; the explaining views keep them hidden.
      if (latest.current.mode !== 'material') current.living.parts.leaves.visible = false
      if (latest.current.mode === 'growth') current.living.parts.knot.visible = false
      renderer.shadowMap.needsUpdate = true
      loop.wake()
    }

    // A camera move, eased over a moment rather than a cut.
    let tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null
    const frameView = (smooth: boolean) => {
      if (!current) return
      const { centre, radius } = current
      const n = current.specimen.living.normal
      // Across the structure's longest extent: a bridge side-on, a deck in profile.
      const pts = current.specimen.living.decks.flatMap((d) => d.centre)
      let span = new THREE.Vector3()
      for (const a of pts)
        for (const b of pts) {
          const v = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2])
          if (v.lengthSq() > span.lengthSq()) span = v
        }
      let across: THREE.Vector3
      let along: THREE.Vector3
      if (span.length() > 3) {
        along = span.normalize()
        // Shifted toward the wall it grows from, looking out across it — not
        // from the far side, where the building it reaches toward stood in
        // the way (a free terrace was hidden behind its four-storey neighbour).
        if (along.x * n[0] + along.z * n[2] > 0) along.negate()
        across = new THREE.Vector3(-along.z, 0, along.x)
        if (across.x * (n[0] + 0.3) + across.z * (n[2] + 0.3) < 0) across.negate()
      } else {
        across = new THREE.Vector3(n[0], 0, n[2])
        along = new THREE.Vector3(-n[2], 0, n[0])
      }
      const dir = across.multiplyScalar(0.8).addScaledVector(along, 0.45).add(new THREE.Vector3(0, 0.55, 0)).normalize()
      const fit = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * (camera.aspect < 1 ? 1.35 / camera.aspect : 1.05)
      const pos = centre.clone().addScaledVector(dir, fit)
      if (smooth) tween = { from: [camera.position.clone(), controls.target.clone()], to: [pos, centre.clone()], t: 0 }
      else {
        tween = null
        camera.position.copy(pos)
        controls.target.copy(centre)
        controls.update()
      }
      loop.wake()
    }

    const clear = () => {
      if (!current) return
      scene.remove(current.root)
      current.living.dispose()
      current.town.geometry.dispose()
      for (const d of current.disposables) d.dispose()
      for (const lab of current.labels) lab.el.remove()
      current = null
    }

    const show = (s: Specimen) => {
      const first = !current
      clear()
      const root = new THREE.Group()
      const town = new THREE.Mesh(buildTown(s.town).geometry, townMaterial)
      town.castShadow = true
      town.receiveShadow = true
      root.add(town)
      const grown = new THREE.Group()
      grown.scale.setScalar(1 / TOWN_SCALE)
      const living = livingObject(s.living)
      living.grow(600)
      grown.add(living.group)
      const disposables: Current['disposables'] = []
      const growth = growthGroup(s, disposables)
      grown.add(growth)
      root.add(grown)
      scene.add(root)
      const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
      living.group.traverse((o) => {
        if (o instanceof THREE.Mesh) originals.set(o, o.material)
      })
      growth.visible = false
      // World matrices first: the structure sits in a group scaled to the town,
      // and measured before that scale applied it came out three times its size.
      root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(living.group).union(new THREE.Box3().setFromObject(town))
      const centre = box.getCenter(new THREE.Vector3())
      const radius = box.getBoundingSphere(new THREE.Sphere()).radius
      const labels = labelsFor(s).map((L) => {
        const el = document.createElement('div')
        el.className = 'specimen-label'
        el.textContent = L.text
        labelLayer.appendChild(el)
        return { el, at: v3(L.at).divideScalar(TOWN_SCALE), modes: L.modes }
      })
      current = { specimen: s, root, town, living, originals, growth, disposables, labels, centre, radius }
      floor.scale.setScalar(radius * 12)
      scene.fog = new THREE.Fog(STUDIO, radius * 4, radius * 9)
      key.position.copy(centre).add(new THREE.Vector3(-0.6, 1.3, 0.8).multiplyScalar(radius * 2.5))
      key.target.position.copy(centre)
      Object.assign(key.shadow.camera, { left: -radius * 1.4, right: radius * 1.4, top: radius * 1.4, bottom: -radius * 1.4, near: 0.1, far: radius * 6 })
      key.shadow.camera.updateProjectionMatrix()
      controls.minDistance = radius * 0.5
      controls.maxDistance = radius * 6
      applyMode()
      setAge(latest.current.age)
      frameView(!first)
    }

    const projected = new THREE.Vector3()
    const placeLabels = () => {
      if (!current) return
      const w = container.clientWidth
      const h = container.clientHeight
      // Project, then nudge any label that would sit on another down by a
      // line: points on a structure are close together on screen.
      const placed: { x: number; y: number; w: number; el: HTMLDivElement }[] = []
      for (const lab of current.labels) {
        if (lab.el.hidden) continue
        projected.copy(lab.at).project(camera)
        const off = projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05
        lab.el.style.visibility = off ? 'hidden' : 'visible'
        if (off) continue
        placed.push({ x: ((projected.x + 1) / 2) * w, y: ((1 - projected.y) / 2) * h, w: lab.el.offsetWidth || 90, el: lab.el })
      }
      placed.sort((a, b) => a.y - b.y)
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i]
        for (let j = 0; j < i; j++) {
          const q = placed[j]
          if (Math.abs(p.y - q.y) < 20 && p.x < q.x + q.w + 8 && q.x < p.x + p.w + 8) p.y = q.y + 20
        }
        p.el.style.transform = `translate(${p.x}px, ${p.y}px)`
      }
    }

    const loop = startRenderLoop((delta) => {
      let moving = false
      if (tween) {
        tween.t = Math.min(1, tween.t + delta / 0.7)
        const e = tween.t * tween.t * (3 - 2 * tween.t)
        camera.position.lerpVectors(tween.from[0], tween.to[0], e)
        controls.target.lerpVectors(tween.from[1], tween.to[1], e)
        moving = tween.t < 1
        if (!moving) tween = null
      }
      controls.update()
      renderer.render(scene, camera)
      placeLabels()
      return moving || gate(camera.position, controls.target)
    })
    const stopWaking = wakeOnInput(loop)
    const observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      loop.wake()
    })
    observer.observe(container)

    if (import.meta.env.DEV) {
      // Dev only: GPU resources held, to check that switching specimens and views frees what it replaces.
      ;(window as unknown as Record<string, unknown>).__specimenMemory = () => ({ ...renderer.info.memory })
    }

    api.current = {
      show,
      setMode: applyMode,
      setAge,
      reset: () => frameView(true),
    }

    return () => {
      api.current = null
      clear()
      stopWaking()
      observer.disconnect()
      loop.dispose()
      controls.dispose()
      for (const m of [townMaterial, structDeck, structFrame, structRoots, ghost, cellMat, floor.material as THREE.Material]) m.dispose()
      for (const g of [cellGeo, seedGeo, floor.geometry]) g.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    api.current?.show(specimen)
  }, [specimen])
  useEffect(() => {
    api.current?.setMode(mode)
  }, [mode])
  useEffect(() => {
    api.current?.setAge(age)
  }, [age])
  const first = useRef(resetToken)
  useEffect(() => {
    if (resetToken !== first.current) api.current?.reset()
  }, [resetToken])

  return (
    <div className="specimen-viewport" ref={containerRef}>
      <div className="specimen-labels" ref={labelsRef} aria-hidden="true" />
    </div>
  )
}
