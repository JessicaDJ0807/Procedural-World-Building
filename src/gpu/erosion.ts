import * as THREE from 'three'
import {
  Field,
  GLSL_FIT_SQUARE,
  createPass,
  dataTexture,
  rampTexture,
  runPass,
  seedField,
  type Uniforms,
} from './core'
import { defaults, param, type ParamSpec, type Pointer, type Simulation } from './simulation'
import { compositeLayers, fbmOctaves, type NoiseLayer } from '../noise'
import { GLSL_SLATE, RAMPS, rampData } from './style'

const SIZE = 256

/**
 * Terrain height, expressed in cells.
 *
 * The fBm stack lands in roughly [0.33, 0.77]. Across 256 cells that is a slope
 * of about 0.0017 per cell — flat enough that a millimetre of rain is the same
 * order as the whole landscape, and the pipe model degenerates into every cell
 * eroding itself independently. Scaling relief into the same units as the grid
 * is what makes gravity, rainfall and carrying capacity mean anything.
 */
const HEIGHT_SCALE = 64

/**
 * Hydraulic erosion, virtual-pipe model (Mei, Decaudin & Hu, 2007).
 *
 * Topic 2 erodes with droplets: each one walks downhill carrying sediment,
 * modifying terrain the next droplet will see. That is inherently serial — the
 * result depends on the order the droplets ran — and it is why the CPU version
 * takes a visible run of steps to reach its cap.
 *
 * A GPU cannot do that. So this is not a translation of `erosion.ts`, it is a
 * different algorithm chosen for the same job: every cell holds water depth and
 * an outflow to each of its four neighbours, and all cells update at once from
 * the previous state alone. Flow emerges from pressure differences between
 * neighbours rather than from a path being walked.
 *
 * One step is four passes, in this order, because each depends on the last:
 *   1. rain      — add water (and the pointer's brush)
 *   2. flux      — pressure differences decide outflow, scaled to what exists
 *   3. hydraulic — move the water, then erode or deposit against capacity
 *   4. transport — carry suspended sediment along the flow, then evaporate
 */

const COMMON = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTerrain;   // r = ground, g = water depth, b = sediment
  uniform sampler2D uFlux;      // outflow: r = -x, g = +x, b = +y, a = -y
  uniform vec2 uTexel;
  uniform float uDt;

  // Net volumetric flow through a cell. Inflow is the neighbours' outflow
  // aimed this way; outflow is this cell's own.
  vec2 flowRate(vec2 uv) {
    vec4 f = texture2D(uFlux, uv);
    float inL = texture2D(uFlux, uv - vec2(uTexel.x, 0.0)).g;
    float inR = texture2D(uFlux, uv + vec2(uTexel.x, 0.0)).r;
    float inD = texture2D(uFlux, uv - vec2(0.0, uTexel.y)).b;
    float inU = texture2D(uFlux, uv + vec2(0.0, uTexel.y)).a;
    return vec2((inL - f.r + f.g - inR) * 0.5, (inD - f.a + f.b - inU) * 0.5);
  }

  // Water speed, for advection only. Dividing volumetric flow by depth is what
  // turns it into a speed, and it is also a trap: a shallow sheet divides by a
  // small number and comes out fast. Capacity must NOT use this — doing so
  // multiplied carrying capacity by about 7× at the equilibrium depth these
  // defaults settle at, and erosion ran away into per-cell pits within forty
  // steps. Capacity uses the volumetric rate; only the backtrace uses this.
  vec2 velocity(vec2 uv, float depth) {
    vec2 speed = flowRate(uv) / max(depth, 0.05);
    float magnitude = length(speed);
    return magnitude > 4.0 ? speed / magnitude * 4.0 : speed;
  }
`

const RAIN = /* glsl */ `
  ${COMMON}
  uniform float uRain;
  uniform vec3 uPointer;
  uniform float uRadius;

  void main() {
    vec4 t = texture2D(uTerrain, vUv);
    t.g += uRain * uDt;
    if (uPointer.z > 0.0) {
      float d = length(vUv - uPointer.xy);
      t.g += uPointer.z * exp(-(d * d) / (uRadius * uRadius)) * uDt;
    }
    gl_FragColor = t;
  }
