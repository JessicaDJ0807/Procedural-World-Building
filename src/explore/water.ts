import * as THREE from 'three'
import { atIndex, clampToBends, ribbonGeometry, smoothCentreline } from '../ribbon'
import { BANK_HEIGHT, BANK_OVERLAP, BANK_WIDTH, SHELF_DEPTH, type River } from './river'
import type { WorldSpec } from './worlds'

/**
 * The water surface.
 *
 * ## Why this is the standard material with code injected, not a shader of its own
 *
 * A `ShaderMaterial` would be fewer moving parts to read, and it would also
 * have to reimplement everything the scene already does to every other
 * surface: the directional light, the hemisphere fill, tone mapping, and —
 * the one that would actually be noticed — fog. Water that does not fog
 * stays sharp out to the horizon while the land around it fades, which
 * announces the edge of the world more loudly than no water at all.
 *
 * So the lighting stays three.js's and `onBeforeCompile` adds two things to it:
 * a perturbed normal, which is what makes highlights move, and a faint streak
 * along the flow direction. Both are fragment-level. There is no geometry to
 * displace, no simulation, and no second render target.
 *
 * ## What makes it read as water
 *
 * Mostly not the motion. It is the normal: a flat plane under one directional
 * light is one flat tone, and no amount of colour fixes that. Once the normal
 * wanders, the specular breaks into moving highlights and the surface reads as
 * liquid even in a still frame. The scrolling is what makes it read as
 * *flowing*, which is a smaller effect than it sounds and the first thing to
 * turn down if it ever draws attention to itself.
 */

export type Water = {
  mesh: THREE.Mesh
  /** Advance the surface. Cheap: one uniform write. */
  update(elapsed: number): void
  dispose(): void
}

const GLSL_NOISE = /* glsl */ `
  float wHash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  float wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = wHash(i);
    float b = wHash(i + vec2(1.0, 0.0));
    float c = wHash(i + vec2(0.0, 1.0));
    float d = wHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`

