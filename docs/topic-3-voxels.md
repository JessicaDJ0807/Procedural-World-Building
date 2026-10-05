# Topic 3 — Voxels

Terrain and solids built as **density fields** — one scalar function of
position — combined with **constructive solid geometry**, and turned back into
triangles four different ways.

[← back to the README](../README.md)

## The field

Topic 2 built a field by sampling a grid and compositing grids together. This
topic inverts that. A shape here is a *function*:

```ts
type Sdf = (x: number, y: number, z: number) => number
```

It returns a **signed distance** — negative inside the shape, zero on its
surface, positive outside — and the grid is only where you choose to look at
it. That inversion is what makes everything else cheap. A sphere is one line.
Moving a shape is evaluating it at an offset position. And the boolean
operations, which on meshes require clipping polygons and solving for
intersection curves, become:

| Operation | Implementation |
| --- | --- |
| Union | `min(a, b)` |
| Intersection | `max(a, b)` |
| Difference | `max(a, −b)` |

No polygon clipping, no intersection curves, no special case for two shapes
that touch at exactly one point. The intersection curve in **Box minus
sphere** is simply wherever `max(a, −b)` changes sign; nothing computes it.

## Shapes

| Shape | What it is |
| --- | --- |
| **Sphere** | Distance from the centre, less the radius. The simplest exact field there is. |
| **Box** | A rounded box. The rounding is free — see below. |
| **Torus** | Distance to a circle, less the tube radius. Genus 1, with no special-casing. |
| **Cylinder** | A tube intersected with a slab — the same `max` the Intersect operation uses, inlined. |
| **Half-space** | Everything below a height. Useless alone; intersecting with it is how anything gets a flat face. |
| **Gyroid** | A triply periodic minimal surface from one trigonometric expression. Used in 3D printing as infill that is stiff in every direction. |
| **Terrain** | An fBm height field turned solid: density is your height above the ground. |

**Rounding a box is one subtraction.** Subtracting a constant from any
distance field moves its surface outward by that much, and outward motion
rounds convex edges to that radius — because points past a corner are all at
the same distance from it. Offsetting a *mesh* by a fixed distance is a hard
geometry problem with self-intersections to resolve. Here it is `d - r`.

**Terrain is the point of the topic.** A height map cannot express an
overhang: it stores one height per column, so a cave has nowhere to live. As
a density field it is `y − height(x, z)`, which is a solid, and a solid can
have things subtracted from it. That is the whole of the **Caves in terrain**
scene.

### Exact and inexact fields

Five of the seven return true Euclidean distance. Two do not, and it is worth
knowing which, because it changes what **Blend** does. Measured as the
gradient magnitude at 4,000 points near each surface — a true distance field
has `|∇f| = 1` everywhere, since moving one unit toward the surface reduces
the distance by exactly one:

| Shape | mean \|∇f\| | max |
| --- | --- | --- |
| Sphere, Box, Torus, Cylinder, Half-space | **1.000** | 1.00 |
| Gyroid | 1.481 | 1.72 |
| Terrain | **1.701** | 4.47 |

An inexact field still has the right *sign* everywhere, so the shape it carves
is correct and the surface is in the right place. What breaks is anything that
reads the value as a distance. Blend does: it interpolates across a band of
width `k`, and if the field runs 1.7× steep then the band is 1.7× narrower
than the number says. Terrain reaching 4.47 on steep ground means the weld
visibly tightens where the slope is steep — the same setting, a different
result, in different parts of one object. The panel says so when an inexact
shape is in the stack.

## Boolean operations

### Smooth blends

`min` produces a crease where two surfaces meet, because it switches between
them with a discontinuous derivative. The polynomial smooth minimum
interpolates across a band instead:

```ts
h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1)
smin = mix(b, a, h) - k * h * (1 - h)
```

At `k = 0` it degenerates to `min` exactly. **Blended blobs** is three spheres
unioned at `k = 0.3`: with a hard union they read as three balls stuck
together, and with the blend they read as one grown object. The same function
negated (`−smin(−a, −b, k)`) gives the smooth maximum, which is what
Intersect and Subtract use — so a filleted cut is the same code as a welded
join.