`

const FLUX = /* glsl */ `
  ${COMMON}
  uniform float uGravity;
  uniform float uFriction;

  float outflow(float previous, float here, vec2 uv, vec2 offset) {
    vec4 n = texture2D(uTerrain, uv + offset);
    float drop = here - (n.r + n.g);
    return max(0.0, previous + uDt * uGravity * drop);
  }

  void main() {
    vec4 t = texture2D(uTerrain, vUv);
    vec4 f = texture2D(uFlux, vUv);
    float here = t.r + t.g;

    vec4 next = vec4(
      outflow(f.r, here, vUv, vec2(-uTexel.x, 0.0)),
      outflow(f.g, here, vUv, vec2( uTexel.x, 0.0)),
      outflow(f.b, here, vUv, vec2(0.0,  uTexel.y)),
      outflow(f.a, here, vUv, vec2(0.0, -uTexel.y))
    );

    // Walls. With ClampToEdge the outside neighbour is a copy of this cell, so
    // the height difference is zero and the old flux would simply persist —
    // water would pile against the border instead of stopping at it.
    if (vUv.x < uTexel.x) next.r = 0.0;
    if (vUv.x > 1.0 - uTexel.x) next.g = 0.0;
    if (vUv.y > 1.0 - uTexel.y) next.b = 0.0;
    if (vUv.y < uTexel.y) next.a = 0.0;

    // Friction. The pipe model as published has none: flux only changes by the
    // height difference, so once water is moving nothing stops it, and a pair
    // of neighbours trades the same water back and forth forever. Each of
    // those sloshes erodes a little, on alternating cells, which accumulates
    // into the one-cell comb texture that dominated this simulation before the
    // damping went in. Slippage could hide it; only friction removes it.
    next *= uFriction;

    // A cell cannot send out more water than it holds. Without this scaling
    // depth goes negative in one step and the whole field turns to NaN.
    float total = next.r + next.g + next.b + next.a;
    if (total > 0.0) next *= min(1.0, t.g / (total * uDt));

    gl_FragColor = next;
  }
`

const HYDRAULIC = /* glsl */ `
  ${COMMON}
  uniform float uCapacity;
  uniform float uErode;
  uniform float uDeposit;
  uniform float uMinSlope;
  uniform float uMaxChange;

  void main() {
    vec4 t = texture2D(uTerrain, vUv);
    vec4 f = texture2D(uFlux, vUv);

    float inL = texture2D(uFlux, vUv - vec2(uTexel.x, 0.0)).g;
    float inR = texture2D(uFlux, vUv + vec2(uTexel.x, 0.0)).r;
    float inD = texture2D(uFlux, vUv - vec2(0.0, uTexel.y)).b;
    float inU = texture2D(uFlux, vUv + vec2(0.0, uTexel.y)).a;
    float net = (inL + inR + inD + inU) - (f.r + f.g + f.b + f.a);

    float depth = max(0.0, t.g + net * uDt);

    // Slope of the ground, as sin of the tilt angle.
    float gx = texture2D(uTerrain, vUv + vec2(uTexel.x, 0.0)).r
             - texture2D(uTerrain, vUv - vec2(uTexel.x, 0.0)).r;
    float gy = texture2D(uTerrain, vUv + vec2(0.0, uTexel.y)).r
             - texture2D(uTerrain, vUv - vec2(0.0, uTexel.y)).r;
    // gx spans two cells, so halving it gives slope per cell — and with height
    // already in cells that is the true surface normal, no fudge factor.
    vec3 normal = normalize(vec3(-gx * 0.5, -gy * 0.5, 1.0));
    float sinTilt = sqrt(max(0.0, 1.0 - normal.z * normal.z));

    // Flat ground would have zero capacity and could never start a channel, so
    // the tilt has a floor. This is the usual fix, and it is also why the
    // pattern depends on it: raise the floor and channels braid everywhere.
    sinTilt = max(sinTilt, uMinSlope);

    // No water, no work — and the ramp has to start at zero, not at a fraction,
    // or ground with a film on it still erodes.
    float wet = smoothstep(0.0, 0.02, depth);
    float capacity = uCapacity * sinTilt * length(flowRate(vUv)) * wet;

    float ground = t.r;
    float sediment = t.b;
    // A hard ceiling on how much ground one step may move. Erosion is a
    // positive feedback — a cell that drops gets a steeper slope, which raises
    // its capacity, which drops it further — so without a limit a single step
    // can cut a pit and the field turns to per-cell noise.
    //
    // It has to stay a safety net. Tuned so the clamp bound most cells, every
    // cell eroded the same fixed amount per step, which is uniform lowering
    // rather than channel cutting: the whole landscape sank and the channels
    // washed out. Capacity is set so that ordinary cells fall below this.
    if (capacity > sediment) {
      float amount = min(uErode * (capacity - sediment), uMaxChange);
      ground -= amount;
      sediment += amount;
    } else {
      float amount = min(uDeposit * (sediment - capacity), uMaxChange);
      ground += amount;
      sediment -= amount;
    }

    gl_FragColor = vec4(ground, depth, sediment, 1.0);
  }
