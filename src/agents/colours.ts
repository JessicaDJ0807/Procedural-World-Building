import type { AgentState } from './simulation'

/**
 * Agents are coloured by state, not by destination: the state is what the
 * page is about, and three destination hues on top of four states would leave
 * nothing distinguishable. Blue for searching, near-white for committed to a
 * trail, so the agents following routes are the brightest things on them.
 * Trail is amber, a hue no agent uses, and obstacles are the one neutral grey.
 */
export const STATE_COLOURS: Record<AgentState, string> = {
  idle: '#8b9099',
  explore: '#6ea8fe',
  navigate: '#f4f1ea',
  rest: '#7cc59a',
}

export const TRAIL_COLOUR = '#e8a048'
