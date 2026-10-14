/**
 * What a piece of façade is, and what that means to a plant.
 *
 * Every campus cell gets one of these types from its building's façade rules
 * (facade.ts). The type sets the cell's flags for the shared growth rules —
 * glass can't be grown on and sheds rain, a ledge holds water, a sheltered
 * cell gets no rain, frames and edges are paths to follow — and these
 * coefficients on top:
 *
 * - **species**: a multiplier on each species' env and suitability (ivy,
 *   moss, vine) — how well each can hold on and live here. Attachment is
 *   folded in: smooth metal is poor for everything, a louver is a ladder
 *   for the vine, a damp base is home to moss.
 * - **moisture**: added to the moisture field — water a surface holds.
 * - **light**: a multiplier on the light — shade the computed sun can't see,
 *   such as the underside of a cantilever.
 * - **source**: whether automatic planting seeds here.
 *
 * These are design coefficients, chosen to make architecture matter
 * plausibly, not measurements. One table, so every building and both the
 * growth and the debug view read the same numbers.
 */

export const SURFACE_TYPES = [
  'OPAQUE_PANEL',
  'GLASS',
  'SMOOTH_METAL',
  'PANEL_SEAM',
  'LOUVER',
  'LEDGE',
  'RAILING',
  'ROOF_EDGE',
  'GROUND_CONTACT',
  'ROOF_GARDEN',
  'RECESSED',
  'ROOF',
  'PERFORATED_METAL',
] as const
export type SurfaceType = (typeof SURFACE_TYPES)[number]

export type SurfaceInfo = {
  label: string
  /** What it means to a plant, in a phrase, for the hover tooltip. */
  note: string
  /** The debug view's colour. */
  debug: string
  growthAllowed: boolean
  /** Ivy, moss, flowering vine. */
  species: [number, number, number]
  moisture: number
  light: number
  source: boolean
  /** Treat as an edge vegetation follows (the growth model's FRAME flag). */
  follow: boolean
  /** Holds water like a ledge (LEDGE flag). */
  holdsWater: boolean
  /** Out of the rain (SHELTER flag). */
  sheltered: boolean
}

export const SURFACES: Record<SurfaceType, SurfaceInfo> = {
  OPAQUE_PANEL: { label: 'Opaque panel', note: 'a fair hold for ivy and vine; moss struggles', debug: '#b9a58c', growthAllowed: true, species: [0.85, 0.55, 0.8], moisture: 0, light: 1, source: false, follow: false, holdsWater: false, sheltered: false },
  GLASS: { label: 'Glass', note: 'nothing grows on glass, so plants go round it', debug: '#4f8fd6', growthAllowed: false, species: [0, 0, 0], moisture: 0, light: 1, source: false, follow: false, holdsWater: false, sheltered: false },
  SMOOTH_METAL: { label: 'Smooth metal', note: 'little to hold on to, so mostly bare', debug: '#9a9ea6', growthAllowed: true, species: [0.4, 0.15, 0.45], moisture: 0, light: 1, source: false, follow: false, holdsWater: false, sheltered: false },
  PANEL_SEAM: { label: 'Seam / frame', note: 'a seam or frame to follow, the best way up', debug: '#e8893a', growthAllowed: true, species: [1, 0.6, 0.95], moisture: 0.05, light: 1, source: false, follow: true, holdsWater: false, sheltered: false },
  LOUVER: { label: 'Louver', note: 'a ladder for the vine, a little shaded', debug: '#9b6fd0', growthAllowed: true, species: [0.8, 0.45, 1], moisture: 0.08, light: 0.85, source: false, follow: true, holdsWater: false, sheltered: false },
  LEDGE: { label: 'Ledge / parapet', note: 'holds water, and plants follow it', debug: '#e6cf3c', growthAllowed: true, species: [1, 0.9, 1], moisture: 0.15, light: 1, source: false, follow: true, holdsWater: true, sheltered: false },
  RAILING: { label: 'Railing', note: "the vine climbs it; moss can't", debug: '#d65fa8', growthAllowed: true, species: [0.8, 0.2, 1], moisture: 0, light: 1, source: false, follow: true, holdsWater: false, sheltered: false },
  ROOF_EDGE: { label: 'Roof edge', note: 'an edge to follow onto the roof', debug: '#c9703f', growthAllowed: true, species: [0.9, 0.8, 0.95], moisture: 0.1, light: 1, source: false, follow: true, holdsWater: false, sheltered: false },
  GROUND_CONTACT: { label: 'Ground contact', note: 'the damp base of the wall, where planting starts', debug: '#5fa65a', growthAllowed: true, species: [0.9, 1, 0.85], moisture: 0.2, light: 1, source: true, follow: false, holdsWater: false, sheltered: false },
  ROOF_GARDEN: { label: 'Roof garden', note: 'a planted terrace, where planting starts', debug: '#2f7d4a', growthAllowed: true, species: [1, 1, 1], moisture: 0.2, light: 1, source: true, follow: false, holdsWater: false, sheltered: false },
  RECESSED: { label: 'Recess / underside', note: 'shaded and out of the rain: moss and ivy, little vine', debug: '#3e5a6b', growthAllowed: true, species: [0.9, 1, 0.5], moisture: 0.12, light: 0.55, source: false, follow: false, holdsWater: false, sheltered: true },
  ROOF: { label: 'Roof', note: 'open roof, reached only from its edge', debug: '#8a8379', growthAllowed: true, species: [0.7, 0.75, 0.75], moisture: 0, light: 1, source: false, follow: false, holdsWater: false, sheltered: false },
  // Perforated aluminium: smooth, but the holes give tendrils and rootlets
  // something to take — better than plain metal, short of a seam.
  PERFORATED_METAL: { label: 'Perforated metal', note: 'smooth, but the holes give tendrils some grip', debug: '#c4c9d6', growthAllowed: true, species: [0.6, 0.25, 0.75], moisture: 0, light: 1, source: false, follow: false, holdsWater: false, sheltered: false },
}

export const surfaceInfo = (code: number): SurfaceInfo => SURFACES[SURFACE_TYPES[code]]
export const surfaceCode = (type: SurfaceType): number => SURFACE_TYPES.indexOf(type)