### The stack is a fold, not a tree

Each shape combines with **everything beneath it**, the way an image editor's
layers do. The first enabled shape is the base and its operation is skipped,
since there is nothing beneath it to combine with and subtracting from empty
space is reliably empty.

This is a real limitation and a deliberate one. A general CSG tree can express
things a linear stack cannot — `(a ∪ b) ∩ (c ∪ d)` has no left-fold form. But
a tree needs a tree editor, with nesting and drag targets and a much larger
surface to get wrong, and the stack covers everything these scenes are for.

## Sampling

The field is evaluated on a `resolution³` grid over a fixed cube. Cost is
linear in the sample count and therefore cubic in the resolution:

| Resolution | Samples | Sample | Mesh | Triangles |
| --- | --- | --- | --- | --- |
| 32³ | 32,768 | 10 ms | 2 ms | 7,236 |
| **56³** (default) | 175,616 | **41 ms** | 10 ms | 28,644 |
| 64³ | 262,144 | 62 ms | 15 ms | 38,368 |
| 96³ | 884,736 | 205 ms | 45 ms | 90,600 |

Measured on **Caves in terrain**, whose four-octave terrain is the most
expensive shape here. 96³ is deliberately the cap: at a fifth of a second per
evaluation a slider drag stops feeling connected to the thing it moves.

Sampling and meshing are memoised separately, so changing the isolevel or
switching mesher re-meshes the field that already exists rather than
re-evaluating every density function.

### Sealing the volume

A solid that reaches the edge of the sampled cube is left open there: the
mesher has no samples beyond the boundary to close it against. Terrain, which
fills everything below its surface, came out as a floating sheet with no
underside.

The fix is a CSG operation like any other — intersect the whole stack with a
box inset from the domain. It is inset by **two** cells rather than one
because a quad needs all four cells around its edge to exist, and the
outermost layer has neighbours on one side only. Sealing dropped the open
edges on the terrain scene from 435 to 0.

### Isolevel

The isolevel is which value counts as the surface. In a *distance* field the
value is the distance, so offsetting the isolevel offsets the surface by
exactly that much in world units: positive dilates the solid, negative erodes
it. On the inexact shapes it still works, just not to scale.

## Four meshers

"Voxel" means several different things and the difference is the topic. All
four run over the same sampled field; switching between them changes nothing
about the geometry being described, only how it is recovered.

| Mesher | Vertex lives | Sharp features | Vertices for the same triangles |
| --- | --- | --- | --- |
| **Blocks** | On the voxel cube | Only the grid's own | 4× |
| **Marching cubes** | On a grid edge | No | 6× |
| **Surface nets** | Anywhere in the cell | No | **1×** |
| **Dual contouring** | Anywhere in the cell | **Yes** | **1×** |

**Blocks** treats each sample as a solid cube and draws the grid itself. A
face is emitted only where the neighbouring voxel is empty — every interior
face is hidden by definition. The saving is large and depends entirely on the
shape, because it is really a surface-area-to-volume measurement:

| Scene | Faces emitted | Dropped |
| --- | --- | --- |
| Caves in terrain | 14,322 of 328,608 | **95.6%** |
| Sliced torus | 4,184 of 51,696 | 91.9% |
| Blended blobs | 2,802 of 34,158 | 91.8% |
| Box minus sphere | 3,048 of 10,656 | 71.4% |
| Gyroid ball | 11,532 of 37,380 | **69.1%** |

A filled solid is almost all interior and saves nearly everything. A gyroid is
almost all surface and saves the least — which is exactly why it is good
infill.

### Greedy meshing

Face culling throws away everything hidden. What is left is still one quad per
surface voxel — and a flat wall a thousand voxels across is a thousand
coplanar quads describing one rectangle. Greedy meshing sweeps each slice,
grows a run along one axis, then grows that run along the other while every
row still matches:

| Scene | Faces | Merged quads | Fewer |
| --- | --- | --- | --- |
| Caves in terrain | 14,322 | 3,869 | **73.0%** |
| Sliced torus | 4,184 | 1,296 | 69.0% |
| Box minus sphere | 3,048 | 1,056 | 65.4% |
| Blended blobs | 2,802 | 1,246 | 55.5% |
| Gyroid ball | 11,532 | 6,909 | **40.1%** |