`

const TRANSPORT = /* glsl */ `
  ${COMMON}
  uniform float uEvaporate;

  /**
   * How much of a cell's water — and so its suspended load — leaves this step.
   *
   * Computed identically from either side of a boundary, which is what makes
   * the transport conservative: the fraction this cell sends its neighbour is
   * the same number the neighbour computes when it asks what it received.
   */
  float leavingFraction(vec4 flux, float depth) {
    float total = flux.r + flux.g + flux.b + flux.a;
    if (total <= 0.0) return 0.0;
    return min(total * uDt / max(depth, 1e-5), 1.0);
  }

  /** Sediment arriving from one neighbour, as its share of that cell's load. */
  float inflowFrom(vec2 offset, float share) {
    vec4 flux = texture2D(uFlux, vUv + offset);
    vec4 cell = texture2D(uTerrain, vUv + offset);
    float total = flux.r + flux.g + flux.b + flux.a;
    if (total <= 0.0) return 0.0;
    return cell.b * leavingFraction(flux, cell.g) * (share / total);
  }

  void main() {
    vec4 t = texture2D(uTerrain, vUv);
    vec4 f = texture2D(uFlux, vUv);

    // Sediment moves with the water that carries it, along the same pipes.
    //
    // This replaced a semi-Lagrangian backtrace, which reads the load from
    // wherever the flow came from. That scheme is stable but NOT conservative:
    // two cells can sample the same upstream cell and duplicate its load, and
    // a cell nothing samples loses its own. With erosion feeding sediment in
    // continuously, the drift ran one way, and the whole interior sank below
    // its starting elevation within a few thousand steps. Moving sediment as
    // flux shares makes what leaves a cell exactly what arrives next door.
    float sent = t.b * leavingFraction(f, t.g);

    // Outside the domain there is no neighbour — and ClampToEdge does not say
    // so, it hands back a copy of this very cell. Without these guards a border
    // cell receives its own outflow as inflow every step, duplicating it. That
    // is a ring one cell wide, which sounds negligible and is not: the extra
    // material deposits, erodes again and compounds. Measured, it ran mass to
    // +890% over 4,400 steps before the guards went in.
    float received = 0.0;
    if (vUv.x > uTexel.x) {
      received += inflowFrom(vec2(-uTexel.x, 0.0), texture2D(uFlux, vUv - vec2(uTexel.x, 0.0)).g);
    }
    if (vUv.x < 1.0 - uTexel.x) {
      received += inflowFrom(vec2(uTexel.x, 0.0), texture2D(uFlux, vUv + vec2(uTexel.x, 0.0)).r);
    }
    if (vUv.y > uTexel.y) {
      received += inflowFrom(vec2(0.0, -uTexel.y), texture2D(uFlux, vUv - vec2(0.0, uTexel.y)).b);
    }
    if (vUv.y < 1.0 - uTexel.y) {
      received += inflowFrom(vec2(0.0, uTexel.y), texture2D(uFlux, vUv + vec2(0.0, uTexel.y)).a);
    }

    float carried = t.b - sent + received;

    float depth = max(t.g * (1.0 - uEvaporate * uDt), 0.0);

    // Water that evaporates cannot keep its load. Leaving the sediment
    // suspended instead was the other half of the same mass leak.
    float fraction = t.g > 1e-5 ? (t.g - depth) / t.g : 1.0;
    float dropped = carried * fraction;

    gl_FragColor = vec4(t.r + dropped, depth, carried - dropped, 1.0);
  }
