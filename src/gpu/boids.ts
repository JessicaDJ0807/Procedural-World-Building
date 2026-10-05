import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Field, createPass, dataTexture, runPass, seedField, type Uniforms } from './core'
import { createCameraGate } from '../renderLoop'
import { DUSK, GLSL_DUSK, createBackdrop, srgb } from './style'
import { defaults, param, type ParamSpec, type Pointer, type Simulation } from './simulation'
import { mulberry32 } from '../noise'

/**
 * Reynolds' boids, with every agent living in one texel.
 *
 * Position and velocity are two floating-point textures; one fish is one pixel
 * in each. A step is two passes — new velocity from the three rules, then new
 * position from that velocity — and every fish is evaluated in the same draw.
 *
 * The cost is the interesting part. Each fish reads every other fish, so the
 * work is O(N²): 1,024 fish is a million neighbour tests per step, 4,096 is
 * sixteen million. That wall is real, it is measured in the write-up, and it is
 * the reason production crowds use a spatial grid instead. Here the brute-force
 * version is the point — it is what makes the rule legible.
 */

/** Texture edge lengths. The fish count is the square of one of these. */
const SIZES = [16, 32, 48, 64, 96]

const velocityShader = (size: number) => /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPosition;
  uniform sampler2D uVelocity;
  uniform float uSeparation;
  uniform float uAlignment;
  uniform float uCohesion;
  uniform float uNeighbour;
  uniform float uPersonal;
  uniform float uMaxSpeed;
  uniform float uBounds;
  uniform vec3 uPredator;
  uniform float uPredatorRange;
  uniform float uPredatorForce;
  uniform float uDt;

  const float SIZE = ${size.toFixed(1)};

  void main() {
    vec3 pos = texture2D(uPosition, vUv).xyz;
    vec3 vel = texture2D(uVelocity, vUv).xyz;

    vec3 separation = vec3(0.0);
    vec3 alignment = vec3(0.0);
    vec3 centre = vec3(0.0);
    float neighbours = 0.0;

    // Loop bounds must be compile-time constant in GLSL ES 1.00, which is why
    // this shader is rebuilt whenever the fish count changes rather than
    // reading the count from a uniform.
    for (float y = 0.0; y < SIZE; y += 1.0) {
      for (float x = 0.0; x < SIZE; x += 1.0) {
        vec2 ref = (vec2(x, y) + 0.5) / SIZE;
        vec3 other = texture2D(uPosition, ref).xyz;
        vec3 offset = pos - other;
        float dist = length(offset);
        if (dist > 0.0001 && dist < uNeighbour) {
          centre += other;
          alignment += texture2D(uVelocity, ref).xyz;
          neighbours += 1.0;
          // Inverse-square push: a fish nearly touching another shoves much
          // harder than one merely close, which is what stops the school
          // collapsing to a point under cohesion alone.
          if (dist < uPersonal) separation += offset / (dist * dist);
        }
      }
    }

    vec3 accel = vec3(0.0);
    if (neighbours > 0.0) {
      centre /= neighbours;
      alignment /= neighbours;
      accel += (centre - pos) * uCohesion;
      accel += alignment * uAlignment;
      accel += separation * uSeparation;
    }

    // A soft shell rather than a wall: the further out a fish is, the harder it
    // is pulled back, so the school deforms at the boundary instead of
    // bouncing off it.
    float radius = length(pos);
    if (radius > uBounds) accel -= normalize(pos) * (radius - uBounds) * 2.4;

    if (uPredatorForce > 0.0) {
      vec3 away = pos - uPredator;
      float d = length(away);
      if (d < uPredatorRange && d > 0.0001) {
        accel += (away / d) * (1.0 - d / uPredatorRange) * uPredatorForce;
      }
    }

    vel += accel * uDt;

    // Fish do not hover. Clamping below as well as above is what keeps the
    // school moving rather than settling into a static cloud.
    float speed = length(vel);
    if (speed > uMaxSpeed) vel = vel / speed * uMaxSpeed;
    if (speed < uMaxSpeed * 0.35) vel = speed > 0.0001
      ? vel / speed * uMaxSpeed * 0.35
      : vec3(0.0, 0.0, uMaxSpeed * 0.35);

    gl_FragColor = vec4(vel, 1.0);
  }
`

const POSITION = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPosition;
  uniform sampler2D uVelocity;
  uniform float uDt;
  void main() {
    vec3 pos = texture2D(uPosition, vUv).xyz;
    vec3 vel = texture2D(uVelocity, vUv).xyz;
    gl_FragColor = vec4(pos + vel * uDt, 1.0);
  }
`