It is a flatness measurement, which is why terrain merges away three quarters
of its quads and a gyroid barely a third — the gyroid has almost no flat area.

This one is **lossless**, and that is checkable rather than assertable: total
triangle area after merging matches the unmerged mesh to 1 part in 10¹¹, and
equals `faces × step²` analytically. Same surface, a third of the triangles.

**Surface nets** treats the samples as measurements of a smooth surface
passing between them and reconstructs it: one vertex per cell the surface
crosses, placed at the average of the crossings on that cell's twelve edges.

It is a *dual* method — the vertex floats inside its cell rather than being
pinned to an edge — and it is about sixty lines with no table at all. Checked
against a sphere of known radius, the reconstructed vertices sit this far off
the true surface, as a fraction of one cell:

| Resolution | mean error | max |
| --- | --- | --- |
| 24³ | 4.20% of a cell | 6.34% |
| 48³ | 2.06% | 3.28% |
| 96³ | **1.03%** | 1.67% |

Normals come from the field gradient rather than `computeVertexNormals`: the
gradient of a distance field points directly away from the surface, so it is
cheaper, smoother, and does not depend on the triangle winding being right.

### Dual contouring: the same algorithm, a better vertex

Surface nets and dual contouring are **the same algorithm**. Both put one
vertex in every crossed cell and join four of them into a quad around every
sign-changing grid edge. They share their implementation here, because the
only difference is where inside the cell that vertex goes.

Surface nets averages the crossings. Dual contouring asks a better question:
each crossing has a *tangent plane* — a point and a normal — and the vertex
should be the point that agrees with all of them at once. That is a
least-squares problem, the quadratic error function `Σ (nᵢ·(x − pᵢ))²`, solved
per cell as a 3×3 system.

Averaging can only ever land *between* two planes. Solving finds where they
*meet*, and where two planes meet is an edge. Measured on a box with rounding
0 — a shape with genuinely sharp features:

| Resolution | | Flat faces | Edges | Corners |
| --- | --- | --- | --- | --- |
| 32³ | surface nets | 0.0% | 7.7% | 14.3% |
| | **dual contouring** | 0.0% | **0.3%** | **0.7%** |
| 96³ | surface nets | 0.0% | 12.8% | 23.8% |
| | **dual contouring** | 0.0% | **0.5%** | **1.2%** |

(Error as a percentage of one cell.) Note what surface nets does as resolution
*rises*: relative error gets worse, and in absolute terms the corner improves
only 1.84× for a 3× finer grid. **You cannot sharpen a corner with
resolution.** A smooth sphere, by contrast, converges properly — 4.20% to
1.03% over the same range. Sharpness is a different kind of error, and needs a
different vertex rule rather than more samples.

**The analytic field is doing most of the work.** Dual contouring needs a
normal at each crossing, and most implementations have only the sampled grid
to interpolate one from — an interpolated normal near an edge is the average
of two faces rather than either of them. Here the shapes *are* functions, so
the gradient can be taken at the exact crossing point. At 48³:

| Gradients from | Edge error | Corner error |
| --- | --- | --- |
| the analytic stack | **0.3%** | **0.8%** |
| the sampled grid | 7.1% | 11.5% |

Fourteen times better, from the one thing this page has that a mesh-based
pipeline does not.

Two details keep it stable. The QEF is **regularised toward the centroid**:
on a flat wall every normal is identical, the system is rank 1, and its
minimum is an entire plane of equally good answers — without a nudge the solve
picks an arbitrary one and the surface tears. And the result is **clamped to
its own cell**, so a near-degenerate solve cannot fling a vertex across the
model. A genuine corner sits inside its own cell, so nothing sharp is lost to
the clamp.

The cost is time: dual contouring evaluates the density function six extra
times per crossing. On the terrain scene that is 88 ms against surface nets'
10 ms, because terrain is the expensive shape; on **Box minus sphere** it is
12 ms against 6 ms.

### Marching cubes, and why its table is derived here

