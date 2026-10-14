import * as THREE from 'three'
import { VINE_FLOWERS } from './siteLook'

/**
 * Vegetation at Site scale: the growth's cells drawn as plant masses rather
 * than as squares.
 *
 * The simulation keeps its cells; only the picture changes. Two cell
 * textures carry the growth to the GPU, one texel per cell:
 *
 * - **colour**: each grown cell's colour (species, age, stress — siteLook's
 *   growthColour) premultiplied by its **occupancy** in alpha: 1 when grown,
 *   fading to 0 as a dead cell withers, 0 when empty. Stored linear, so the
 *   GPU's filtering blends it correctly and dividing by alpha gives the colour
 *   back.
 * - **kind**: which species holds the cell, one channel each (ivy, moss,
 *   vine), and in alpha whether it is in flower.
 *
 * The overlay samples both *smoothly*, so between cell centres occupancy is a
 * continuous field, and draws the plant where it crosses one half. That edge
 * runs halfway between a grown cell and an empty one: an empty cell's centre
 * is always 0, so a hole stays a hole and nothing is filled in; a lone grown
 * cell is a small round patch; a stand is one continuous mass whose outline
 * follows the growth. A world-space noise roughens the edge so it reads as
 * grown, and gives each species its surface:
 *
 * - **ivy**: dense leafy lumps, high contrast — leaves catching light;
 * - **moss**: soft, broad mottling, low contrast — a surface, not a plant;
 * - **vine**: an airier pattern with gaps, and lavender flecks on cells in
 *   flower.
 *
 * The pattern is level-of-detail in the shader: as its scale shrinks below a
 * pixel it fades to its average, so from far away a façade reads as smooth
 * masses of the species' colour, and close up as foliage — never as
 * shimmering noise. With `raw` on, the overlay instead draws the cells as
 * they are, hard-edged squares: the debug view for checking the masses
 * against the simulation.
 */

export type VegetationOverlay = {
  material: THREE.MeshStandardMaterial
  colour: THREE.DataTexture
  kind: THREE.DataTexture
  colourData: Uint8Array
  kindData: Uint8Array
  setRaw: (raw: boolean) => void
  dispose: () => void
}

const GLSL_NOISE = /* glsl */ `
  float vegHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vegNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(vegHash(i), vegHash(i + vec3(1, 0, 0)), f.x), mix(vegHash(i + vec3(0, 1, 0)), vegHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(vegHash(i + vec3(0, 0, 1)), vegHash(i + vec3(1, 0, 1)), f.x), mix(vegHash(i + vec3(0, 1, 1)), vegHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`

