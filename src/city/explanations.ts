import type { ExperimentId } from '../config/cityConfig'

/**
 * The four-part explanation each experiment carries: the technique, how it
 * works, what the controls change, and where it could go in Wildform. Kept
 * short on purpose — the chapter in docs/topics has the depth and the numbers.
 */
export type Explanation = { lede: string; concept: string; algorithm: string; parameters: string; application: string }

export const EXPLANATIONS: Record<ExperimentId, Explanation> = {
  roads: {
    lede: 'A. Road networks — three strategies, one growth algorithm.',
    concept:
      'Roads are grown, not drawn. A network starts as one junction and spreads by proposing new segments, the way a town grows outward from a crossroads.',
    algorithm:
      'A priority queue of proposed segments (Parish & Müller, 2001). Each is checked by the same local rules — stay on land and off steep ground; stop at a road it crosses and make a junction; snap to a junction it ends near; stretch to meet a road just ahead; join a road it crowds. Survivors become roads, and the strategy proposes what grows from their ends: a grid goes straight and branches at 90°, organic wanders with noise and turns toward flat ground, layered grows curving primaries first and only then right-angled secondaries off them.',
    parameters:
      'Density sets the spacing. Width sets how much of the land the roads take, and so how big the blocks are once the road is cut out. Irregularity bends a grid and lets organic and layered roads wander. The seed changes the terrain and every random choice.',
    application:
      'Paths through a Wildform site could be grown the same way — from the entrances, steered by slope and the living structures, joining where they cross — instead of being laid out by hand.',
  },
  plots: {
    lede: 'B. Plots — the land between the roads, cut into parcels.',
    concept:
      'The roads enclose blocks; the blocks are cut into plots. Each plot is one decision later: what stands on it.',
    algorithm:
      'Every crossing is a junction, so the roads form a planar graph and each block is one of its faces — traced by always taking the next road clockwise. Dead ends are pruned first. Each face is inset by half of each road\'s width plus a setback. Then each block is split by straight lines: a regular lattice aligned to the block, or recursive bisection across the long side until pieces are small enough. A plot that touches no road is flagged.',
    parameters:
      'Plot size is the target side. Regular grid gives equal lots; irregular gives a patchwork, and cut irregularity moves and tilts each cut. Categories here are random, in fixed shares, on purpose — they are the control for Experiment C.',
    application:
      'Subdivision is how Wildform could divide a site into growing beds, terraces or habitats with a guaranteed edge on a path — and know which plots have none.',
  },
  zoning: {
    lede: 'C. Zoning maps — continuous fields making discrete decisions.',
    concept:
      'A map is a number at every point. A decision is one of a few answers per plot. Zoning is the rule between them: read the maps where the plot is, and pick.',
    algorithm:
      'Five fields on a grid: elevation and distance from the terrain and the plan, moisture from water and elevation, density from distance and flatness, vegetation from moisture and density — each plus noise. Each plot reads them at its centre and takes the first rule that applies, from a list of seven. The build rule is either a hard threshold or a soft band where density becomes a probability and each plot rolls its own seeded die.',
    parameters:
      'Noise scale and intensity set how patchy the maps are. Reach sets how far the city extends. The two thresholds move the lines where building and park begin; the soft band frays the district edge. Coherence measures the result: how often neighbouring plots agree.',
    application:
      'Wildform already runs on fields — sunlight, moisture, shelter. The same pattern, a threshold on a field turned into a choice per cell, is how a site could decide where each species may root.',
  },
  building: {
    lede: 'D. A parametric building — boxes, a prism, and rules.',
    concept:
      'A building is a function: numbers in, geometry out. The same parameters always make the same building; the seed varies the details.',
    algorithm:
      'A wall box for the body; floor bands; one window per bay on every face, a door in the middle bay of the front; balconies rolled per bay on the front and back and stacked up every floor; a flat roof with a parapet and sometimes a plant room, or a gable prism whose ridge runs along the longer side. Every part is a scaled box or prism, so the renderer draws all of them instanced.',
    parameters:
      'Width, depth and floors set the mass. Roof type and slope set the top. Balcony probability is per bay. Facade variation widens the bays, varies window size, blanks some windows, adds bands, sets the top floor back, widens the colour range and breaks up the balcony stacks.',
    application:
      'Wildform\'s architecture is grown, but its hosts — the buildings plants climb — could be generated like this, so every site has a different set to grow on, with the facades (bays, balconies, setbacks) that the growth model treats as ledges and shelter.',
  },
  site: {
    lede: 'E. The site — every stage together, the maps deciding.',
    concept:
      'Put the four together and the maps run the city: dense ground builds tall, sparse ground builds low and leaves room for green, wet ground stays planted.',
    algorithm:
      'Roads → blocks → plots → zoning, as before. A building plot gets one building from Experiment D: floors and type from density, footprint from the plot\'s bounding box turned to face its road, shrunk until it fits. Parks, gardens and open land are planted by jittered grids thinned by the vegetation map, and the countryside outside the blocks by the vegetation map alone.',
    parameters:
      'Max floors sets the skyline\'s peak. The thresholds and soft band are Experiment C\'s; the building style is Experiment D\'s. New seed regenerates the whole site.',
    application:
      'This is the pipeline Wildform\'s Site page could run on ground it has never seen: grow access, divide the land, read the fields, and place hosts and planting by rule.',
  },
}
