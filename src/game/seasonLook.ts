import * as THREE from 'three'
import type { SeasonLook } from '../build/seasonFx'
import { seasonWeights } from './seasons'

/**
 * What each season looks like — leaf colour, lawn, sky, light — blended by
 * the season weights, so the world shifts as gradually as its weather. Pure
 * presentation: the simulation's seasons are rain, sun direction and warmth
 * (seasons.ts); this only makes them visible. Particles follow the real rain
 * (more drops the wetter it is) and the season: snow in winter, falling
 * leaves in autumn, a few petals in spring.
 */

type Palette = {
  /** Leaves are pulled this far (0–1) toward this colour, keeping their own light and dark. */
  leaf: string
  leafMix: number
  /**
   * Multiplies the lawn's colours. A multiply can't grey a colour, only
   * shift it: lifting red and blue more than green is what pales the grass.
   */
  lawn: [number, number, number]
  zenith: string
  horizon: string
  sun: string
  sunIntensity: number
  sky: number
  snow: number
  leaves: number
  petals: number
}

const PALETTES: Palette[] = [
  // Spring: fresh light green, the clear-day sky.
  { leaf: '#a9d86a', leafMix: 0.28, lawn: [1, 1.04, 0.95], zenith: '#5f93cf', horizon: '#d8e6f1', sun: '#fff3e2', sunIntensity: 2.6, sky: 1.5, snow: 0, leaves: 0, petals: 0.5 },
  // Summer: deep green, a deeper sky, warm strong light, a drier lawn.
  { leaf: '#4e8a3a', leafMix: 0.22, lawn: [1.1, 1.0, 0.78], zenith: '#4a86cf', horizon: '#d6e6f4', sun: '#fff0d4', sunIntensity: 2.9, sky: 1.5, snow: 0, leaves: 0, petals: 0 },
  // Autumn: orange and red leaves, a golden lawn, a warmer horizon and lower light.
  { leaf: '#d9772b', leafMix: 0.62, lawn: [1.25, 0.98, 0.62], zenith: '#6f93bf', horizon: '#ecdcc4', sun: '#ffd8a6', sunIntensity: 2.3, sky: 1.4, snow: 0, leaves: 1, petals: 0 },
  // Winter: dull brown-green, a pale frosty lawn, a pale sky, soft cool light.
  { leaf: '#857a58', leafMix: 0.55, lawn: [1.4, 1.12, 1.6], zenith: '#94aac2', horizon: '#e7edf1', sun: '#e6eef8', sunIntensity: 1.8, sky: 1.65, snow: 1, leaves: 0, petals: 0 },
]

const C = PALETTES.map((p) => ({ leaf: new THREE.Color(p.leaf), zenith: new THREE.Color(p.zenith), horizon: new THREE.Color(p.horizon), sun: new THREE.Color(p.sun) }))

/** The world's look at a step, given the real rain right now. */
export function lookAt(step: number, rain: number): SeasonLook {
  const w = seasonWeights(step)
  const look: SeasonLook = {
    leaf: new THREE.Color(0, 0, 0),
    leafMix: 0,
    lawn: new THREE.Color(0, 0, 0),
    zenith: new THREE.Color(0, 0, 0),
    horizon: new THREE.Color(0, 0, 0),
    sun: new THREE.Color(0, 0, 0),
    sunIntensity: 0,
    skyIntensity: 0,
    rain: 0,
    snow: 0,
    leaves: 0,
    petals: 0,
  }
  w.forEach((k, i) => {
    if (!k) return
    const p = PALETTES[i]
    look.leaf.add(C[i].leaf.clone().multiplyScalar(k))
    look.leafMix += p.leafMix * k
    look.lawn.add(new THREE.Color(...p.lawn).multiplyScalar(k))
    look.zenith.add(C[i].zenith.clone().multiplyScalar(k))
    look.horizon.add(C[i].horizon.clone().multiplyScalar(k))
    look.sun.add(C[i].sun.clone().multiplyScalar(k))
    look.sunIntensity += p.sunIntensity * k
    look.skyIntensity += p.sky * k
    look.snow += p.snow * k
    look.leaves += p.leaves * k
    look.petals += p.petals * k
  })
  // Rain you can see follows the real rain: none in the dry, heavy when wet — and in winter it falls as snow.
  look.rain = Math.max(0, Math.min(1, (rain - 0.4) / 0.4)) * (1 - look.snow)
  return look
}