export function vegetationOverlay(width: number, height: number): VegetationOverlay {
  const colourData = new Uint8Array(width * height * 4)
  const kindData = new Uint8Array(width * height * 4)
  const texture = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    // Linear data: the colour is premultiplied in linear space so that
    // filtering and the divide by alpha are exact.
    t.colorSpace = THREE.NoColorSpace
    return t
  }
  const colour = texture(colourData)
  const kind = texture(kindData)
  const uniforms = {
    uKind: { value: kind },
    uRaw: { value: 0 },
    uFlowerA: { value: VINE_FLOWERS[0].clone() },
    uFlowerB: { value: VINE_FLOWERS[1].clone() },
  }
  const material = new THREE.MeshStandardMaterial({
    map: colour,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    // Coplanar with the surface it covers: drawn just in front of it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec3 vVegWorld;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vVegWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    )
    shader.fragmentShader =
      `varying vec3 vVegWorld;
      uniform sampler2D uKind;
      uniform float uRaw;
      uniform vec3 uFlowerA, uFlowerB;
      ${GLSL_NOISE}
      ` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec4 vegC = texture2D(map, vMapUv);
        vec4 vegK = texture2D(uKind, vMapUv);
        float occ = vegC.a;
        vec3 vegCol = vegC.rgb / max(occ, 1e-4);
        float vegAlpha;
        if (uRaw > 0.5) {
          vegAlpha = step(0.5, occ);
        } else {
          float ivy = vegK.r, moss = vegK.g, vine = vegK.b;
          float total = max(ivy + moss + vine, 1e-4);
          ivy /= total; moss /= total; vine /= total;
          // How many pixels one cycle of a 3-per-metre pattern spans: past a
          // pixel or so the pattern fades to its average — LOD in the shader.
          float footprint = length(fwidth(vVegWorld)) * 3.0;
          float detail = 1.0 - smoothstep(0.35, 0.9, footprint);
          float lumps = vegNoise(vVegWorld * 3.0);
          float fine = vegNoise(vVegWorld * 7.0 + 11.0);
          float broad = vegNoise(vVegWorld * 0.9 + 3.0);
          // Edge: a rough outline, rougher for the vine, softer and broader for moss.
          float rough = (lumps - 0.5) * (0.42 * ivy + 0.55 * vine) + (broad - 0.5) * 0.5 * moss;
          float e = occ + rough * (0.4 + 0.6 * detail);
          float w = max(fwidth(e), 0.03);
          vegAlpha = smoothstep(0.5 - w, 0.5 + w, e);
          // The vine is airy: gaps in its cover where the fine pattern is low.
          vegAlpha *= 1.0 - vine * 0.55 * detail * (1.0 - smoothstep(0.32, 0.55, fine));
          // Surface: leafy light and dark for ivy, gentle mottling for moss.
          float leafy = mix(0.62, 1.32, lumps * 0.65 + fine * 0.35);
          float mottle = mix(0.86, 1.1, broad);
          float shade = ivy * leafy + vine * mix(0.78, 1.22, fine) + moss * mottle;
          vegCol *= mix(1.0, shade, detail);
          // Flowers: lavender flecks on vine cells in flower up close; a faint tint far away.
          float bloom = vegK.a;
          float fleck = step(0.8, vegNoise(vVegWorld * 9.0 + 5.0)) * bloom * detail;
          vec3 flower = mix(uFlowerA, uFlowerB, step(0.5, vegNoise(vVegWorld * 2.0)));
          vegCol = mix(vegCol, flower, max(fleck, bloom * 0.18 * (1.0 - detail)));
        }
        if (vegAlpha < 0.01) discard;
        diffuseColor.rgb = vegCol;
        diffuseColor.a = vegAlpha;
        `,
      )
  }
  const setRaw = (raw: boolean) => {
    uniforms.uRaw.value = raw ? 1 : 0
    for (const t of [colour, kind]) {
      t.magFilter = raw ? THREE.NearestFilter : THREE.LinearFilter
      t.minFilter = raw ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter
      t.needsUpdate = true
    }
  }
  return {
    material,
    colour,
    kind,
    colourData,
    kindData,
    setRaw,
    dispose: () => {
      material.dispose()
      colour.dispose()
      kind.dispose()
    },
  }
}

/** Writes one cell into the two textures: colour premultiplied by occupancy, and its species and flowering. */
export function writeVegetation(
  overlay: VegetationOverlay,
  texel: number,
  colour: THREE.Color | null,
  occupancy: number,
  species: number,
  flowering: boolean,
) {
  const t = texel * 4
  const c = overlay.colourData
  const k = overlay.kindData
  if (!colour || occupancy <= 0) {
    c[t] = c[t + 1] = c[t + 2] = c[t + 3] = 0
    k[t] = k[t + 1] = k[t + 2] = k[t + 3] = 0
    return
  }
  const a = Math.min(1, occupancy)
  // THREE.Color is linear: exactly what the linear textures want.
  c[t] = Math.round(Math.min(1, colour.r) * a * 255)
  c[t + 1] = Math.round(Math.min(1, colour.g) * a * 255)
  c[t + 2] = Math.round(Math.min(1, colour.b) * a * 255)
  c[t + 3] = Math.round(a * 255)
  k[t] = species === 0 ? 255 : 0
  k[t + 1] = species === 1 ? 255 : 0
  k[t + 2] = species === 2 ? 255 : 0
  k[t + 3] = flowering ? 255 : 0
}
