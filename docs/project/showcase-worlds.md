# Showcase worlds

Jessica Hsiao · Procedural World Building

Five saved worlds that exist to demonstrate what the four topics can do, how
they are written, and how they are seeded into an account.

## Contents

- [What a world is here](#what-a-world-is-here)
- [The five worlds](#the-five-worlds)
- [That they differ structurally, measured](#that-they-differ-structurally-measured)
- [Seeding, and what is left of it](#seeding-and-what-is-left-of-it)
- [What the topics cannot express](#what-the-topics-cannot-express)
- [Adding one](#adding-one)
- [Notes](#notes)

## What a world is here

Four documents that share a name.

There is no cross-topic world object in this app and this does not add one.
Each topic owns a `ConfigSpec` and writes to `users/{uid}/configs/{configId}`
with its own `topic` field; the library panel on a topic lists only that topic's
documents. A showcase world is therefore exactly what you would get by saving
the same name on each of the four pages by hand, and seeding writes it through
`saveConfiguration` — the same function the Save button calls.

Nothing joins the four at runtime. Loading *Volcanic Inferno* on Maps loads its
map; switching to Voxels and loading the row of the same name loads its solid.

## The five worlds

Each leads with a different **mechanism**, not a different palette. A gallery
whose five entries differ only by colour demonstrates the colour control and
nothing else.

| World | Leads with | Maps | Voxels | Shaders | Objects |
| --- | --- | --- | --- | --- | --- |
| **Volcanic Inferno** | Ridged shaping + thermal collapse | `ridge` on every octave, badlands erosion, 40 thermal passes, `gain` output | terrain ∖ gyroid, marching cubes | combined strategy, **ember** ramp, 12° raking light, haze 0.62 | basalt: rough 0.95, metal 0.05 |
| **Frozen Archipelago** | `threshold` fragmentation + blended CSG | threshold at 0.44 cuts islands, `terrace` steps them, 9 colour bands | four primitives welded with blend radii, **dual contouring** | **Fresnel** strategy alone, chalk ramp, 66° key | ice: rough 0.12, metal 0.82 |
| **Verdant River Valley** | Droplet hydraulic erosion | `valleys` preset at 2.4 droplets/cell, warp 0.35 | terrain ∩ half-space, surface nets | combined, Land ramp, 74° overcast | matte: rough 0.88, metal 0 |
| **Crystal Bloom** | Gyroid CSG + the blocks mesher | `billow` + `terrace` to 9 steps, 9 bands, viridis | gyroid ∩ sphere, **greedy blocks** at 88³ | **reaction–diffusion**, coral preset | wireframe icosahedron |
| **Cloud Planet** | The `planet` geometry mode | field wrapped onto a sphere, single-hue tint | sliced sphere at isolevel 0.12, plain blocks | **boids**, school preset, 48² fish | chrome: rough 0.08, metal 1 |

Between them the five cover all three geometry modes, all four meshers (plus the
greedy variant), four of the eight shaping ops, three of the four erosion
presets, two of the six shading strategies and two of the four GPU simulations.

## That they differ structurally, measured

The brief this was built to says *avoid five worlds that mostly differ by
colour*, so that is checked rather than claimed. Each world's map is generated
through the real pipeline and measured:

| World | Grid | Range | Mean | Roughness | Droplets | Mode |
| --- | --- | --- | --- | --- | --- | --- |
| Volcanic Inferno | 160² | 0.859 | 0.216 | 0.0080 | 23,040 | surface |
| Frozen Archipelago | 144² | 0.835 | 0.809 | 0.0112 | 4,977 | surface |
| Verdant River Valley | 192² | 0.612 | 0.630 | 0.0064 | 88,474 | surface |
| Crystal Bloom | 128² | 1.000 | 0.298 | 0.0185 | 3,277 | surface |
| Cloud Planet | 96² | 0.865 | 0.321 | 0.0154 | 2,765 | planet |

Mean elevation spans 0.216 to 0.809 — Volcanic sits low because ridge shaping
folds every octave down from its midpoint, Frozen sits high because threshold
pushes most of the field to 1. Roughness spans 2.9×, and rain spans 32×.

And the solids:

| World | Grid | Inside | Mesher | Triangles | Vertices |
| --- | --- | --- | --- | --- | --- |
| Volcanic Inferno | 72³ | 22.0% | marching cubes | 123,772 | 371,316 |
| Frozen Archipelago | 80³ | 21.3% | dual contouring | 34,912 | 17,458 |
| Verdant River Valley | 88³ | 28.7% | surface nets | 59,120 | 29,539 |
| Crystal Bloom | 88³ | 3.8% | greedy blocks | 71,910 | 143,820 |
| Cloud Planet | 56³ | 11.9% | blocks | 17,472 | 34,944 |

The vertex columns are the meshers' own signature: marching cubes emits three
vertices per triangle and shares none, dual contouring shares one per cell.

## Seeding, and what is left of it

The twenty documents have been seeded, and the button that wrote them has been
removed — it had done its job, and a control that exists to be pressed once is
clutter in the panel afterwards. What remains is the machinery, in
`src/showcase/`:

```
showcase/
├── worlds.ts     the five presets, built from each topic's own defaults
├── validate.ts   whether a preset is storable and renderable — no Firebase
└── seed.ts       writing them into an account, idempotently
```

Nothing imports these now, so they are absent from every build. They are kept
because they are the record of what was seeded: the saved worlds in the account
are data, and this is the only place that says what produced them. Re-seeding —
a second account, or a reset — means mounting a caller again.

### How it was seeded

`seedShowcaseWorlds(uid)` wrote all twenty documents through
`saveConfiguration`, the same function the Save button calls, as the
authenticated user. Firestore evaluated `ownerUid == uid` and the rest exactly
as it does for a world saved by hand. **No rule was weakened and no admin
credential was involved** — none is needed, because the rules already allow a
user to write their own configs.

It was idempotent per document: a world was skipped on a topic where a document
of that name already existed. Name rather than id, because the id is minted by
Firestore and nothing durable links a document back to the preset it came from —
a marker field would have needed a rules change. The consequence still worth
knowing: rename a seeded world and a future re-seed writes a fresh copy, because
by then nothing says the two were the same thing.

The button was never in a production build. Its guard was `import.meta.env.DEV`,
which Vite resolves to a literal, and the seeder sat behind a dynamic `import()`
so the preset table landed in a chunk of its own. Verified at the time by
searching the production bundle: no preset name, no button label, no seeding
identifier, and a residual cost of 150 bytes raw and 40 gzipped. A static import
left 4.4 KB alive even with the data itself eliminated, which is why the import
was dynamic.

### Validation runs before any write

`validateAll()` checks every world against every topic and the seeder refuses
to write anything if it fails — these are static presets, so a failure is a bug
in the file rather than bad input and would fail the same way every run. Each
document is checked for:

- `name` a non-empty string of at most 120 characters
- `topic` one of the four the rules allow
- `settings` a map, with no `undefined` and no non-finite number anywhere in it
- **and the strong one**: that the topic's own `parse` returns *zero repairs*

The last is what keeps a showcase honest. A repair means the preset asked for
something the renderer does not support and quietly got something else, which
is the one failure mode these must not have. All twenty documents pass, and the
largest is 1,838 bytes — 0.18% of Firestore's limit.

## What the topics cannot express

Three things that a brief for worlds like these naturally asks for, and that
this app has no way to do. They are listed because inventing them would have
produced presets that look right in a table and do nothing on screen.

**Objects cannot scatter.** It is a single-primitive viewer: five shapes and one
material, with no placement system at all. Vegetation that follows a river,
structures on flat ground, density that responds to the terrain — none of it has
anything to drive it. What the Objects document in each world carries is the
material that belongs to it, which is the part of that topic a preset can
honestly demonstrate, and each world's description says so.

**There is no emissive channel.** The material exposes colour, metalness and
roughness. A lava glow is the **Slate — ember** ramp in Shaders, not a lit
object.

**Topic 4's terrain is fixed, by design.** The shading study holds geometry,
light and camera still so the six strategies can be compared against each other.
Shader presets change appearance; none of them changes a landform.

## Adding one

Append an entry to `SHOWCASE_WORLDS`. Each builder spreads the topic's own
`defaults()`, so a new world only states what it changes — and a field added to
a schema later cannot silently go missing from a preset.

Use the `shaping()` helper for any shaping op's parameters rather than writing
`{}`. See the note below for why.

## Notes

**Three parameter names were wrong, and nothing would have told me.**
`threshold` takes `cutoff`, not `level`/`softness`; the `gain` op takes `k`, not
`gain`. `parseParams` rebuilds a bag from the op's own definitions, so an
unrecognised key is dropped silently and a missing one gets its default — no
error, no repair recorded, no visible difference except that the preset does not
do what it says. Found by generating each world's field in a script and looking
at the numbers, not by reading the code.

**`count` on the boids study is an index, not a population.** It selects from
`[16, 32, 48, 64, 96]` texels per side. A literal `1024` clamps to the top of
the range, which is the setting that exists to demonstrate the O(N²) wall rather
than one to sit on. It is 2 — 48², or 2,304 fish and 5.3M neighbour tests a
step.

**Empty shaping parameters are valid but dishonest.** Writing
`shapingParams: {}` stores a document that parses clean, because the parser
fills an op's defaults. But the preset then no longer states what it means, and
anything reading the object outside the parser — including the measurement
script above — hands `undefined` to the shaping function and gets a field of
NaN. Three of the five worlds did this, and the measurement caught it. The
`shaping()` helper fills every parameter from the op's own definition so a
preset is complete on its own terms.

**Topic 2's page was opening on a palette its schema no longer defaulted to.**
`NoisePage` initialised `paletteName` from a literal `'terrain'` while
`defaultNoiseSettings()` had moved to `'land'`, so the page and the saved
contract disagreed about what a new world looks like. Both now read from
`INITIAL`, which is `defaultNoiseSettings()`, so they cannot drift again.
