import type { CreatureTab } from '../config/creatureConfig'

/**
 * One short explanation per system: the idea, how it is done here, what the
 * controls change, and what Wildform could take from it. The chapter in
 * docs/topics has the depth and the measurements.
 */
export type Explanation = { lede: string; concept: string; algorithm: string; parameters: string; application: string }

export const EXPLANATIONS: Record<CreatureTab, Explanation> = {
  body: {
    lede: 'A. Body morphology — a body grown from numbers, on a spine.',
    concept:
      'A creature is a hierarchy before it is a shape. A root sits in the middle of the torso; the spine runs forward to the head and back to the tail tip; everything else hangs from a point on that spine. The skin is laid over the spine afterwards.',
    algorithm:
      'The torso is a profile — half-girth as a function of position along the spine — swept as elliptical rings. Continuous: one smooth swell. Segmented: one bulge per segment with a pinch between, each segment\'s girth rolled from the body seed. Branching: a compact core carrying binary trees on its back. Every ring is bound to its two nearest spine bones, weighted by distance, so when the spine bends the skin follows: one skinned mesh, rebuilt only when a gene changes.',
    parameters:
      'Length, width and height set the profile; segments and variation set its rhythm; scale multiplies every length. Symmetry decides how the appendages are laid out: mirrored, round the body, or each side rolled separately.',
    application:
      'Wildform\'s inhabitants could be grown the same way — one genome per species, a spine and a profile instead of a hand-built model — so a new creature is a new set of numbers.',
  },
  anatomy: {
    lede: 'B. Anatomy — appendages fixed to the spine, not placed near it.',
    concept:
      'Every leg, eye, antenna and wing has an anchor: a position along the spine and an offset in the spine\'s own frame. That is what makes it part of the body. Bend the spine and the hips move with it; turn the head and the eyes go too.',
    algorithm:
      'Leg pairs are spread along the torso from the attachment position, and on a segmented body each pair snaps to its own segment. The ride height is solved so every foot stands at 80% of its reach; legs too short to lift the belly are lengthened by a rule in the genome repair. Two-bone legs are thigh and shin; a third bone stands the foot up on its toes; a fourth, the coxa, holds the leg out first, as an insect\'s does. Eyes sit on the head ellipsoid by azimuth and elevation; antennae are sprung chains.',
    parameters:
      'Leg count rebuilds the skeleton — 2, 4, 6, 8 legs is 2, 4, 6, 8 hips with their own joints. Eye count and placement set the field of view the creature perceives with in Behaviour; antennae add an all-round sense of smell.',
    application:
      'Anchors are what Wildform\'s growing structures need too: a vine fixed to a point on a beam, not floating beside it, so that when the beam changes the vine moves with it.',
  },
  motion: {
    lede: 'C. Locomotion — a gait is a table of phases; IK puts the feet down.',
    concept:
      'Every leg runs the same cycle. For part of it, the stance, the foot is on the ground and does not move; for the rest, the swing, it lifts and travels forward. A gait is only which legs are in step: the tripod, the trot and the wave are three tables of numbers.',
    algorithm:
      'The head moves at the commanded speed and the spine follows its path. The gait clock advances by speed ÷ stride, so faster means a quicker cadence, and the gait itself switches from walk to run by speed. A planted toe is pinned where it landed; a swinging one arcs to where its rest position will be half a stance later. If the body speeds up or turns so hard that a planted foot is about to be outrun, that foot steps early. Two-bone IK solves each knee by the law of cosines. A legless body slithers: its sideways wave is fixed to the ground, so every point follows one track.',
    parameters:
      'Movement speed and stride length set the cadence (cycle = stride ÷ speed — so the cycle is a result, shown, not a third slider). Stride is capped at what the legs can reach. Step height lifts the swing; sway bends the spine.',
    application:
      'The gait table and the planted-foot rule are independent of any one body, so Wildform\'s inhabitants could walk over its living platforms with feet that stay where they land. The one change: feet here land on flat ground at height 0, and would have to read the platform\'s height instead.',
  },
  behavior: {
    lede: 'D. Behaviour — senses from the body, a decision list, and the speed it asks for.',
    concept:
      'The creature knows only what its body can sense. A forward-eyed hunter misses food beside it that a side-eyed grazer sees; without eyes it finds food by smell or by touch. What it decides is a speed and a heading — and the locomotion turns that into a walk, a run or standing still.',
    algorithm:
      'Each step it perceives food within sight range and field of view, within smell range, or within touch. Then a priority list, top to bottom, first match wins: keep resting while energy recovers; rest when exhausted; steer away from a rock or the edge ahead; seek the nearest perceived food when hungry; walk to the wander goal; otherwise pause, then pick a new goal — a landmark, if curious. Moving costs energy by speed² and body mass; hunger rises with time and effort, and eating cuts it.',
    parameters:
      'Detection radius is the eyes\' range. Curiosity is how often a new goal is a landmark and how far it goes. Energy and hunger are the live state: drag them to make it rest or go looking for food now.',
    application:
      'The same perceive-then-decide loop, with Wildform\'s plants as the food and its structures as the obstacles and landmarks, is a behaviour for its inhabitants that reacts to what the player grows.',
  },
  variation: {
    lede: 'E. Variation — a genotype, its phenotype, and what a mutation does.',
    concept:
      'Everything on screen is built from about forty numbers: the genotype. The skeleton, mesh, gait and senses are its phenotype. Change a number and a different animal is built. Mutation changes a few at random — and repair keeps the result an animal that holds together.',
    algorithm:
      'Each gene is hit with probability strength × 0.35, at least one always. A real gene moves by a Gaussian of σ = strength × 25% of its range; a count moves a step; a choice moves to a neighbouring option — legs go up or down by a pair. The result is clamped to range and then repaired: a segment for every leg pair, legs long enough to lift the belly, radial symmetry only with four legs or more. The body seed is inherited, so a mutant keeps its parent\'s individual quirks.',
    parameters:
      'Strength sets how many genes change and how far. Each mutation makes the current creature the parent; the offspring stands beside it, and the genes that changed are listed.',
    application:
      'Wildform\'s species already differ by parameters; a genome per plant, mutated and repaired, is how a garden could breed new varieties that still grow.',
  },
}
