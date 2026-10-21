/**
 * The two species: one growth rule, two behaviours.
 *
 * What differs is what each wants from a cell (light, water, support) and
 * which way it prefers to go. Everything else — tips, entering, branching,
 * side shoots — is the shared rule in growth.ts.
 *
 * - **Climber**: goes up. Tolerates shade, wants moderate water, and leans
 *   hard on support — corners, frames, ledges — so it runs up the building's
 *   edges in long, sparse, directional strands.
 * - **Spreader**: goes sideways. Searches for light, needs little water, and
 *   likes ledges and open wall, where it fills dense patches.
 */
export type WildSpecies = {
  /** Sun field value it likes best, 0–1. */
  lightPreference: number
  /** Moisture at which it is fully happy, 0–1. */
  moistureNeed: number
  /** 0–1. How much support (the geometry field) weighs in its suitability. */
  support: number
  /** Weight on a step's rise (+1 straight up a wall, −1 straight down). */
  vertical: number
  /** Weight on a step staying level. */
  lateral: number
  /** Bonus for stepping onto a ledge row. */
  ledge: number
  /** Weight on carrying on in the same direction. */
  straightness: number
  /** Penalty per grown neighbour: high spreads thin, low packs dense. */
  crowding: number
  /** Branch chance after growing: base + perEnv × env. */
  branch: number
  branchPerEnv: number
  /** Active tips at most. */
  maxTips: number
  /**
   * Whether losing a cell takes everything grown from it. A climber's stem
   * carries what is above it; a spreader is a mat and dies back piece by
   * piece. Carried for both at first, one smothered spreader cell near its
   * root took over two thousand with it.
   */
  carries: boolean
  /** Side shoots woken per step, per 100 grown cells of this species — up to SHOOT_CAP a step, or a big stand puts out shoots without end. */
  shoots: number
  look: { young: string; lush: string; dry: string; stem: string; swatch: string }
}

export const WILD_SPECIES: WildSpecies[] = [
  {
    // Climber
    lightPreference: 0.5,
    moistureNeed: 0.4,
    support: 0.5,
    vertical: 0.85,
    lateral: 0,
    ledge: 0,
    straightness: 0.45,
    crowding: 0.35,
    branch: 0.03,
    branchPerEnv: 0.04,
    maxTips: 30,
    shoots: 0.7,
    carries: true,
    look: { young: '#93b06b', lush: '#3f6a45', dry: '#6a7148', stem: '#56603a', swatch: '#5f8f6a' },
  },
  {
    // Spreader
    lightPreference: 0.85,
    moistureNeed: 0.3,
    support: 0.25,
    vertical: -0.05,
    lateral: 0.55,
    ledge: 0.35,
    straightness: 0.1,
    crowding: 0.05,
    branch: 0.06,
    branchPerEnv: 0.06,
    maxTips: 22,
    shoots: 0.5,
    carries: false,
    look: { young: '#bcc884', lush: '#7d8f45', dry: '#9a9460', stem: '#6b5a3a', swatch: '#aab05e' },
  },
]

export const CLIMBER = 0
export const SPREADER = 1
