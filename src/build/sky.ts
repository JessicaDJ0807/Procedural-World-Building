import * as THREE from 'three'

/**
 * The Build page's sky: a clear day. Pale blue at the horizon deepening to a
 * medium blue overhead, soft white clouds, and a faint warm glow round the
 * sun — readable and fresh, the backdrop to play against rather than a mood.
 *
 * The Build page first borrowed the Site page's golden-hour dome, and its
 * orange wash turned the lawn dusty and the plants olive. The Site keeps it.
 *
 * Clouds are value-noise fbm on the sky's direction projected onto a plane
 * overhead, so they flatten and thin toward the horizon as real ones seem to.
 */

export const DAY = {
  zenith: '#5f93cf',
  horizon: '#d8e6f1',
  ground: '#cfdccf',
  haze: '#d3e0e8',
  /** Sky light and the bounce off the lawn, for the hemisphere light. */
  sky: '#d9e6f3',
  bounce: '#8a9a66',
  /** Sunlight: barely warm. */
  sun: '#fff3e2',
}

export function daySky(sunDir: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(DAY.zenith) },
      uHorizon: { value: new THREE.Color(DAY.horizon) },
      uGround: { value: new THREE.Color(DAY.ground) },
      uSun: { value: sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGround, uSun;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int k = 0; k < 5; k++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
        return v;
      }
      void main() {
        float h = vDir.y;
        vec3 c = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.42, h), 0.7));
        if (h > 0.02) {
          // Clouds on a plane overhead: soft-edged, thinning toward the horizon.
          vec2 uv = vDir.xz / (h + 0.18) * 1.6;
          float n = fbm(uv + vec2(3.0, 1.0));
          float cover = smoothstep(0.47, 0.72, n) * smoothstep(0.02, 0.25, h);
          vec3 cloud = mix(vec3(0.86, 0.89, 0.93), vec3(1.0), smoothstep(0.55, 0.9, n));
          c = mix(c, cloud, cover * 0.85);
        }
        // A faint warm glow round the sun.
        c += vec3(1.0, 0.92, 0.78) * pow(max(dot(vDir, uSun), 0.0), 32.0) * 0.35;
        if (h < 0.0) c = mix(uHorizon, uGround, smoothstep(0.0, -0.15, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 16), material)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  return mesh
}