`

const THERMAL = /* glsl */ `
  ${COMMON}
  uniform float uTalus;
  uniform float uThermal;

  /**
   * Material above the talus angle slides downhill.
   *
   * Antisymmetric by construction, so a pair of cells exchanges exactly the
   * same amount in both directions and no material is created: whatever this
   * takes from the high cell, the low one gains.
   *
   * Hydraulic erosion alone judges every cell on its own flow, and neighbours
   * with slightly different flow erode by slightly different amounts — which
   * accumulates into a one-cell comb texture over the whole field. Slippage is
   * the term that removes it, and Topic 2's CPU erosion carries it for the
   * same reason.
   */
  float slip(float here, vec2 offset) {
    float delta = texture2D(uTerrain, vUv + offset).r - here;
    if (delta > uTalus) return delta - uTalus;
    if (delta < -uTalus) return delta + uTalus;
    return 0.0;
  }

  void main() {
    vec4 t = texture2D(uTerrain, vUv);
    float h = t.r;
    float move = slip(h, vec2(uTexel.x, 0.0)) + slip(h, vec2(-uTexel.x, 0.0))
               + slip(h, vec2(0.0, uTexel.y)) + slip(h, vec2(0.0, -uTexel.y));
    // Four neighbours, so the strength must stay below 0.25 or a cell
    // overshoots past its neighbours and the relaxation itself oscillates.
    gl_FragColor = vec4(h + uThermal * move, t.g, t.b, 1.0);
  }
`

const DISPLAY = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTerrain;
  uniform sampler2D uRamp;
  uniform vec2 uTexel;
  uniform vec2 uViewport;
  uniform float uRelief;
  uniform float uShowWater;
  uniform float uContours;
  uniform float uMin;
  uniform float uSpan;

  ${GLSL_FIT_SQUARE}
  ${GLSL_SLATE}

  /**
   * Elevation, averaged over 5×5 cells.
   *
   * Contours are drawn from this rather than the raw field. A contour of a
   * rough surface is not a line — it is a scribble, and that is literally what
   * the first version drew: the terrain carries cell-scale roughness, so every
   * band boundary broke into hatching across the whole map.
   */
  float smoothHeight(vec2 uv) {
    // Nine taps spaced two cells apart rather than twenty-five adjacent ones:
    // the same smoothing radius for a third of the texture fetches, which
    // matters because this runs per pixel on top of fifteen simulation passes.
    float sum = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        sum += texture2D(uTerrain, uv + vec2(float(x), float(y)) * uTexel * 2.0).r;
      }
    }
    return sum / 9.0;
  }

  void main() {
    vec2 uv = fitSquare(vUv, uViewport);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(SLATE_BG, 1.0);
      return;
    }

    vec4 t = texture2D(uTerrain, uv);
    float height = t.r;

    float gx = texture2D(uTerrain, uv + vec2(uTexel.x, 0.0)).r
             - texture2D(uTerrain, uv - vec2(uTexel.x, 0.0)).r;
    float gy = texture2D(uTerrain, uv + vec2(0.0, uTexel.y)).r
             - texture2D(uTerrain, uv - vec2(0.0, uTexel.y)).r;
    vec3 normal = normalize(vec3(-gx * uRelief, -gy * uRelief, 1.0));
    float light = dot(normal, normalize(vec3(-0.45, 0.58, 0.68))) * 0.5 + 0.5;

    float t01 = clamp((height - uMin) / max(uSpan, 1e-5), 0.0, 1.0);
    vec3 colour = texture2D(uRamp, vec2(t01, 0.5)).rgb;

    // Hillshade as a tint toward the board, not a multiply toward black.
    // Multiplying drives the shadow end to near-zero, which loses the ramp's
    // hue exactly where the terrain is most three-dimensional.
    // The shadow floor sits lower than on paper. A light ground needs a gentle
    // tint or it looks dirty; a dark one needs real range or every slope
    // settles into the same mid-tone and the relief stops reading.
    colour = mix(mix(SLATE_SHADE, colour, 0.34), colour * 1.06, clamp(light, 0.0, 1.0));

    if (uContours > 0.0) {
      // Contour lines from the fractional part of scaled elevation, with the
      // line width taken from the screen-space derivative so it stays one
      // pixel wide however far the map is zoomed.
      float bands = 11.0;
      float e = clamp((smoothHeight(uv) - uMin) / max(uSpan, 1e-5), 0.0, 1.0) * bands;
      float edge = abs(fract(e) - 0.5);
      float w = max(fwidth(e), 1e-4);
      float line = smoothstep(0.0, w * 1.2, edge);
      // Chalk, not ink: light lines on a dark board are the inverse of the
      // same technique, and the only version that stays visible here.
      colour = mix(SLATE_CHALK_C, colour, mix(1.0, line, uContours * 0.45));
    }

    if (uShowWater > 0.5) {
      float wet = smoothstep(0.0, 0.25, t.g);
      colour = mix(colour, vec3(0.306, 0.420, 0.490), wet * 0.80);   // #4E6B7D
      // Suspended sediment, so channels that are actively cutting read
      // differently from ones merely holding water.
      colour = mix(colour, vec3(0.541, 0.451, 0.345), clamp(t.b * 1.5, 0.0, 0.7));  // #8A7358
    }

    gl_FragColor = vec4(grain(colour, gl_FragCoord.xy, 0.006), 1.0);
  }
`

