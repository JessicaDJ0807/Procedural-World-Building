# Explorable worlds

Jessica Hsiao · Procedural World Building

Three worlds you can fly around in, generated from one system. What the
architecture is, what it costs, and the four things that were wrong before the
measurements found them.

## Contents

- [One system, three numbers sets](#one-system-three-number-sets)
- [Chunks](#chunks)
- [The height function](#the-height-function)
- [Ground, and why it stopped being one colour](#ground-and-why-it-stopped-being-one-colour)
- [Scatter](#scatter)
- [Moving](#moving)
- [The overview](#the-overview)
- [Performance](#performance)
- [Notes](#notes)

## One system, three number sets

![The three worlds, as cards](../images/explore-worlds.jpg)

There is no per-world code. `WorldSpec` holds terrain parameters, a landmark, a
colour ramp, fog, lights, scatter rules and a spawn, and every one of those
fields feeds the same chunk builder, the same scatter pass and the same
renderer. Nothing downstream branches on a world's `id`. That is the claim the
demo exists to make, so the implementation had to be honest about it.

| | Volcanic Caldera | Frozen Archipelago | Verdant Valley |
| --- | --- | --- | --- |
| Octave shaping | ridge | none | none |
| Shaping of the sum | none | **terrace** | none |
| Amplitude | 30 | 38 | 27 |
| Domain warp | 16 | 9 | 12 |
| Landmark | volcano, 210 high | massif, 130 high | valley trough, 34 deep |
| Waterline | 16 (81% dry) | 21 (**48% dry**) | −13 (97% dry) |
| Scatter | pillars, rocks | bergs, rocks | **trees**, rocks |
| Seed | 1337 | 20260108 | 77 |

Seeds are fixed. A spawn point chosen against one terrain means nothing if the
terrain is re-rolled on refresh, and a presentation cannot afford to find that
out live.

![Volcanic Caldera: lava in the hollows, basalt pillars, the cone on the horizon](../images/explore-volcanic.jpg)

![Frozen Archipelago: terraced ice shelves above the waterline, the massif ahead](../images/explore-frozen.jpg)

![Verdant Valley: trees clustered on the flats, thinning as the ground steepens toward the trough](../images/explore-verdant.jpg)

## Chunks

A 5×5 ring of 160-unit chunks follows the camera, each 64×64 quads — 204,800
triangles on screen, constant regardless of how far you travel.

Chunks line up because **they do not know about each other**. Every vertex asks
the height function for its own world coordinate, so two chunks sharing an edge
ask the same question at the same place and get the same answer. There is no
stitching step and no neighbour lookup.

Positions are chunk-local with the mesh placed at the chunk origin. In world
space, a vertex 10,000 units out loses enough float precision to make the
surface visibly shimmer.

**The fog is doing structural work.** Its colour is also the scene background,
so there is no horizon line — the terrain dissolves into distance at the same
colour the sky already is, and the edge of the loaded ring is never visible.
Any difference between the two draws a hard line exactly where the world is
supposed to end.

## The height function

Hashed value noise, not the project's existing noise. `compositeLayers` fills a
fixed grid, and `density.ts`'s continuous version samples a 16×16 lattice that
wraps — fine inside a 1.3-unit cube, visibly tiled after a hundred units of
walking. Here an integer coordinate pair goes through an integer mix and comes
back as a value in [0, 1). Same Hermite fade and bilinear interpolation as the
rest of the project's value noise; only the lattice lookup differs. Nothing is
allocated, so a chunk can be built on demand.

**There is no hydraulic erosion, and that is a real loss.** Droplets run over a
whole grid and accumulate across it, so there is no way to erode one chunk
without its neighbours disagreeing at the seam. Topic 2's dendritic channels are
the better landform and they are not here. What stands in for them is ridged
shaping and domain warp, both of which are pointwise and therefore chunkable.

**Landmarks are terms in the height function, not placed meshes.** The volcano
is a cone with a crater subtracted from its summit, added to the height at every
coordinate inside its radius. That makes it procedural, seamless across chunks
for free, and — because it sits at a known coordinate — something a spawn point
can be aimed at.

## Ground, and why it stopped being one colour

Height alone decided the colour at first, and it is why large areas came out
flat: a world whose ground sits within ten units of its own median spends almost
the whole ramp on terrain nobody stands on, and everything within walking
distance lands on the same two entries. Three things break that up, in order of
how much they do.

**Slope exposes rock.** The single largest improvement. Anything steep stops
being soil or ice and becomes the rock underneath, which is both what happens
and what makes relief legible — a hillside now reads as a hillside from its
colour, not only from its shading. How early rock shows is per world: on the
volcanic ground it is almost everything, on the verdant hills grass holds on to
all but the steepest, which is the difference between a crag and a hill.

**A shoreline band.** A few units either side of the waterline, where the ramp
would otherwise cross from one stop to the next with nothing marking the edge of
the water. On the volcanic world it is the glow where rock meets lava.

**Four octaves of tint**, each answering a different distance. Two run to
several hundred units and separate one hillside from the next. The third, around
55 units, is what you see while walking. The fourth exists for the bottom of the
frame: ground a few metres away at a grazing angle, where a 55-unit wavelength
is one colour across the entire strip. It stops there because the vertex grid is
2.5 units, and an octave finer than about ten has nowhere to be sampled.

## Scatter

Candidates per chunk from a deterministic per-chunk sequence, filtered by bands
on height and flatness, then **gated by a low-frequency field**. The gate is what
turned a scatter into a landscape: without it the survivors of the bands are
spread evenly across everything that qualifies, and nothing in nature is evenly
spread. With it, stands have edges and boulder fields have gaps.

Three further things stop a stand reading as one object repeated:

- **Three geometries per kind.** A wood of identical cones is the clearest tell
  that a scene was generated. Conifer, broader conifer, rounded crown.
- **Roughened solids.** An icosahedron reads as an icosahedron whatever colour
  it is. Each variant's vertices are displaced by a hash of their own position —
  once, when the geometry is built — so boulders are irregular and faceted
  rather than regular. Vertices are moved by position rather than by index, so
  faces that shared a corner still share it and the surface does not tear.
- **Per-instance colour, lean and stretch.** Two trees side by side being the
  same green is as flat as two hillsides being the same green, and a stand of
  perfectly plumb trees is a giveaway that nothing grew there.

Rejection rather than solving for valid ground: asking the height function at a
point is cheap, and a rule that rejects most of its attempts is *how* a band
produces clustering.

There are three scales, because a world with only two has a hole in it exactly
where a viewer spends most of their time looking. Landmarks are hundreds of
units, trees and boulders are tens, and the third tier is shrubs and rubble.
Note that tier is sized at one to three units rather than grass-sized: the first
attempt was half a unit, which is correct for grass and completely invisible in
a world whose chunks are 160 units across. It was being drawn and could not be
seen.

## Moving

<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> and the mouse, <kbd>Shift</kbd>
to sprint. <kbd>R</kbd> and <kbd>F</kbd> rise and drop; <kbd>G</kbd> puts you
back on the ground. <kbd>Space</kbd> and <kbd>C</kbd> work as the other common
pair for up and down.

**The camera walks by default and flies when asked.** It flew unconditionally
at first, with the ground only as a floor it could not drop through, and the
reasoning was that the most useful thing a viewer can do is rise above a ridge
to see what is behind it. That is still true and still why flying exists. What
it got wrong is the rest of the time: walk forward off a hill and you keep your
altitude, hanging over the valley. Nothing about that reads as exploring a
world.

There is no mode key to remember. Asking to go up *is* asking to fly, so R, F,
Space and C each switch to flight, and G lands. Neither mode has collision —
walking into a cliff climbs it — because a demo of terrain does not need to be
a demo of movement, and a contact test that gets a cliff wrong is worse than
none.

Height is eased rather than pinned. Following the surface exactly makes a
sprint over broken ground jitter, because the eye tracks every lump the feet
would absorb. A drop of more than about twelve units eases faster, so stepping
off a cliff reads as a fall rather than a long glide.

Keys are read from `event.code`, the physical key, not `event.key`. On an AZERTY
keyboard W and A are somewhere else entirely, and with a modifier held they
produce different characters again.

## The overview

<kbd>M</kbd> from anywhere, locked or not, lifts you out of the world and orbits
it from above.

![The Frozen Archipelago from above: the massif, the island distribution, and the pin where you were standing](../images/explore-survey.jpg)

**It is a toggle inside Explore rather than a separate page.** It is the same
world and the same spec, so a page of its own would duplicate the scene setup
and — worse — make you leave the world to find out where you are. The question
it answers is "where am I in this", which is only interesting while you are in
it.

**It is a separate coarse mesh, not a wider chunk ring.** Seeing the whole
landmark means covering about 4,200 units; at the ring's resolution that is 625
chunks and five million triangles, for a view where one triangle is below a
pixel. The same height function on a 128² grid gives the same landform in 32,768
triangles. The detail thrown away is detail the view cannot resolve.

It is geometry rather than a rendered map because the thing worth seeing from
above is relief — where the high ground is, how the valley runs, which way the
islands lie — and that reads from shading. The pin is a vertical line rather
than a dot: from overhead a flat marker on sloping ground cannot be placed in
depth.

## Performance

Three minutes of sprinting per world — 20,808 units, about 165 chunk boundaries
crossed:

| | Volcanic | Frozen | Verdant |
| --- | --- | --- | --- |
| Chunk build, median | 3.3 ms | 3.8 ms | 4.3 ms |
| Chunk build, worst | 6.7 ms | 7.5 ms | 8.7 ms |
| Live chunks, max | 25 | 25 | 25 |
| Scatter instances, max | 4,056 | 1,199 | 7,507 |
| Triangles | 204,800 | 204,800 | 204,800 |

Nothing grows. Entering and leaving all three worlds twice returns the canvas
count to zero every time and moves the heap from 42.8 MB to 50.6 MB.

The render loop is the project's own, so a world that nobody is flying stops
scheduling frames entirely — the loop reports "still moving" only while the
pointer is locked.

## Notes

**The first build cost a dropped frame about once a second.** `normalAt` asks
the height function four extra times per vertex, which is five calls where one
would do, and the height function is essentially the whole cost of a chunk.
Boundary crossings measured 7–12 ms median against a 16.7 ms frame budget, worst
18.8. Building the heights into a grid with one extra ring and differencing
*that* brought it to 2–3 ms, worst 5.0. The extra ring is the part that matters:
differencing only a chunk's own vertices makes edge normals one-sided and every
boundary shows as a crease.

**Two of the three waterlines were below every point in their world.** Volcanic
sat at −4 and frozen at 7, and both rendered 100% dry — no lava, and an
archipelago that was one continuous landmass. The fix came from measuring the
height distribution rather than looking: volcanic's 25th percentile is 17, so a
waterline at 16 floods the lowest quarter and nothing else; frozen's median is
20.7, so 21 drowns half the world and leaves islands.

**Two of the three spawns faced backwards.** `forward` is
`(−sin yaw, 0, −cos yaw)`, so yaw 0 looks down −z and yaw π looks *away*.
Volcanic was 180° out and verdant 143°, which is why the volcano was never in
any screenshot. The one heading that was right came from the solver that
computes it; the two that were wrong were typed by hand. The check now compares
the camera's forward vector against the direction to the landmark and prints the
angle.

**Two separate "nothing happens" bugs were the same sleeping loop.** The frame
function reports "still moving" only while the pointer is locked, so the loop
stops the moment it is released — and nothing woke it when the lock was
*taken*, which meant WASD moved nothing at all. The same fault hid the overview:
pressing M changed the React state and the camera, and the loop was asleep, so
no frame was ever drawn with it. Both are one `wake()` in the right place, and
the loop is now held in a ref so anything outside the scene effect can restart
it.

**Asking for the pointer on mount hid the cursor before anything could be
clicked.** Pointer lock needs a user gesture and entering a world is a click in
a different component — but the real damage was StrictMode, which mounts the
viewport twice: the first request landed on a canvas that the cleanup then
removed, leaving a hidden cursor over a curtain that still wanted clicking. The
curtain is the gesture now, and the only path in.

**The first overview rendered an empty frame.** Fog is tuned to hide the chunk
ring 300 units out, and exp2 fog falls off with the square of distance — at the
2,700 units the survey camera sits from the far side of the map that is
exp(−41). Survey mode rescales the density so the far edge sits at roughly half
visibility, and restores it on the way back down.

**The weakest thing left is the immediate foreground on gentle ground.** Seen at
a grazing angle, the few metres at the bottom of a frame are a lot of surface in
very few pixels, and with vertex colours on a 2.5-unit grid and no texture there
is a floor on how much variation can live there. Counted at the verdant spawn,
there are 301 ground-detail instances and 167 trees within 140 units — the
objects are present; it is the surface between them that stays smooth. A detail
texture or a triplanar material is the fix, and it is a bigger change than this
pass was for.

**Flying by default was the wrong default.** It was a deliberate choice with a
written reason, and the reason was about the one case — clearing a ridge —
rather than the common one. Walking off a hill and keeping your altitude is the
first thing anyone notices, and it was reported as a bug before it was noticed
here. The spawn `lift` existed only to prop up that default and is now 0 on all
three worlds.

**Terracing every octave is not terracing.** Quantising an octave and then
summing four more on top averages the steps straight back out, which is why the
ice shelves were invisible at first. The op has to run on the finished height.
The first implementation was also not a staircase: fading across the whole step
reconstructs something almost linear, so the rise is now compressed into the
last third of each step and most of the tread is flat.
