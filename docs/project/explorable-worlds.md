# Explorable worlds

Jessica Hsiao · Procedural World Building

Three worlds you can fly around in, generated from one system. What the
architecture is, what it costs, and the four things that were wrong before the
measurements found them.

## Contents

- [One system, three numbers sets](#one-system-three-number-sets)
- [The pipeline](#the-pipeline)
- [Chunks](#chunks)
- [The height function](#the-height-function)
- [Ground, and why it stopped being one colour](#ground-and-why-it-stopped-being-one-colour)
- [The river](#the-river)
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

## The pipeline

Everything downstream of the height function reads one thing:

```
height → slope → water depth → moisture → material → object probability
         ──────────── environment.ts ───────────    ──── worlds.ts ────
```

`environment.ts` turns a coordinate into a **Site**: its height, slope, depth
below the waterline, distance to the shore, altitude across the world's range,
moisture, and two noise fields. Material bands and scatter rules are both
written against those fields and nothing else — so "trees stop at the waterline"
and "the bank is wet soil" are the same fact stated twice rather than two
unrelated thresholds that happen to agree.

A world's surface is a **list of bands**, each saying what it looks like and how
much of it there is at a site. The renderer blends them by weight. That is what
makes the boundaries organic for free: two bands that both claim a point simply
mix, and the noise inside their masks makes the line where one wins wander
rather than follow a contour.

| World | Materials |
| --- | --- |
| Verdant Valley | deep water · shallow water · river bank · wet grass · grass · dry upland grass · exposed rock |
| Frozen Archipelago | deep ocean · shallows · coastal ice · exposed rock · blue ice · snow · summit snow |
| Volcanic Caldera | lava · scorched · ash · basalt · charcoal · volcanic soil |

None of them is chosen by height alone. The bank is wherever the water is near,
the lush grass is wherever the ground is damp, the rock is wherever the slope is
too steep for anything else to hold, and the snow accumulates where it is high
*and* flat — which is why the peaks go white and their flanks do not.

### Thresholds come from the terrain, not from taste

The first attempt wrote plausible-looking numbers and produced a world that was
one colour. Measuring what the ground actually does is what fixed it. Over a
1,400-unit square of Verdant Valley:

| | p25 | p50 | p90 | p95 |
| --- | --- | --- | --- | --- |
| land height | 12.7 | 16.3 | — | 22.4 |
| slope | 0.014 | 0.015 | **0.050** | — |
| moisture | 0.26 | 0.31 | — | 0.60 |

Against that, the original bands were nonsense in two specific ways. The
altitude range put all the land between 0.74 and 1.01, so the "dry upland"
band — which starts at 0.58 — claimed **71.7%** of the world and gave it the one
pale green it had. And the rock band started at a slope of 0.13 when the 90th
percentile is 0.050, so it existed in the list and **never won anywhere at all**.

| Band | before | after |
| --- | --- | --- |
| dry upland grass | 71.7% | 15.0% |
| grass | 12.6% | 49.0% |
| lush grass | 3.3% | 17.3% |
| water | 11.7% | 13.7% |
| exposed rock | **0%** | 3.0% |
| river bank | 0.7% | 1.8% |

A threshold written against a range the ground does not occupy is not a
threshold.

### Lava had to be made coherent

Flooding everything below a waterline gives hundreds of unconnected red patches
wherever the noise happens to dip: a red camouflage pattern rather than a lava
field. The fix is in the **height function**, not the material — seven channels
are carved radiating from the crater, wandering with radius so they are drainage
rather than spokes, deepest mid-way and closing at the toe. The waterline then
only reaches what they cut, the crater, and the deepest hollows: **95% of the
ground is dry**, against the 75% that produced the scattered patches.

### Two bands that overlap are one band

Charcoal and volcanic soil both spanned the same altitude at first, so they
blended everywhere and six materials came back as a single rust. They split the
low ground on the patch field instead — one takes the high half, the other the
low — and read as two materials because they are no longer in the same places.

## The river

Verdant Valley's river is a drainage system rather than a trough with a flat
plane over it. The pipeline:

```
terrain → downhill route → longitudinal profile → channel → banks → water → flow
```

**Route.** Greedy descent from the highest ground in a source box, stepping
inside a ±70° forward cone — which is what makes a loop impossible, since the
route can turn but never come back on itself. Candidates are scored on height,
on how far they turn, and on how far they stray from an overall bearing; a
low-frequency wander is added afterwards so it meanders rather than running the
fall line.

**Profile.** Water elevation against distance downstream, monotonic *by
construction* rather than checked afterwards: each node takes the lower of a
fixed drop below the previous node and a fixed depth below the local ground. The
first guarantees it always falls; the second stops the surface climbing out of
the ground where the route crosses a rise. Measured: **215 nodes, 4,280 units,
falling 87.7 — a 2.05% gradient, with no uphill step anywhere.**

**Channel.** The bed is the profile less the local depth; terrain is blended
toward it by lateral distance, flat across the bed, then a bank, then eased back
to whatever the ground was doing. That easing is the part that matters — cutting
to a fixed profile and stopping would leave a rim along the whole course.

**Water.** A ribbon along the centreline, not a plane. A plane can only be
level, and this surface is 53 units up at the source and −35 at the outlet;
there is no single elevation that is right for it.

**Flow needs no uniform.** The ribbon is laid out with `v` running downstream, so
scrolling the ripples along `v` *is* scrolling them along the local tangent. A
world-space shader would need the tangent passed per segment and interpolated;
here the geometry already knows, and a bend is handled without being told.

### The terrain had no watershed

The first traced course was 3,380 units long and ended 530 units from its own
source. Greedy descent on flat ground does not descend — it circles. Measured:
mean height across the whole play area ran **16.7 to 26.5**, ten units over three
and a half thousand.

So the terrain gained a regional tilt, about 45 units of fall from the high
north-east to the low south-west. Small enough to be invisible standing on it,
and the reason water goes one way rather than another.

### Three faults the measurements caught

**It braided.** A meander wavelength of ~290 units at a 20-unit step is a turn
radius of about 44 units, so the course met itself: a cross-section taken across
the river came back as bed, briefly ridge, then bed again, ninety units out. The
validator now checks for self-overlap between parts of the course far apart
along it.

**The bank never appeared.** It was measured as lateral distance from the channel
edge, but the carved bank rises gradually — everywhere `shore` was high the
ground was still under several units of water, and by the time it surfaced
`shore` had decayed to zero. It is measured as height above *this node's* water
surface now, which still follows the river downhill rather than ringing a global
elevation.

**Rock won underwater.** The channel wall is steep by construction, so the
exposed-rock band was claiming ground seven units below the surface. It is gated
on depth like the others.

### Validation

`validateRiver.ts` walks the course and checks what the construction is supposed
to guarantee: water never rises downstream, the bed stays below the water, width
stays positive, neighbouring nodes stay a step apart, the source is in the play
area and most of the course with it, and no two distant parts of the course
overlap. All constraints hold, and the river is identical on a second build.

## Scatter## Scatter

Candidates per chunk from a deterministic per-chunk sequence, filtered by bands
on height and slope, then gated by a low-frequency field. The gate is what turns
a scatter into a landscape: without it the survivors are spread evenly over
everything that qualifies, and nothing in nature is evenly spread. With it,
stands have edges and boulder fields have gaps.

Rejection rather than solving for valid ground: asking the environment at a
point is cheap, and a rule that rejects most of its attempts is *how* a band
produces clustering. Trees crowd the flat low ground because that is where the
attempts survive, not because anything clusters them.

Three scales, because a world with only landmarks and trees has a hole exactly
where a viewer spends most of their time looking: landmarks at hundreds of
units, trees and boulders at tens, shrubs and rubble at one to three.

### Props are built, and normalised

A tree is a trunk and two or three foliage tiers merged into one buffer — about
90 triangles, and it reads as a tree at the distance anything here is seen from.
The trunk matters more than it sounds: the gap of ground visible under the
canopy is what stops a stand reading as a row of traffic cones. Five variants:
tall pine, broad pine, broadleaf, young pine, and a dead snag. Boulders are
regular solids with their vertices displaced by a hash of their own position,
split into independent faces first so the result is faceted rather than smoothly
lumpy — which is the difference between stone and a potato.

**Every geometry is normalised to one unit**, and that is why the module exists
separately from the scatter. Before, each geometry carried its own size — a cone
4.2 units tall, a box 5 — and the scatter then multiplied by a scale of up to 7
and a vertical stretch of up to 2.1. Those compose: a pillar could come out at
5 × 7 × 2.1 = **73 units**, taller than the volcano's flank, and the trees threw
the same spikes. Nothing in the rule said so, because the rule only knew about
its own two multipliers. Normalised, a rule's `scale` is the object's height in
world units and a number in a spec means what it says.

Size, lean, rotation and colour all vary per instance, and the two lateral axes
vary independently of each other — a boulder wider than it is deep is what stops
it reading as a sphere.

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

**It runs the same classification as the ground**, so the pale band you can see
from above is the bank you were standing on. It was a height ramp at first,
which quietly disagreed with everything once the bands landed. It is also
3,400 units at 192 samples rather than 4,200 at 128 — 17.7 units a cell against
33, which is the difference between a river with a shape and a smudge.

**It is a separate coarse mesh, not a wider chunk ring.** Seeing the whole
landmark means covering about 3,400 units; at the ring's resolution that is 625
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
| Chunk build, median | 3.9 ms | 4.6 ms | 5.4 ms |
| Chunk build, worst | 6.6 ms | 9.6 ms | 11.0 ms |
| Live chunks, max | 25 | 25 | 25 |
| Scatter instances, max | 4,544 | 2,779 | 7,130 |

Verdant costs about 0.6 ms more per chunk than the others: every vertex asks the
river where it is, twice — once to carve the height and once to classify the
surface.
| Triangles | 204,800 | 204,800 | 204,800 |

Nothing grows. Entering and leaving all three worlds twice returns the canvas
count to zero every time and moves the heap from 42.8 MB to 52.5 MB.

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

**Washed out was two faults pulling together.** The hemisphere fill had been
raised to 1.05 to stop back slopes going black, which worked and then kept
going: enough flat light to erase the modelling entirely. And the fog ran at
0.0017, taking a quarter of the colour out of anything 300 units away, under a
sky the same hue as the grass so the horizon had nothing to read against. Fill
is per world now, the fog is half what it was, and the sky is blue rather than
green.

**A spawn also has to be standing in a clearing.** The composition solvers
scored the landscape and never asked what was growing on it, so the best
position put the camera inside a grove with two trunks filling the frame — trees
cluster by design, which makes that likely rather than unlucky. Searching the
whole world for a clearing instead threw the composition away and returned open
grass with the river out of frame. Composing first and then nudging to the
nearest clear spot keeps both: 32 units of movement, nearest tree 26.

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