const PARAMS: ParamSpec[] = [
  {
    key: 'rain',
    label: 'Rainfall',
    info: 'Water added to every cell per second. Uniform rain carves a whole drainage network at once, which is the thing droplet erosion cannot do in one pass.',
    min: 0,
    max: 0.3,
    step: 0.005,
    value: 0.05,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'evaporate',
    label: 'Evaporation',
    info: 'Fraction of standing water lost per second. This is what stops the field flooding into a flat lake, and it sets how far a channel runs before it dries.',
    min: 0,
    max: 2,
    step: 0.01,
    value: 0.9,
  },
  {
    key: 'capacity',
    label: 'Carry capacity',
    info: 'How much sediment moving water can hold, per unit of slope and speed. Above capacity water erodes; below it, it drops what it carries. Every valley and every fan on screen is that one comparison.',
    min: 0.02,
    max: 2,
    step: 0.01,
    value: 0.2,
  },
  {
    key: 'erode',
    label: 'Erosion rate',
    info: 'How quickly ground is taken up when water is under capacity. High values cut fast and leave the terrain noisy; low values take thousands of steps to show anything.',
    min: 0.05,
    max: 1,
    step: 0.01,
    value: 0.12,
  },
  {
    key: 'deposit',
    label: 'Deposition rate',
    info: 'How quickly sediment drops out when water is over capacity. This builds the fans where a steep channel meets flat ground.',
    min: 0.05,
    max: 1,
    step: 0.01,
    value: 0.3,
  },
  {
    key: 'gravity',
    label: 'Gravity',
    info: 'Scales how hard a height difference between neighbours pushes water. Together with the time step it decides stability — too much of either and water sloshes rather than flows.',
    min: 1,
    max: 24,
    step: 0.5,
    value: 6,
    format: (v) => v.toFixed(1),
  },
  {
    key: 'friction',
    label: 'Flow friction',
    info: 'Fraction of flux kept each step. 1.0 is the published pipe model, which is frictionless — water set moving never stops, neighbours trade it back and forth, and the alternating erosion combs the terrain into one-cell stripes. Drop it to about 0.95 and the flow settles into channels instead.',
    min: 0.85,
    max: 1,
    step: 0.002,
    value: 0.95,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'minSlope',
    label: 'Minimum slope',
    info: 'Floor on the tilt used for capacity. Keep it near zero: a floor means flat ground keeps eroding no matter how flat it gets, so the run never settles and the whole landscape sinks. A small value lets channels start; a large one erodes everything uniformly.',
    min: 0,
    max: 0.3,
    step: 0.005,
    value: 0.005,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'talus',
    label: 'Talus angle',
    info: 'Slope, in cells of height per cell of distance, above which loose material slides. Roughly 0.45 is a 24° repose angle. Lower values relax the terrain into smooth hills; higher ones let it hold steep walls.',
    min: 0.05,
    max: 2,
    step: 0.05,
    value: 0.25,
  },
  {
    key: 'thermal',
    label: 'Slippage rate',
    info: 'How fast material above the talus angle slides. This is what removes the one-cell comb texture hydraulic erosion leaves behind; at zero you can watch it come back. Must stay under 0.25 — four neighbours contribute, and above that the relaxation overshoots and oscillates.',
    min: 0,
    max: 0.24,
    step: 0.005,
    value: 0.08,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'dt',
    label: 'Time step',
    info: 'Δt per sub-step. The flux pass clamps outflow to the water available, so this degrades into sloshing rather than exploding — but the flow stops looking like flow well before it breaks.',
    min: 0.01,
    max: 0.16,
    step: 0.002,
    value: 0.03,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'steps',
    label: 'Steps per frame',
    info: 'Sub-steps per frame, each of which is four full-screen passes. This is the dial that trades frame rate for erosion speed.',
    min: 1,
    max: 12,
    step: 1,
    value: 3,
    format: (v) => v.toFixed(0),
  },
  {
    key: 'brush',
    label: 'Rain brush',
    info: 'Extra water the pointer pours in, per second. Painting rain onto one ridge and watching only that side develop a network is the clearest way to see that the flow is not scripted.',
    min: 0,
    max: 3,
    step: 0.05,
    value: 1.2,
  },
  {
    key: 'water',
    label: 'Show water',
    info: 'Tints standing water blue and suspended sediment brown. Off shows the bare ground the erosion has produced.',
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    format: (v) => (v > 0.5 ? 'on' : 'off'),
    options: [
      { value: 1, label: 'Water and sediment' },
      { value: 0, label: 'Bare ground' },
    ],
  },
  {
    key: 'contours',
    label: 'Contour lines',
    info: 'Chalk lines at eleven elevation bands, taken from a nine-tap average of the ground so they stay lines rather than breaking into hatching, though the grid anisotropy in the terrain itself still shows through them on steep ground, drawn from the fractional part of scaled height. The line width comes from the screen-space derivative, so it stays one pixel wide rather than thickening where the ground is flat. Display only.',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.22,
  },
  {
    key: 'relief',
    label: 'Relief (display)',
    info: 'Hillshade gain. Display only — it changes how steep the terrain looks, not how steep it is.',
    min: 0.2,
    max: 8,
    step: 0.1,
    value: 1.4,
    format: (v) => v.toFixed(1),
  },
  {
    key: 'palette',
    label: 'Palette',
    info: "The ramp elevation maps through. Topic 4's slate ramps come first; Topic 2's OKLab palettes follow.",
    min: 0,
    max: RAMPS.length - 1,
    step: 1,
    value: 0,
    format: (v) => RAMPS[Math.round(v)]?.label ?? '',
    options: RAMPS.map((option) => ({ value: option.value, label: option.label })),
  },
]

