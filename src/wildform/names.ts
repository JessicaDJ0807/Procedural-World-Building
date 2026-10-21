/**
 * Every name the page shows, in one place, so the working title and the
 * species' names can change without touching the simulation.
 */
export const TITLE = 'Wildform midterm'
export const TAGLINE = 'Plants do not simply cover this architecture. Their growth changes it.'
export const INTRO = 'Guide the environment and watch two species grow, meet, and generate new architecture.'

/** Display names, by species index. */
export const SPECIES_NAMES = ['Climber', 'Spreader'] as const

/** Display names, by mutation kind. */
export const MUTATION_NAMES = { 'living-platform': 'Living Platform' } as const
