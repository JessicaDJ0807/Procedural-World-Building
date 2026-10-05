import * as THREE from 'three'

/**
 * Plumbing shared by every simulation on the shader page.
 *
 * All four simulations are the same machine: state lives in a floating-point
 * texture, and one step is a full-screen quad drawn through a fragment shader
 * that reads the old state and writes the new one. A texture cannot be read and
 * written in the same draw, so each field keeps two targets and swaps them —
 * "ping-pong". That constraint is the whole reason this file exists.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // The quad already covers clip space; no camera transform is wanted.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// One quad, reused by every pass on the page. Passes differ only in material,
// so rebuilding the geometry per simulation would allocate for no reason.
const quadScene = new THREE.Scene()
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
quadScene.add(quadMesh)

export type Uniforms = Record<string, THREE.IUniform>

/** A fragment shader that writes one full-screen pass. */
export function createPass(fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
}

/** Draws one pass into `target`, or to the canvas when `target` is null. */
export function runPass(
  renderer: THREE.WebGLRenderer,
  material: THREE.ShaderMaterial,
  target: THREE.WebGLRenderTarget | null,
) {
  quadMesh.material = material
  renderer.setRenderTarget(target)
  renderer.render(quadScene, quadCamera)
  renderer.setRenderTarget(null)
}

function createTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    // Nearest everywhere: a simulation cell is a value, not a sample of a
    // smooth image. Linear filtering would silently blur state between steps
    // and show up as diffusion nobody asked for.
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  })
}

/**
 * A ping-pong pair.
 *
 * Read `texture`, write `target`, then `swap()`. Every simulation step in this
 * folder is that three-line dance.
 */
export class Field {
  private front: THREE.WebGLRenderTarget
  private back: THREE.WebGLRenderTarget

  constructor(width: number, height: number) {
    this.front = createTarget(width, height)
    this.back = createTarget(width, height)
  }

  /** The current state, for a shader to read. */
  get texture(): THREE.Texture {
    return this.front.texture
  }

  /** Where the next state is written. */
  get target(): THREE.WebGLRenderTarget {
    return this.back
  }

  /** The current state as a render target, for reading pixels back. */
  get source(): THREE.WebGLRenderTarget {
    return this.front
  }

  swap() {
    const swap = this.front
    this.front = this.back
    this.back = swap
  }

  dispose() {
    this.front.dispose()
    this.back.dispose()
  }
}

/** A `DataTexture` carrying RGBA floats, for seeding a field from the CPU. */
export function dataTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

const COPY = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource;
  void main() { gl_FragColor = texture2D(uSource, vUv); }
`

/**
 * Writes `source` into both halves of a field.
 *
 * Both, not one: a field that has only been seeded on the front buffer shows a
 * one-step flicker of stale data the first time it swaps.
 */
export function seedField(
  renderer: THREE.WebGLRenderer,
  field: Field,
  source: THREE.Texture,
) {
  const material = createPass(COPY, { uSource: { value: source } })
  runPass(renderer, material, field.target)
  field.swap()
  runPass(renderer, material, field.target)
  field.swap()
  material.dispose()
}

/**
 * A 256×1 lookup of Topic 2's colour ramps, as a texture.
 *
 * The ramps are interpolated in OKLab on the CPU in `palette.ts`; sampling the
 * result is both cheaper than redoing that in GLSL and guaranteed to agree with
 * what Topic 2 draws for the same value.
 */
export function rampTexture(linear: Float32Array): THREE.DataTexture {
  const data = new Float32Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    data[i * 4] = linear[i * 3]
    data[i * 4 + 1] = linear[i * 3 + 1]
    data[i * 4 + 2] = linear[i * 3 + 2]
    data[i * 4 + 3] = 1
  }
  const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

/** GLSL every field simulation wants: neighbour offsets and a Laplacian. */
export const GLSL_LAPLACIAN = /* glsl */ `
  // Five-point stencil. At the border ClampToEdge makes the outside neighbour
  // equal to this cell, which zeroes the gradient across the wall — a
  // reflecting (Neumann) boundary, and why waves bounce off the edges here.
  vec4 laplacian(sampler2D field, vec2 uv, vec2 texel) {
    vec4 sum = texture2D(field, uv + vec2(texel.x, 0.0))
             + texture2D(field, uv - vec2(texel.x, 0.0))
             + texture2D(field, uv + vec2(0.0, texel.y))
             + texture2D(field, uv - vec2(0.0, texel.y));
    return sum - 4.0 * texture2D(field, uv);
  }
`

/**
 * Pointer position in a square field's texture coordinates.
 *
 * The field is square and the viewport usually is not, so the display shader
 * letterboxes it. This is the same transform inverted — it has to be, or the
 * ripple lands somewhere other than the cursor.
 */
export function fieldUvFromNdc(
  ndcX: number,
  ndcY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const aspect = width / height
  const scaleX = aspect > 1 ? aspect : 1
  const scaleY = aspect > 1 ? 1 : 1 / aspect
  return {
    x: (ndcX * 0.5) * scaleX + 0.5,
    y: (ndcY * 0.5) * scaleY + 0.5,
  }
}

/** The matching GLSL: maps a screen UV onto the square field, letterboxed. */
export const GLSL_FIT_SQUARE = /* glsl */ `
  vec2 fitSquare(vec2 uv, vec2 viewport) {
    float aspect = viewport.x / viewport.y;
    vec2 scale = aspect > 1.0 ? vec2(aspect, 1.0) : vec2(1.0, 1.0 / aspect);
    return (uv - 0.5) * scale + 0.5;
  }
`
