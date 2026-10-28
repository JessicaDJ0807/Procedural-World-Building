/** The catalog's three ways of looking at a specimen. */
export type ViewMode = 'material' | 'structure' | 'growth'

/** Colours for the Growth view: Build's species swatches (the Draper's too), and Layered's amber for the meeting. */
export const GROWTH_COLOURS = { climber: '#5f8f6a', spreader: '#c4b45a', draper: '#4f9479', meeting: '#e8a24a' }
/** Colours for the Structural view: cables in the Draper's teal, since they are its contribution. */
export const STRUCTURE_COLOURS = { deck: '#f4efe6', frame: '#b65a32', roots: '#6e4c34', cables: '#2f8a78' }