The classic primal method, included for contrast rather than because it is
better. Every vertex is pinned onto a grid edge, so a corner that falls
*between* two edges cannot be represented at all.

It is not simply worse. On a smooth sphere marching cubes is the most accurate
of the lot — 0.30% of a cell against surface nets' 1.57% at 64³ — because a
linear crossing on an edge is exactly where a smooth surface passes. What it
buys that accuracy with is vertices: **six per triangle**, sharing none
between cells, against one per cell for the dual methods.

The table is **derived at load rather than transcribed**. On each face of the
cube the surface enters and leaves, so the crossings on a face pair into
segments; the segments chain into closed loops around the cube; each loop is
fan-triangulated. Two independent properties confirm the derivation: it
produces at most **5 triangles per cell**, and exactly **2 of the 256 cases**
are empty — both known properties of marching cubes, neither of them put in by
hand.

#### The hole bug is not inherent to the algorithm

**120 of the 256 cases** contain a face where all four edges cross, so the
corners alternate inside and outside. Its two segments can be drawn two ways —
joining the inside corners or separating them — and both are geometrically
valid. The field does not say which is right. The convention changes the
output in all 120 cases.

Marching cubes is famous for producing holes at exactly these faces. This
implementation does not, under either convention:

| Scene | separate | join |
| --- | --- | --- |
| all five | **0 holes** | **0 holes** |

That surprised me enough to test why. The reason is that the pairing here is
derived from the shared **face**, and two cells meeting at a face see the same
four corner values — so they cannot disagree. The classic bug comes from a
table indexed by the whole *cube*, where two neighbours can resolve their
shared face differently.

Confirmed by deliberately breaking it. Keying the same choice on the cube's
popcount instead of the face:

| Scene | face-derived | cube-derived |
| --- | --- | --- |
| Caves in terrain | 0 holes | **39 holes** |
| Gyroid ball | 0 holes | **192 holes** |

So the holes are an artefact of how the table is indexed, not of marching
cubes itself — which is a much more useful thing to know than "marching cubes
has a hole bug".

### Three of the four emit the same number of triangles

Not approximately — exactly, on every scene. Blocks (unmerged), surface nets
and dual contouring all agree:

| Scene | Triangles | Blocks vertices | Surface vertices | Ratio |
| --- | --- | --- | --- | --- |
| Caves in terrain | 28,644 | 57,288 | 14,272 | 4.01× |
| Box minus sphere | 6,096 | 12,192 | 3,040 | 4.01× |
| Blended blobs | 5,604 | 11,208 | 2,804 | 4.00× |
| Gyroid ball | 23,064 | 46,128 | 11,387 | 4.05× |
| Sliced torus | 8,368 | 16,736 | 4,184 | 4.00× |

This surprised me, and then it was obvious. All three count the same thing:
**adjacent sample pairs that straddle the isolevel.** An exposed block face is
one solid voxel next to one empty voxel. A dual quad is one grid edge whose
ends have opposite signs. Same set, two triangles each, so the counts coincide
— verified by counting those adjacencies directly. Dual contouring matches
surface nets exactly because it changes only where the vertex sits, never
which quads exist.

What differs is where the vertices go. Blocks gives every face its own four
corners, sharing nothing. The dual methods put one vertex per cell and share
it across every quad that touches that cell, which is up to six. Hence the
consistent 4× — the same surface, a quarter of the vertex data.

The two that break the pattern do so for understandable reasons. **Greedy
meshing** merges coplanar faces, so it emits *fewer* triangles for the same
surface — that is the point of it. **Marching cubes** lands within about 0.1%
rather than exactly, because its vertices sit on edges rather than in cells
and the cases where a cell's surface is more than one sheet get triangulated
differently:

| Scene | Marching cubes | Dual methods |
| --- | --- | --- |
| Caves in terrain | 28,636 | 28,644 |
| Box minus sphere | 6,112 | 6,096 |
| Gyroid ball | 23,100 | 23,064 |

Its vertex count is not close to anything: 85,908 against 14,272 on the
terrain scene, six per triangle with no sharing at all.

### Where the dual methods break