const FISH_VERTEX = /* glsl */ `
  attribute vec2 aRef;
  uniform sampler2D uPosition;
  uniform sampler2D uVelocity;
  varying vec3 vNormal;
  varying float vDepth;

  void main() {
    vec3 origin = texture2D(uPosition, aRef).xyz;
    vec3 vel = texture2D(uVelocity, aRef).xyz;

    // Orientation comes from velocity — a fish points where it is going. The
    // basis is built per vertex rather than stored, because the velocity
    // texture is the only place that heading exists.
    float speed = length(vel);
    vec3 forward = speed > 0.0001 ? vel / speed : vec3(0.0, 0.0, 1.0);
    vec3 reference = abs(forward.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(reference, forward));
    mat3 basis = mat3(right, cross(forward, right), forward);

    vec4 view = modelViewMatrix * vec4(origin + basis * position, 1.0);
    vNormal = normalMatrix * (basis * normal);
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`

const FISH_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying float vDepth;
  uniform vec3 uLight;
  uniform vec3 uAlbedo;
  uniform vec3 uBackground;

  ${GLSL_DUSK}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 colour = uAlbedo * duskLight(n, uLight);

    // Distance fades toward the backdrop rather than toward black, so the far
    // side of the school recedes into the air instead of into a void. The
    // previous version faded to a dark cyan, which read as deep water at
    // night — atmospheric, but the wrong atmosphere for this palette.
    float fog = clamp((vDepth - 6.0) / 14.0, 0.0, 1.0);
    gl_FragColor = vec4(mix(colour, uBackground, fog * 0.62), 1.0);
  }
