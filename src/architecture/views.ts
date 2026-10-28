/** The catalog's three ways of looking at a specimen. */
export type ViewMode = 'material' | 'structure' | 'growth'

/** Colours for the Growth view: Build's species swatches, and Layered's amber for the meeting. */
export const GROWTH_COLOURS = { climber: '#5f8f6a', spreader: '#c4b45a', meeting: '#e8a24a' }
/** Colours for the Structural view. */
export const STRUCTURE_COLOURS = { deck: '#f4efe6', frame: '#b65a32', roots: '#6e4c34' }
