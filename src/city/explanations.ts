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
  agents: {
    lede: 'F. Inhabitants — schedules and routes on the generated city.',
    concept:
      'An agent is a schedule and a position. Each inhabitant has a home, a job and a park, and moves between them through the day; the roads from Experiment A are the only way to get anywhere.',
    algorithm:
      'The road network becomes a weighted graph — junctions are nodes, roads are edges weighted by length. A trip is a route found by A* (straight-line distance as the heuristic) between the junctions nearest two doors. Each inhabitant runs one loop: at home until a personal leave time, to work, a 7–9 hour shift, to the park for 20–110 minutes, home. Time is a fixed step of one simulated minute; every random draw comes from one seeded stream, so a run replays exactly.',
    parameters:
      'Population sets how many — homes are drawn by residential capacity, jobs by job capacity. Movement speed is world units per simulated minute. Simulation speed is minutes per real second; it changes how many steps run per frame, never how long a step is.',
    application:
      'Wildform\'s inhabitants could keep schedules the same way — a nest, a feeding ground, a place to rest — and route over the living platforms as a graph, so the creatures\' paths depend on what has grown.',
  },
  resources: {
    lede: 'G. Resource flow — supply, demand and the network between.',
    concept:
      'Buildings consume; plants produce; a network in between limits what reaches whom. A shortage can come from too little supply or from pipes too narrow to carry it — and the two look different on the map.',
    algorithm:
      'One plant per resource: water works at the junction nearest open water, the power station farthest from the centre, the waste depot far from both. The network is Dijkstra\'s shortest-path tree from the plant over the roads; pipe capacity follows road width. Each minute, buildings are served nearest-first: each gets the least of its demand, what the plant has left, and the spare capacity of the tightest pipe on its way. Under the shared policy every demand is first rationed to supply ÷ demand, so a shortfall is spread thin instead of landing on the far end. Demand follows a daily curve — homes in the morning and evening, workplaces in the day.',
    parameters:
      'Supply sets each plant\'s output, demand scales every building, capacity sizes the pipes, and the policy decides who goes short. Pins over buildings show the selected resource: green served, amber to red short. Pipes redden as they fill; beads run in the direction of flow.',
    application:
      'Water and nutrients reaching plants through Wildform\'s structure could be a tree like this from a source — a root, a gutter, a cistern — with the far tips going short first.',
  },
  dynamics: {
    lede: 'H. Urban dynamics — people and resources, coupled.',
    concept:
      'Put F and G together and they feed back: people make demand, demand meets a limited supply, shortages close buildings, and closures change where people go.',
    algorithm:
      'Five rules, applied every minute. 1: a building asks for one unit of water and energy and half a unit of waste per person inside, plus a standing 10% of its full-occupancy load. 2: supply is allocated along each network by the chosen policy, and pipes cap each branch. 3: a building\'s activity drifts toward its worst-supplied share of water and energy (waste counts half), over about an hour. 4: a building below 0.4 activity closes and reopens above 0.6; workers arriving at a closed workplace are turned away to the park. 5: the statistics are counted from these.',
    parameters:
      'Supply at 100% is sized for 300 inhabitants. Raise the population to 330 and, served nearest-first, half the town closes; switch to shared and nothing closes even at 800, though everything runs at half activity. Lower it again and buildings reopen as activity recovers.',
    application:
      'This is the shape of resource-driven growth in Wildform: plants as consumers, light and water as supply, growth as activity that follows supply, and inhabitants whose movement changes where the demand is.',
  },
}