`

const PARAMS: ParamSpec[] = [
  {
    key: 'count',
    label: 'School size',
    info: 'Fish, as the square of a texture edge. Every fish reads every other, so doubling the count quadruples the work — this is the dial that shows the O(N²) wall rather than describing it.',
    min: 0,
    max: SIZES.length - 1,
    step: 1,
    value: 1,
    format: (v) => `${(SIZES[Math.round(v)] ** 2).toLocaleString()} fish`,
    options: SIZES.map((edge, index) => ({ value: index, label: `${(edge * edge).toLocaleString()} fish` })),
  },
  {
    key: 'cohesion',
    label: 'Cohesion',
    info: 'Pull toward the average position of visible neighbours. This is what makes a school rather than a crowd; at zero the fish disperse until the bounds catch them.',
    min: 0,
    max: 6,
    step: 0.05,
    value: 3,
  },
  {
    key: 'alignment',
    label: 'Alignment',
    info: 'Pull toward the average heading of visible neighbours. Raising it makes the school turn as one sheet; lowering it lets the shape churn.',
    min: 0,
    max: 6,
    step: 0.05,
    value: 2.6,
  },
  {
    key: 'separation',
    label: 'Separation',
    info: 'Push away from anyone too close, weighted by inverse square distance. Without it cohesion wins and every fish converges on one point.',
    min: 0,
    max: 3,
    step: 0.02,
    value: 0.6,
  },
  {
    key: 'neighbour',
    label: 'Vision range',
    info: 'How far a fish can see. It does not change the cost — every pair is still tested — only how many of those tests count for anything.',
    min: 0.4,
    max: 4,
    step: 0.05,
    value: 2,
  },
  {
    key: 'personal',
    label: 'Personal space',
    info: 'Distance below which separation applies. Always smaller than vision range; if it is not, separation cancels cohesion everywhere.',
    min: 0.1,
    max: 1.6,
    step: 0.02,
    value: 0.5,
  },
  {
    key: 'speed',
    label: 'Swim speed',
    info: 'Maximum speed, in world units per second. A floor at 35% of this is applied too — a school that can stop looks like a cloud of debris.',
    min: 0.4,
    max: 6,
    step: 0.05,
    value: 2.4,
  },
  {
    key: 'bounds',
    label: 'Reef radius',
    info: 'Radius of the soft shell the school is kept inside. Past it the restoring pull grows with distance rather than reflecting, so the shape squashes instead of bouncing.',
    min: 1.5,
    max: 8,
    step: 0.1,
    value: 4.2,
  },
  {
    key: 'predator',
    label: 'Predator force',
    info: 'How hard the pointer pushes fish away while held down. This is the interaction: hold the cursor in the school and it splits around you, then closes behind.',
    min: 0,
    max: 30,
    step: 0.5,
    value: 14,
  },
  {
    key: 'range',
    label: 'Predator range',
    info: 'How far the pointer is felt. Wide and gentle parts the school; narrow and hard punches a hole through it.',
    min: 0.5,
    max: 4,
    step: 0.05,
    value: 1.6,
  },
]

function seedState(size: number, seed: number) {
  const random = mulberry32(seed)
  const count = size * size
  const positions = new Float32Array(count * 4)
  const velocities = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    // Rejection-free sphere fill: direction from a normalised gaussian-ish
    // triple, radius from a cube root so the volume fills evenly.
    let x = random() * 2 - 1
    let y = random() * 2 - 1
    let z = random() * 2 - 1
    const length = Math.hypot(x, y, z) || 1
    // Start compact. Seeded across the full bounds, the school spends its
    // first seconds finding itself rather than swimming.
    const radius = Math.cbrt(random()) * 1.8
    x = (x / length) * radius
    y = (y / length) * radius
    z = (z / length) * radius
    positions.set([x, y, z, 1], i * 4)
    velocities.set([random() - 0.5, random() - 0.5, random() - 0.5, 1], i * 4)
  }
  return { positions, velocities }
}

export function createBoids(): Simulation {
  let renderer: THREE.WebGLRenderer | null = null
  let position: Field | null = null
  let velocity: Field | null = null
  let velocityMaterial: THREE.ShaderMaterial | null = null
  let positionMaterial: THREE.ShaderMaterial
  let uniforms: Uniforms
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let controls: OrbitControls | null = null
  let geometry: THREE.InstancedBufferGeometry | null = null
  let fishMaterial: THREE.ShaderMaterial
  let mesh: THREE.Mesh | null = null
  let size = SIZES[1]
  let seed = 1
  let frames = 0
  // OrbitControls keeps moving the camera under damping after release.
  let cameraMoving = false
  const cameraGate = createCameraGate()

  const predator = new THREE.Vector3(0, 0, 0)
  const ray = new THREE.Ray()

  const build = (edge: number) => {
    if (!renderer) return
    size = edge
    position?.dispose()
    velocity?.dispose()
    position = new Field(edge, edge)
    velocity = new Field(edge, edge)

    velocityMaterial?.dispose()
    velocityMaterial = createPass(velocityShader(edge), uniforms)

    // One instance per texel, carrying the coordinate it should read.
    const refs = new Float32Array(edge * edge * 2)
    for (let y = 0; y < edge; y++) {
      for (let x = 0; x < edge; x++) {
        const i = (y * edge + x) * 2
        refs[i] = (x + 0.5) / edge
        refs[i + 1] = (y + 0.5) / edge
      }
    }

    geometry?.dispose()
    const cone = new THREE.ConeGeometry(0.055, 0.26, 5)
    cone.rotateX(Math.PI / 2) // point along +Z, which the vertex shader calls forward
    cone.scale(1, 0.55, 1) // flatten: a fish is taller than it is wide, not round
    const instanced = new THREE.InstancedBufferGeometry()
    instanced.index = cone.index
    instanced.attributes.position = cone.attributes.position
    instanced.attributes.normal = cone.attributes.normal
    instanced.setAttribute('aRef', new THREE.InstancedBufferAttribute(refs, 2))
    instanced.instanceCount = edge * edge
    cone.dispose()
    geometry = instanced

    if (mesh) scene.remove(mesh)
    mesh = new THREE.Mesh(instanced, fishMaterial)
    mesh.frustumCulled = false // positions live on the GPU; three cannot bound them
    scene.add(mesh)
  }

  const reseed = () => {
    if (!renderer || !position || !velocity) return
    seed += 13
    const { positions, velocities } = seedState(size, seed)
    const positionTexture = dataTexture(positions, size, size)
    const velocityTexture = dataTexture(velocities, size, size)
    seedField(renderer, position, positionTexture)
    seedField(renderer, velocity, velocityTexture)
    positionTexture.dispose()
    velocityTexture.dispose()
  }

  return {
    id: 'boids',
    label: 'Fish schooling',
    blurb:
      'Reynolds’ three rules, one fish per texel. Every fish reads every other, so the cost is the square of the school — which is the point.',
    params: PARAMS,
    presets: [
      {
        value: 'school',
        label: 'Tight school',
        hint: 'High alignment and cohesion — a single sheet that turns as one body.',
        params: { cohesion: 3.4, alignment: 3.4, separation: 0.6, neighbour: 2.2, speed: 2.4 },
      },
      {
        value: 'bait',
        label: 'Bait ball',
        hint: 'Cohesion far above alignment: a dense churning sphere rather than a directed school.',
        params: { cohesion: 5.0, alignment: 1.0, separation: 1.0, neighbour: 2.6, speed: 2.0 },
      },
      {
        value: 'scatter',
        label: 'Loose scatter',
        hint: 'Weak cohesion and strong separation — individuals that barely acknowledge each other.',
        params: { cohesion: 0.5, alignment: 0.8, separation: 1.6, neighbour: 1.1, speed: 3.0 },
      },
    ],

    init(webglRenderer, canvas) {
      renderer = webglRenderer
      scene = new THREE.Scene()
      scene.add(createBackdrop(DUSK.background, DUSK.backgroundLow))
      camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100)
      camera.position.set(0, 1.5, 11.2)
      controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true
      controls.enablePan = false

      uniforms = {
        uPosition: { value: null },
        uVelocity: { value: null },
        uSeparation: { value: 0.6 },
        uAlignment: { value: 2.6 },
        uCohesion: { value: 3 },
        uNeighbour: { value: 2 },
        uPersonal: { value: 0.5 },
        uMaxSpeed: { value: 2.4 },
        uBounds: { value: 4.2 },
        uPredator: { value: predator },
        uPredatorRange: { value: 1.6 },
        uPredatorForce: { value: 0 },
        uDt: { value: 1 / 60 },
      }
      positionMaterial = createPass(POSITION, uniforms)
      fishMaterial = new THREE.ShaderMaterial({
        vertexShader: FISH_VERTEX,
        fragmentShader: FISH_FRAGMENT,
        uniforms: {
          uPosition: { value: null },
          uVelocity: { value: null },
          uLight: { value: new THREE.Vector3(0.36, 0.78, 0.52).normalize() },
          // Back to clay now the ground is dark: against a pale sky the fish
          // needed to be darker than the palette's mid tone, and against a
          // deep one they need to be lighter. Same requirement, opposite sign.
          uAlbedo: { value: srgb(DUSK.clay) },
          uBackground: { value: srgb(DUSK.background) },
        },
      })

      build(SIZES[Math.round(defaults(PARAMS).count)])
      reseed()
    },

    reset() {
      reseed()
      frames = 0
    },

    step(params, pointer: Pointer) {
      if (!renderer || !position || !velocity || !velocityMaterial) return

      const wanted = SIZES[Math.round(param(params, PARAMS, 'count'))]
      if (wanted !== size) {
        build(wanted)
        reseed()
      }

      uniforms.uCohesion.value = param(params, PARAMS, 'cohesion')
      uniforms.uAlignment.value = param(params, PARAMS, 'alignment')
      uniforms.uSeparation.value = param(params, PARAMS, 'separation')
      uniforms.uNeighbour.value = param(params, PARAMS, 'neighbour')
      uniforms.uPersonal.value = param(params, PARAMS, 'personal')
      uniforms.uMaxSpeed.value = param(params, PARAMS, 'speed')
      uniforms.uBounds.value = param(params, PARAMS, 'bounds')
      uniforms.uPredatorRange.value = param(params, PARAMS, 'range')
      uniforms.uPredatorForce.value = pointer.active ? param(params, PARAMS, 'predator') : 0

      if (pointer.active) {
        // The cursor is a ray, not a point. The predator is placed at the point
        // on that ray closest to the origin, which puts it in the middle of the
        // school rather than on the glass in front of it.
        ray.origin.setFromMatrixPosition(camera.matrixWorld)
        ray.direction
          .set(pointer.ndcX, pointer.ndcY, 0.5)
          .unproject(camera)
          .sub(ray.origin)
          .normalize()
        const along = -ray.origin.dot(ray.direction)
        predator.copy(ray.direction).multiplyScalar(Math.max(along, 0)).add(ray.origin)
      }

      uniforms.uPosition.value = position.texture
      uniforms.uVelocity.value = velocity.texture
      runPass(renderer, velocityMaterial, velocity.target)
      velocity.swap()

      uniforms.uVelocity.value = velocity.texture
      runPass(renderer, positionMaterial, position.target)
      position.swap()

      frames += 1
    },

    draw(webglRenderer) {
      if (!position || !velocity || !mesh) return
      fishMaterial.uniforms.uPosition.value = position.texture
      fishMaterial.uniforms.uVelocity.value = velocity.texture
      controls?.update()
      cameraMoving = cameraGate(camera.position, controls?.target ?? camera.position)
      webglRenderer.setRenderTarget(null)
      webglRenderer.render(scene, camera)
    },

    resize(width, height) {
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    },

    animating() {
      return cameraMoving
    },

    stats() {
      const count = size * size
      return [
        { label: 'fish', value: `${size}² = ${count.toLocaleString()}` },
        { label: 'neighbour tests / step', value: (count * count).toLocaleString() },
        { label: 'steps since reset', value: frames.toLocaleString() },
      ]
    },

    dispose() {
      controls?.dispose()
      position?.dispose()
      velocity?.dispose()
      geometry?.dispose()
      velocityMaterial?.dispose()
      positionMaterial?.dispose()
      fishMaterial?.dispose()
      position = null
      velocity = null
      renderer = null
      controls = null
    },
  }
}
