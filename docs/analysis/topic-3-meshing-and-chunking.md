# Topic 3 — Voxels: meshing, size, and chunking

Jessica Hsiao · September 2026

[← back to the README](../../README.md) · [study notebook index](../README.md)
· [Topic 3 chapter](../topics/topic-3-voxels.md)

## Contents

- [Alternative meshing techniques](#alternative-meshing-techniques)
- [Limitations of size and performance](#limitations-of-size-and-performance)
- [Why chunking](#why-chunking)

A voxel model here is not a grid of stored blocks — it is a *function*
returning signed distance, negative inside a solid. The grid appears only at
the end, when the function is sampled at `resolution³` points so a **mesher**
can turn those samples into triangles. This report covers that last step: the
alternatives, what they cost, and where the approach stops scaling.

Every figure was measured by running the project's meshers over its own
scenes. Implementation detail is in [topic-3-voxels.md](../topics/topic-3-voxels.md).

## Alternative meshing techniques

Every technique consumes the same samples. They differ on one question:
**where is a vertex allowed to be?**

| Technique | Vertex lives | Sharp features | Vertices per triangle |
| --- | --- | --- | --- |
| Blocks (face-culled) | On the voxel cube | Only the grid's own | 4× |
| Greedy meshing | On the voxel cube | Only the grid's own | fewest |
| Marching cubes | On a grid edge | No | 6× |
| Surface nets | Anywhere in the cell | No | **1×** |
| Dual contouring | Anywhere in the cell | **Yes** | **1×** |

The two extremes of that table, over one field — a box with four spheres
drilled out of it, sampled at 40³:

| Blocks: the vertex is stuck on the cube | Dual contouring: the vertex is solved for |
| --- | --- |
| ![Blocks](../images/topic-3-mesher-blocks.jpg) | ![Dual contouring](../images/topic-3-mesher-dual.jpg) |
| 1,536 triangles · 3,072 vertices | 4,272 triangles · 2,128 vertices |

Blocks emits the fewest triangles of any technique here and still carries the
most vertex data — 2× the vertices for a third of the triangles — because
nothing is shared. The full four-way comparison is in the
[Topic 3 chapter](../topics/topic-3-voxels.md#four-meshers).

**Blocks** emits a cube face only where the neighbouring voxel is empty,
removing 69–96% of them as hidden interior. **Greedy meshing** then merges
coplanar faces into maximal rectangles — 40–73% fewer quads, and lossless:
total surface area matches the unmerged mesh to 1 part in 10¹¹.

**Marching cubes** is the *primal* classic — a 256-case table, vertices
interpolated onto cell edges. Because a vertex can only sit on an edge, a
corner falling between two edges cannot be represented at any resolution.

**Surface nets** is *dual*: one vertex per cell, free to sit anywhere inside
it, at the average of that cell's crossings. No case table, and each vertex is
shared by up to six quads.

**Dual contouring** is surface nets with a better vertex rule — each crossing
carries a tangent plane, and it solves for the point agreeing with all of them.
Averaging lands *between* two planes; solving finds where they *meet*, and that
is an edge.

### Three findings worth recording

**Three techniques emit identical triangle counts.** Blocks, surface nets and
dual contouring agree exactly on every scene, because all three count the same
thing: adjacent sample pairs straddling the surface. They differ only in vertex
sharing, where blocks costs 4× for the same geometry.

**Marching cubes is the most accurate on smooth surfaces and the worst on
sharp ones.** On a sphere it beats surface nets (0.30% against 1.57% of a
cell). On a hard-edged box it cannot form the edge at all.

**Sharpness is not a resolution problem.** Surface nets' error at a box corner
*grows* in relative terms as the grid gets finer; in absolute terms it improves
only 1.84× for a 3× finer grid, where a smooth sphere converges properly. Dual
contouring fixes it with a different rule, not more samples:

| Box corners | Surface nets | Dual contouring |
| --- | --- | --- |
| at 32³ | 14.3% of a cell | **0.7%** |
| at 96³ | 23.8% | **1.2%** |

## Limitations of size and performance

A volume is a cube, so **everything about it grows cubically**. Doubling the
resolution costs eight times the memory and eight times the sampling work.

| Resolution | Samples | Field memory | Sample | Mesh | Total |
| --- | --- | --- | --- | --- | --- |
| 56³ *(default)* | 176k | 0.7 MB | 28 ms | 28 ms | **56 ms** |
| 96³ *(cap)* | 885k | 3.4 MB | 130 ms | 64 ms | 194 ms |
| 128³ | 2.1M | 8 MB | 302 ms | 68 ms | 369 ms |
| 192³ | 7.1M | 27 MB | 1118 ms | 245 ms | **1363 ms** |

**Memory is the hard wall.** Extrapolating the field alone: 256³ is 67 MB,
512³ is 537 MB, 1024³ is 4.3 GB.

**Sampling dominates** — 82% of the time at every resolution, not meshing —
and depends on the shapes in the model: terrain costs 33.5 ms per 64³
evaluation against ~7 ms for a sphere, because every sample runs four octaves
of noise.

**Triangles are not the constraint.** At 192³ the mesh is only 389k triangles,
trivial for a GPU. The interactive limit — roughly 200 ms per edit, so 96³ —
arrives long before any hardware limit.

### Most of a volume is redundant

Only **1.5–11%** of a 64³ volume sits on the boundary; everything else is
uniformly inside or outside and carries no information. That redundancy is what
sparse structures exploit — run-length encoding reaches 34–67× here, and
collapsing uniform 8³ bricks reaches 6–47% of dense. The catch is granularity:
at 32³ bricks every brick contains some surface, nothing collapses, and the
structure costs more than the dense array it replaced.

## Why chunking

The obvious answer — "the volume gets too big" — is true but incomplete. The
sharper reason is **locality**.

Moving one subtracted sphere can only change the field within its own radius
plus one cell — measured, **at most 2.0% of the volume**. The current
implementation re-evaluates **100%** of it, every time. Chunking reclaims that
50× waste: track which chunks an edit's bounding box touches, re-sample only
those.

Four further reasons:

- **Memory** — hold only the chunks near the viewer and evict the rest.
- **Culling** — a chunk is a bounding box, so an off-screen chunk is skipped
  without touching its contents. A single monolithic mesh is all-or-nothing.
- **Level of detail** — distant chunks at lower resolution. Given cubic
  growth, dropping one from 64³ to 32³ is an eightfold saving.
- **Parallelism** — chunks are independent, and sampling is both the dominant
  cost and the part that parallelises cleanly.

**What it costs** is all at the boundaries. Adjacent chunks must agree exactly
on shared samples or their meshes will not line up, so chunks overlap by one
sample. Chunks at different levels of detail do not share sample positions at
all — a harder version of the same problem, and the reason algorithms like
Transvoxel exist.

### Conclusion

At a 96³ cap, chunking would solve a problem this project does not yet have.
Two changes would help at this scale: **incremental re-evaluation** — the 50×
locality win, with no seam problem because the grid stays whole — and **moving
sampling to a Web Worker**, which is the 82%.

Chunking becomes necessary when the world stops fitting in memory or in view,
which is a question about scope rather than about voxels.