/** The same six-octave fBm stack Topic 2 opens on, as the starting ground. */
function seedTerrain(seed: number): { data: Float32Array; min: number; span: number } {
  const layers: NoiseLayer[] = fbmOctaves(6, 2, 0.5, SIZE).map((octave, index) => ({
    id: `octave-${index}`,
    name: `Octave ${index + 1}`,
    enabled: true,
    frequency: octave.frequency,
    spread: 0.6,
    seed: seed + index,
    shapingName: 'none',
    shapingParams: {},
    blendName: 'normal',
    opacity: octave.opacity,
  }))
  const height = compositeLayers(SIZE, 2, layers)

  let min = Infinity
  let max = -Infinity
  for (const value of height) {
    if (value < min) min = value
    if (value > max) max = value
  }

  const data = new Float32Array(SIZE * SIZE * 4)
  for (let i = 0; i < height.length; i++) {
    data[i * 4] = height[i] * HEIGHT_SCALE
    data[i * 4 + 3] = 1
  }
  return {
    data,
    min: min * HEIGHT_SCALE,
    span: Math.max((max - min) * HEIGHT_SCALE, 1e-5),
  }
}

export function createErosion(): Simulation {
  let terrain: Field | null = null
  let flux: Field | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let uniforms: Uniforms
  let displayUniforms: Uniforms
  let rainMaterial: THREE.ShaderMaterial
  let fluxMaterial: THREE.ShaderMaterial
  let hydraulicMaterial: THREE.ShaderMaterial
  let transportMaterial: THREE.ShaderMaterial
  let thermalMaterial: THREE.ShaderMaterial
  let displayMaterial: THREE.ShaderMaterial
  let ramp: THREE.DataTexture | null = null
  let rampIndex = -1
  let elapsed = 0
  let lastSteps = 0
  const seed = 1
  // Mass conservation, measured rather than assumed. Ground and suspended
  // sediment are a closed system here — nothing leaves the domain, since the
  // flux pass seals the borders — so their total per cell must hold steady.
  // Every version of the transport pass that looked plausible leaked, and the
  // leak was only obvious as a number.
  let initialMass = 0
  let massDrift = 0
  let sinceProbe = 0
  const readback = new Float32Array(SIZE * SIZE * 4)

  const measureMass = (): number => {
    if (!renderer || !terrain) return 0
    renderer.readRenderTargetPixels(terrain.source, 0, 0, SIZE, SIZE, readback)
    let total = 0
    for (let i = 0; i < SIZE * SIZE; i++) total += readback[i * 4] + readback[i * 4 + 2]
    return total / (SIZE * SIZE)
  }

  const selectRamp = (index: number) => {
    if (index === rampIndex) return
    rampIndex = index
    ramp?.dispose()
    ramp = rampTexture(rampData(index))
    displayUniforms.uRamp.value = ramp
  }

  return {
    id: 'erosion',
    label: 'Hydraulic erosion',
    blurb:
      "The virtual-pipe model on a 256² grid: five passes per step, every cell flowing at once. Topic 2's erosion, reimplemented because droplets cannot be parallel.",
    params: PARAMS,
    presets: [
      {
        value: 'valleys',
        label: 'Valleys',
        hint: 'Steady rain and moderate capacity — broad dendritic networks over the whole field.',
        params: { rain: 0.05, evaporate: 0.9, capacity: 0.2, erode: 0.12, deposit: 0.3, minSlope: 0.005 },
      },
      {
        value: 'gorges',
        label: 'Gorges',
        hint: 'High capacity, low deposition: fewer channels, cut much deeper.',
        params: { rain: 0.07, evaporate: 1.1, capacity: 0.6, erode: 0.35, deposit: 0.12, minSlope: 0.002 },
      },
      {
        value: 'floodplain',
        label: 'Floodplain',
        hint: 'Low capacity and heavy deposition — sediment drops almost at once and fills the basins.',
        params: { rain: 0.09, evaporate: 0.6, capacity: 0.1, erode: 0.12, deposit: 0.75, minSlope: 0.02 },
      },
    ],

    init(webglRenderer) {
      renderer = webglRenderer
      terrain = new Field(SIZE, SIZE)
      flux = new Field(SIZE, SIZE)
      const texel = new THREE.Vector2(1 / SIZE, 1 / SIZE)

      uniforms = {
        uTerrain: { value: null },
        uFlux: { value: null },
        uTexel: { value: texel },
        uDt: { value: 0.03 },
        uRain: { value: 0.05 },
        uPointer: { value: new THREE.Vector3(0, 0, 0) },
        uRadius: { value: 0.05 },
        uGravity: { value: 6 },
        uFriction: { value: 0.95 },
        uCapacity: { value: 0.2 },
        uErode: { value: 0.12 },
        uDeposit: { value: 0.3 },
        uMinSlope: { value: 0.005 },
        uMaxChange: { value: 0.012 },
        uTalus: { value: 0.25 },
        uThermal: { value: 0.08 },
        uEvaporate: { value: 0.9 },
      }
      displayUniforms = {
        uTerrain: { value: null },
        uRamp: { value: null },
        uTexel: { value: texel },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uRelief: { value: 1.4 },
        uShowWater: { value: 1 },
        uContours: { value: 0.22 },
        uMin: { value: 0 },
        uSpan: { value: 1 },
      }

      rainMaterial = createPass(RAIN, uniforms)
      fluxMaterial = createPass(FLUX, uniforms)
      hydraulicMaterial = createPass(HYDRAULIC, uniforms)
      transportMaterial = createPass(TRANSPORT, uniforms)
      thermalMaterial = createPass(THERMAL, uniforms)
      displayMaterial = createPass(DISPLAY, displayUniforms)
      selectRamp(0)
      this.reset(defaults(PARAMS))
    },

    reset() {
      if (!renderer || !terrain || !flux) return
      elapsed = 0
      // Reset returns the SAME terrain, deliberately. A reset that reseeded
      // gave a different landscape every time, which makes comparing two
      // parameter settings meaningless — a mistake made while tuning this, and
      // it invalidated a whole sweep before it was noticed.
      const { data, min, span } = seedTerrain(seed)
      const texture = dataTexture(data, SIZE, SIZE)
      seedField(renderer, terrain, texture)
      texture.dispose()

      // The ramp is fitted to the starting terrain and then left alone.
      // Refitting every frame would make erosion look like it was doing
      // nothing, because the colours would track the ground down as it fell.
      displayUniforms.uMin.value = min
      displayUniforms.uSpan.value = span

      const zero = dataTexture(new Float32Array(SIZE * SIZE * 4), SIZE, SIZE)
      seedField(renderer, flux, zero)
      zero.dispose()

      initialMass = measureMass()
      massDrift = 0
      sinceProbe = 0
    },

    step(params, pointer: Pointer) {
      if (!renderer || !terrain || !flux) return
      uniforms.uDt.value = param(params, PARAMS, 'dt')
      uniforms.uRain.value = param(params, PARAMS, 'rain')
      uniforms.uGravity.value = param(params, PARAMS, 'gravity')
      uniforms.uFriction.value = param(params, PARAMS, 'friction')
      uniforms.uCapacity.value = param(params, PARAMS, 'capacity')
      uniforms.uErode.value = param(params, PARAMS, 'erode')
      uniforms.uDeposit.value = param(params, PARAMS, 'deposit')
      uniforms.uMinSlope.value = param(params, PARAMS, 'minSlope')
      uniforms.uEvaporate.value = param(params, PARAMS, 'evaporate')
      uniforms.uTalus.value = param(params, PARAMS, 'talus')
      uniforms.uThermal.value = param(params, PARAMS, 'thermal')

      const brush = param(params, PARAMS, 'brush')
      const impulse = uniforms.uPointer.value as THREE.Vector3
      const inside =
        pointer.active && pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1
      impulse.set(pointer.x, pointer.y, inside ? brush : 0)

      const steps = Math.round(param(params, PARAMS, 'steps'))
      lastSteps = steps
      for (let i = 0; i < steps; i++) {
        uniforms.uFlux.value = flux.texture

        uniforms.uTerrain.value = terrain.texture
        runPass(renderer, rainMaterial, terrain.target)
        terrain.swap()

        uniforms.uTerrain.value = terrain.texture
        runPass(renderer, fluxMaterial, flux.target)
        flux.swap()

        uniforms.uFlux.value = flux.texture
        runPass(renderer, hydraulicMaterial, terrain.target)
        terrain.swap()

        uniforms.uTerrain.value = terrain.texture
        runPass(renderer, transportMaterial, terrain.target)
        terrain.swap()

        uniforms.uTerrain.value = terrain.texture
        runPass(renderer, thermalMaterial, terrain.target)
        terrain.swap()
      }
      elapsed += steps

      // A full readback stalls the pipeline, so this is throttled hard: it is
      // a correctness instrument, not part of the simulation.
      sinceProbe += steps
      if (sinceProbe >= 240) {
        sinceProbe = 0
        if (initialMass !== 0) massDrift = (measureMass() - initialMass) / initialMass
      }
    },

    draw(webglRenderer, params) {
      if (!terrain) return
      selectRamp(Math.round(param(params, PARAMS, 'palette')))
      displayUniforms.uTerrain.value = terrain.texture
      displayUniforms.uRelief.value = param(params, PARAMS, 'relief')
      displayUniforms.uShowWater.value = param(params, PARAMS, 'water')
      displayUniforms.uContours.value = param(params, PARAMS, 'contours')
      runPass(webglRenderer, displayMaterial, null)
    },

    resize(width, height) {
      ;(displayUniforms.uViewport.value as THREE.Vector2).set(width, height)
    },

    stats() {
      return [
        { label: 'grid', value: `${SIZE}² = ${(SIZE * SIZE).toLocaleString()} cells` },
        { label: 'passes per frame', value: `${lastSteps} × 5 = ${lastSteps * 5}` },
        { label: 'steps since reset', value: elapsed.toLocaleString() },
        {
          label: 'mass drift',
          value: `${massDrift >= 0 ? '+' : ''}${(massDrift * 100).toFixed(3)}%`,
        },
      ]
    },

    dispose() {
      terrain?.dispose()
      flux?.dispose()
      ramp?.dispose()
      rainMaterial?.dispose()
      fluxMaterial?.dispose()
      hydraulicMaterial?.dispose()
      transportMaterial?.dispose()
      thermalMaterial?.dispose()
      displayMaterial?.dispose()
      terrain = null
      flux = null
      renderer = null
    },
  }
}