One vertex per cell cannot represent two surfaces passing through the same
cell. A wall thinner than a cell, or two sheets meeting at a sharp corner,
forces both to share one vertex and the mesh pinches. This is structural, so
it applies to dual contouring exactly as much as to surface nets — a better
vertex position does not help when the problem is that one position has to
serve two surfaces.

It is worth being precise about the symptom. Counting how many triangles use
each edge, at 56³:

| Scene | Edges | Holes (edges used once) | Non-manifold (used 4×) |
| --- | --- | --- | --- |
| Caves in terrain | 42,915 | **0** | 51 |
| Gyroid ball | 34,518 | **0** | 78 |
| Box minus sphere, Blended blobs, Sliced torus | — | **0** | **0** |

So the mesh is never holed — it is closed everywhere. At a handful of edges it
is *non-manifold*: four triangles meet where two should. That is harmless for
rendering and would matter for 3D printing or for feeding the mesh into
another boolean operation.

It scales with feature size exactly as the explanation predicts. Thinning a
gyroid's walls at a fixed 48³:

| Wall thickness | Non-manifold edges |
| --- | --- |
| 0.20 | 8,904 (8.64%) |
| 0.30 | 1,482 (1.30%) |
| 0.40 | 36 (0.03%) |
| 0.90 | 36 (0.03%) |

Below roughly one cell of wall thickness it degrades sharply; above it, the
defect all but disappears. The fix is *manifold* dual contouring, which
detects these cells and emits more than one vertex in them — a fair subject
for a later topic, and the one remaining known defect in this page's output.

Marching cubes does not have this problem: its vertices live on edges, so a
cell can carry as many sheets as it has crossings. That is the trade the two
families make against each other — dual methods get cheap shared vertices and
sharp features, primal methods get multiple sheets per cell.

## Notes

**Shapes are closures built once per evaluation, not per sample.** A terrain
shape holds its own noise lattices. A 64³ grid asks for 262,144 heights, and
regenerating a PRNG stream for each one would cost more than everything else
on the page put together. `build(params, seed)` runs once and returns a
function that closes over the lattices.

**The noise is Topic 2's, sampled continuously.** Topic 2 generates a lattice
and interpolates it when drawing. A density function cannot use that directly
— it is asked for one point at a time, at coordinates that are not grid
indices — so the lattice is kept and sampled with a wrapping Hermite fade at
arbitrary positions. The PRNG is the same `mulberry32`, so a seed means the
same thing in both topics.

**No mesher imports three.js.** They take a `Float32Array` and return plain
typed arrays. That is what let every number above be produced by a Node script
rather than read off a canvas.

**Surface nets and dual contouring share one implementation.** They differ in
a single branch — how the cell's vertex is placed — and writing them as two
functions would have hidden the only thing worth understanding about the pair.

**The marching cubes table is built at module load, in about eighty lines.**
Transcribing a 256-row table is the usual approach and would have been
faster, but it is also 256 rows of magic numbers that cannot be checked by
reading them. Deriving it means the properties that validate it — 5 triangles
per cell maximum, 2 empty cases, watertight output — are consequences rather
than claims.

**The geometry is replaced on every edit, not written into.** Topic 2's
surface can rewrite attributes in place because its vertex count is fixed by
the resolution alone. Here the vertex count changes with every parameter, so
there is nothing stable to write into.

**A carved solid renders double-sided.** Subtraction exposes inward-facing
surfaces, and culling back faces would let you see straight through a cavity
into the far wall.

**A hemisphere light was tried and reverted.** The theory was that subtracted
cavities need fill from below, since the dark openings in **Box minus sphere**
looked unlit. They were not unlit — the subtracted sphere is larger than the
box, so those openings are the background seen straight through the solid.
The hemisphere light fixed nothing and washed the palette out, so the flat
ambient from Topic 2 stayed.

**A sampled volume fraction converges to the analytic one, once compared
against the right volume.** Checking the sphere's inside-fraction against
`(2·DOMAIN)³` showed a stubborn −4.7% error at 64³ that looked like a sampling
bias. It was the comparison: `R` sample points tile `(R·step)³`, not
`(2·DOMAIN)³`, and the two differ by `(R/(R−1))³`. Against the volume the
samples actually cover, the error is **−0.12% at 64³**.