export function createWater(spec: WorldSpec, size: number): Water | null {
  const config = spec.water
  if (!config || spec.terrain.seaLevel === null) return null

  const uniforms = { uTime: { value: 0 } }

  const material = new THREE.MeshStandardMaterial({
    color: config.color,
    transparent: config.opacity < 1,
    opacity: config.opacity,
    metalness: config.metalness,
    roughness: config.roughness,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime

    // World position, because the ripples have to stay put as the plane slides
    // to follow the camera. In local coordinates the whole pattern would travel
    // with the viewer and the water would look like it was being dragged along.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWaterPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vWaterPos = (modelMatrix * vec4(position, 1.0)).xyz;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         varying vec3 vWaterPos;
         ${GLSL_NOISE}`,
      )
      // After the normal is established and before the lighting reads it.
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           vec2 wp = vWaterPos.xz;
           // Two layers crossing at an angle and drifting at different rates.
           // One alone gives a travelling pattern that the eye locks onto; two
           // interfere and the surface stops looking like a scrolling texture.
           vec2 driftA = vec2(uTime * 0.055, uTime * 0.021);
           vec2 driftB = vec2(uTime * -0.027, uTime * 0.046);
           float e = 0.9;
           vec2 pa = wp * 0.085 + driftA;
           vec2 pb = wp * 0.167 - driftB;
           // Central differences for the gradient: the normal has to tilt the
           // way the surface does, and a value on its own carries no direction.
           float gx =
             (wNoise(pa + vec2(e, 0.0)) - wNoise(pa - vec2(e, 0.0))) * 0.7 +
             (wNoise(pb + vec2(e, 0.0)) - wNoise(pb - vec2(e, 0.0))) * 0.3;
           float gz =
             (wNoise(pa + vec2(0.0, e)) - wNoise(pa - vec2(0.0, e))) * 0.7 +
             (wNoise(pb + vec2(0.0, e)) - wNoise(pb - vec2(0.0, e))) * 0.3;
           normal = normalize(normal + vec3(-gx, 0.0, -gz) * 1.35);
         }`,
      )
      // A faint brightening along the flow, stretched across it so it reads as
      // a current rather than as more ripples.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec2 streakUv = vec2(vWaterPos.x * 0.02, vWaterPos.z * 0.115 - uTime * 0.085);
           float streak = wNoise(streakUv);
           streak = smoothstep(0.62, 0.98, streak);
           diffuseColor.rgb += streak * 0.07;
         }`,
      )
  }
  // Injected code is part of the program's identity; without this three.js can
  // hand this material a cached program compiled for a different injection.
  material.customProgramCacheKey = () => 'explore-water-v1'

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = spec.terrain.seaLevel
  mesh.renderOrder = 1

  return {
    mesh,
    update(elapsed) {
      uniforms.uTime.value = elapsed
    },
    dispose() {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}

/**
 * The river surface: a ribbon along the centreline, not a plane.
 *
 * ## Why a ribbon
 *
 * A plane can only be level, and this river's surface is 53 units up at its
 * source and -15 at its outlet. There is no single elevation that is right for
 * it. The ribbon carries the longitudinal profile in its own vertices, so the
 * water descends because the river descends.
 *
 * ## Why the flow direction needs no uniform
 *
 * The strip is laid out with `v` running downstream and `u` across, so
 * scrolling the ripples along `v` is, by construction, scrolling them along the
 * local tangent. A world-space shader would need the tangent passed in per
 * segment and interpolated; here the geometry already knows, and a bend is
 * handled without anything being told about it.
 *
 * `v` is in world units of distance downstream rather than normalised 0..1, so
 * the ripple scale stays constant whether a reach is long or short.
 */
export function createRiverSurface(river: River, spec: WorldSpec): Water | null {
  const config = spec.water
  if (!config) return null

  // The river's own centreline and its own width — the same numbers the
  // channel was carved from, so the water sits in its bed by construction
  // rather than by searching the terrain for where the bank happens to be.
  // The nodes already lie on a smoothed course; an 8-unit smoothing only rounds
  // the corners a 20-unit polyline still has, moving the line well under a
  // unit from the segments the channel was carved along.
  const nodes = river.nodes
  const { samples, index } = smoothCentreline(nodes, 4, 8)
  const level = index.map((k) => atIndex(nodes.map((n) => n.water), k))
  const width = nodes.map((n) => n.width + BANK_OVERLAP)
  // The width already respects the bends — the river sizes its channel to 55%
  // of the tightest local radius — so the clamp here is only the strip's own
  // safety net, at 95%. At the strip's default 80% it measured curvature over
  // a shorter window than the river did, trimmed the water at 19 samples the
  // channel had already sized, and left the shelf showing past its edge.
  const halfWidth = clampToBends(samples, index.map((k) => atIndex(width, k)), 0.95)
  // Flat across: a river's surface is level from bank to bank even where the
  // bed is not.
  const geometry = ribbonGeometry(samples, halfWidth, (_x, _z, i) => level[i])
  // Signed distance from the centreline, in world units, per vertex. The
  // ripples used to be sampled on uv.x, which runs 0–1 across whatever the
  // width is — seven and eleven cells across a 12-unit reach and a 30-unit one
  // alike — so the pattern was pinned to the strip and traced its edges from
  // above. In world units it has one scale everywhere and no idea where the
  // edges are.
  const lateral = new Float32Array(samples.length * 2)
  halfWidth.forEach((w, i) => {
    lateral[i * 2] = -w
    lateral[i * 2 + 1] = w
  })
  geometry.setAttribute('aLateral', new THREE.BufferAttribute(lateral, 1))

  /*
   * Depth, without reading the terrain.
   *
   * Under the water the carve does not consult the land at all: the ground is
   * a fixed function of distance from the centreline — flat bed across the
   * middle 40%, shelving to SHELF_DEPTH under the surface at the channel's
   * edge, then the wet bank climbing to BANK_HEIGHT above it over BANK_WIDTH.
   * So the shader can evaluate the same cross-section per pixel from two
   * numbers per vertex, the channel's half-width and how deep its bed is,
   * and get the true depth with no depth texture and no extra pass. Measured
   * against the carved terrain itself in the Explore chapter.
   */
  const half = new Float32Array(samples.length * 2)
  const deep = new Float32Array(samples.length * 2)
  const channel = nodes.map((n) => n.width)
  const bed = nodes.map((n) => n.water - n.bed)
  samples.forEach((_, i) => {
    const w = atIndex(channel, index[i])
    const d = atIndex(bed, index[i])
    half[i * 2] = half[i * 2 + 1] = w
    deep[i * 2] = deep[i * 2 + 1] = d
  })
  geometry.setAttribute('aHalf', new THREE.BufferAttribute(half, 1))
  geometry.setAttribute('aDeep', new THREE.BufferAttribute(deep, 1))

  /*
   * Three stops of absorption, none lighter than the world's water colour —
   * depth makes water darker and more saturated, never whiter.
   *
   *   very shallow  desaturated green-blue, mostly transparent (the bed shows)
   *   medium        the world's own teal
   *   deep          a darker blue-green
   *
   * The first version lifted the shallows toward a pale green, and with
   * transparency on top the river read as milky gel.
   */
  const body = new THREE.Color(config.color)
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: body.clone().lerp(new THREE.Color('#55705f'), 0.55) },
    uMid: { value: body.clone() },
    uDeep: { value: body.clone().lerp(new THREE.Color('#123842'), 0.65) },
    uSky: { value: new THREE.Color(spec.sky) },
  }
  const material = new THREE.MeshStandardMaterial({
    color: config.color,
    transparent: config.opacity < 1,
    opacity: config.opacity,
    metalness: config.metalness,
    roughness: config.roughness,
    side: THREE.DoubleSide,
  })
  // Without this three.js never emits the uv varying — it only sets USE_UV when
  // a texture asks for it, and this material has none. The ribbon's uv *is* its
  // downstream coordinate, so it is the one thing the shader cannot do without.
  material.defines = { USE_UV: '' }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aLateral;
         attribute float aHalf;
         attribute float aDeep;
         varying float vLateral;
         varying float vHalf;
         varying float vDeep;`,
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vLateral = aLateral;\n vHalf = aHalf;\n vDeep = aDeep;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform vec3 uShallow;
         uniform vec3 uMid;
         uniform vec3 uDeep;
         uniform vec3 uSky;
         varying float vLateral;
         varying float vHalf;
         varying float vDeep;
         ${GLSL_NOISE}

         // The carve's cross-section, evaluated here: depth below the surface
         // at a distance from the centreline. Negative past the shoreline.
         float riverDepth(float lateral, float halfWidth, float bedDepth) {
           float l = abs(lateral);
           if (l <= halfWidth) {
             float t = smoothstep(0.0, 1.0, (l - halfWidth * 0.4) / (halfWidth * 0.6));
             return mix(bedDepth, ${SHELF_DEPTH.toFixed(3)}, t);
           }
           float t = smoothstep(0.0, 1.0, (l - halfWidth) / ${BANK_WIDTH.toFixed(3)});
           return mix(${SHELF_DEPTH.toFixed(3)}, -${BANK_HEIGHT.toFixed(3)}, t);
         }`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           // World units both ways: vLateral across, vUv.y downstream. Small
           // irregular ripples, about 1.5–3 units — many faint reflections
           // rather than the 5–10-unit swells before, which caught the light
           // as broad glossy patches and made the surface look swollen.
           vec2 p = vec2(vLateral, vUv.y);
           vec2 flow = vec2(p.x * 0.38, p.y * 0.30 - uTime * 0.55);
           vec2 flowB = vec2(p.x * 0.71 + 3.1, p.y * 0.56 - uTime * 0.85);
           float e = 0.6;
           float gx =
             (wNoise(flow + vec2(e, 0.0)) - wNoise(flow - vec2(e, 0.0))) * 0.65 +
             (wNoise(flowB + vec2(e, 0.0)) - wNoise(flowB - vec2(e, 0.0))) * 0.35;
           float gz =
             (wNoise(flow + vec2(0.0, e)) - wNoise(flow - vec2(0.0, e))) * 0.65 +
             (wNoise(flowB + vec2(0.0, e)) - wNoise(flowB - vec2(0.0, e))) * 0.35;
           // Damped toward the banks: the middle of a river moves and its edges
           // do not, and a ripple that runs into the bank reads as a mistake.
           float mid = 1.0 - abs(vUv.x * 2.0 - 1.0);
           // Faded with screen-space density: where a ripple shrinks below a
           // few pixels it would only shimmer, so far water is calmer.
           float near = 1.0 - smoothstep(0.15, 0.6, fwidth(flowB.y));
           normal = normalize(normal + vec3(-gx, 0.0, -gz) * 0.35 * near * smoothstep(0.0, 0.45, mid));
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // Depth is the water surface minus the carved bed at this pixel,
           // from the carve's own cross-section. Absorption, not distance:
           // colour and opacity follow 1 − e^(−depth/k), which rises fast over
           // the first metre and flattens — so the shelf reads as shallow and
           // the channel as deep, with no visible band between.
           float depth = riverDepth(vLateral, vHalf, vDeep);
           float a1 = 1.0 - exp(-max(depth, 0.0) / 0.8);
           float a2 = 1.0 - exp(-max(depth, 0.0) / 4.0);
           diffuseColor.rgb = mix(mix(uShallow, uMid, a1), uDeep, a2);
           // Clear over the shallows, near-opaque in the middle.
           diffuseColor.a *= mix(0.22, 1.0, a1 * 0.45 + a2 * 0.55);

           // A faint current, small and broken: short dashes along the flow,
           // a few units long, at a couple of percent. The 16 × 45-unit bands
           // before were larger than the river is wide in places.
           float dash = wNoise(vec2(vLateral * 0.45, vUv.y * 0.12 - uTime * 0.6));
           float mid = 1.0 - abs(vUv.x * 2.0 - 1.0);
           diffuseColor.rgb += smoothstep(0.72, 0.95, dash) * 0.018 * mid;

           // Past the shoreline the strip runs on under the bank. Fading it
           // out there makes the water's edge the computed shoreline, not the
           // end of a mesh, even where the depth test would not hide it.
           diffuseColor.a *= smoothstep(-0.12, 0.02, depth);
         }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
           // Schlick's Fresnel against the sky: clear looking down, a mirror of
           // the sky at a grazing angle. The scene has no environment map, so
           // without this a still surface at a distance has nothing to reflect.
           float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
           float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
           // Capped well short of a mirror: at 0.55 the low ground-level view
           // reflected nearly all sky and the river lost its colour, and the
           // ripple normals turned into bright patches from above.
           outgoingLight = mix(outgoingLight, uSky, fresnel * 0.2);
           diffuseColor.a = max(diffuseColor.a, fresnel * 0.5 * step(0.001, diffuseColor.a));
         }
         #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'explore-river-v4'

  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1

  return {
    mesh,
    update(elapsed) {
      uniforms.uTime.value = elapsed
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
