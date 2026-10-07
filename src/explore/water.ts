import * as THREE from 'three'
import { atIndex, clampToBends, ribbonGeometry, smoothCentreline } from '../ribbon'
import { BANK_OVERLAP, type River } from './river'
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

  const uniforms = { uTime: { value: 0 } }
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
    shader.uniforms.uTime = uniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float aLateral;\n varying float vLateral;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLateral = aLateral;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n uniform float uTime;\n varying float vLateral;\n ${GLSL_NOISE}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           // World units both ways: vLateral across, vUv.y downstream. Broad,
           // roughly round ripples 5–10 units across, drifting with the flow.
           vec2 p = vec2(vLateral, vUv.y);
           vec2 flow = vec2(p.x * 0.10, p.y * 0.07 - uTime * 0.30);
           vec2 flowB = vec2(p.x * 0.19, p.y * 0.13 - uTime * 0.48);
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
           normal = normalize(normal + vec3(-gx, 0.0, -gz) * 0.9 * smoothstep(0.0, 0.45, mid));
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // Long, soft bands along the course, about 16 units across and 45
           // along, so they read as current. They were 10 across and 2 along —
           // short bright bars across the flow, dense enough to read as a
           // texture from above.
           float streak = wNoise(vec2(vLateral * 0.06, vUv.y * 0.022 - uTime * 0.18));
           float mid = 1.0 - abs(vUv.x * 2.0 - 1.0);
           diffuseColor.rgb += smoothstep(0.62, 0.95, streak) * 0.035 * mid;
         }`,
      )
  }
  material.customProgramCacheKey = () => 'explore-river-v2'

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
