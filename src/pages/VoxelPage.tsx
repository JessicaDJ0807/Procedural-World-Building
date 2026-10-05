import { useMemo, useState } from 'react'
import { CsgPanel } from '../CsgPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { VoxelViewport } from '../VoxelViewport'
import {
  SCENES,
  buildStack,
  defaultParamsFor,
  getScene,
  getShape,
  sampleVolume,
  sealExtent,
  type CsgNode,
  type SceneNode,
} from '../density'
import {
  meshBlocks,
  meshDualContouring,
  meshGreedyBlocks,
  meshMarchingCubes,
  meshSurfaceNets,
  marchingTableStats,
  type BlockStats,
  type Mesh,
} from '../mesher'
import { CONTINUOUS, PALETTES, buildLut, type PaletteName } from '../palette'
import { ACCENT_BLUE } from '../theme'

type RenderMode = 'surface' | 'dual' | 'marching' | 'blocks'

type MeshResult = Mesh & { blocks?: BlockStats & { quads?: number } }

const TABLE = marchingTableStats()

const RENDER_MODES: { value: RenderMode; label: string; hint: string }[] = [
  {
    value: 'surface',
    label: 'Surface',
    hint: 'Surface nets: the samples are treated as measurements of a smooth surface passing between them, and that surface is reconstructed. One vertex per cell the surface crosses, placed where the crossings say it should be.',
  },
  {
    value: 'dual',
    label: 'Dual contouring',
    hint: 'Surface nets with a better vertex rule: instead of averaging the crossings, it solves for the point that agrees with the tangent plane at every one of them. That is what lets it reconstruct a sharp edge — measured on a hard-edged box, corner error drops from 23.8% of a cell to 1.2%.',
  },
  {
    value: 'marching',
    label: 'Marching cubes',
    hint: `The classic primal method: vertices are pinned onto grid edges, so a corner between two edges cannot be represented at all. More accurate than surface nets on smooth surfaces and far worse on sharp ones, and it needs a ${TABLE.ambiguousCases}-of-256 ambiguous case table — derived here rather than transcribed.`,
  },
  {
    value: 'blocks',
    label: 'Blocks',
    hint: 'One cube per sample below the isolevel, with interior faces dropped. This draws the grid itself rather than the shape — the staircase is not an artefact to be fixed, it is what the data literally is.',
  },
]

const DEFAULT_RESOLUTION = 56
const MAX_RESOLUTION = 96

let nextId = 0
const withIds = (nodes: SceneNode[]): CsgNode[] =>
  nodes.map((node) => ({ ...node, id: `node-${nextId++}` }))

export function VoxelPage() {
  const [sceneName, setSceneName] = useState(SCENES[0].value)
  const [nodes, setNodes] = useState<CsgNode[]>(() => withIds(SCENES[0].nodes))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [mode, setMode] = useState<RenderMode>('surface')
  const [greedy, setGreedy] = useState(true)
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION)
  const [iso, setIso] = useState(0)
  const [spin, setSpin] = useState(0)
  const [showBounds, setShowBounds] = useState(true)
  const [palette, setPalette] = useState<PaletteName>('terrain')

  // Sampling and meshing are memoised apart, so changing the isolevel or the
  // render mode re-meshes the field it already has instead of re-evaluating
  // every density function.
  const volume = useMemo(() => sampleVolume(nodes, resolution), [nodes, resolution])

  const mesh = useMemo<MeshResult>(() => {
    if (mode === 'blocks') {
      const { stats, ...rest } = greedy
        ? meshGreedyBlocks(volume.field, resolution, iso)
        : meshBlocks(volume.field, resolution, iso)
      return { ...rest, blocks: stats }
    }
    if (mode === 'marching') return meshMarchingCubes(volume.field, resolution, iso)
    if (mode === 'dual') {
      // The analytic stack, so the gradients come from the real surface rather
      // than from the sampled grid — worth 14x on corner accuracy, measured.
      return meshDualContouring(
        volume.field,
        resolution,
        iso,
        buildStack(nodes, sealExtent(resolution)),
      )
    }
    return meshSurfaceNets(volume.field, resolution, iso)
  }, [volume, resolution, iso, mode, greedy, nodes])

  // Fitted to the geometry's own vertical extent, for the reason Topic 2's
  // ramp is: against a fixed domain most of the palette would go unused.
  const ramp = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i]
      if (y < min) min = y
      if (y > max) max = y
    }
    const lut = buildLut(palette, ACCENT_BLUE, CONTINUOUS)
    if (!Number.isFinite(min) || max <= min) return { ...lut, min: 0, span: 1 }
    return { ...lut, min, span: max - min }
  }, [mesh, palette])

  const baseId = nodes.find((node) => node.enabled)?.id ?? null

  const loadScene = (value: string) => {
    setSceneName(value)
    setNodes(withIds(getScene(value).nodes))
    setExpandedId(null)
  }

  const updateNode = (id: string, patch: Partial<CsgNode>) =>
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, ...patch } : node)))

  const removeNode = (id: string) =>
    setNodes((current) => (current.length === 1 ? current : current.filter((n) => n.id !== id)))

  const moveNode = (id: string, direction: -1 | 1) =>
    setNodes((current) => {
      const index = current.findIndex((node) => node.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const addNode = () => {
    const shape = getShape('sphere')
    const node: CsgNode = {
      id: `node-${nextId++}`,
      shape: shape.value,
      params: defaultParamsFor(shape),
      op: 'subtract',
      blend: 0,
      offset: { x: 0, y: 0, z: 0 },
      seed: 1,
      enabled: true,
    }
    setNodes((current) => [...current, node])
    setExpandedId(node.id)
  }

  const scene = getScene(sceneName)
  const shapesInUse = new Set(nodes.filter((n) => n.enabled).map((n) => n.shape))
  const anyInexact = [...shapesInUse].some((name) => !getShape(name).exact)

  return (
    <div className="voxel-page">
      <VoxelViewport mesh={mesh} ramp={ramp} spin={spin} showBounds={showBounds} />

      <aside className="control-sidebar" aria-label="Voxel controls">
        <h3 className="control-group">
          <InfoTip text="Everything on this page is one scalar function of position, sampled onto a grid. These controls decide how finely it is sampled and how the samples are turned back into a surface.">
            Field
          </InfoTip>
        </h3>

        <label className="control">
          <span className="control-label">
            <InfoTip text={`A starting point to take apart. ${scene.hint}`}>Scene</InfoTip>
          </span>
          <select value={sceneName} onChange={(event) => loadScene(event.target.value)}>
            {SCENES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="control-label">
            <InfoTip
              text={`How the sampled field becomes triangles. ${
                RENDER_MODES.find((m) => m.value === mode)?.hint ?? ''
              }`}
            >
              Mesher
            </InfoTip>
          </span>
          <select value={mode} onChange={(event) => setMode(event.target.value as RenderMode)}>
            {RENDER_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <Slider
          label="Resolution"
          info="Samples per side. The cost is the cube of this — every step up multiplies the work by about 1.5× — and it is also the only thing standing between Blocks and Surface looking the same, since a fine enough grid makes the staircase smaller than a pixel."
          value={resolution}
          display={`${resolution}³`}
          min={8}
          max={MAX_RESOLUTION}
          step={1}
          onChange={setResolution}
        />

        <Slider
          label="Isolevel"
          info="The value counted as the surface. 0 is the shape as defined; a positive value offsets it outward and a negative one erodes it inward, because in a distance field the value IS the distance to move."
          value={iso}
          display={iso === 0 ? 'surface (0)' : iso.toFixed(2)}
          min={-0.3}
          max={0.3}
          step={0.005}
          onChange={setIso}
        />

        <p className="readout">
          <strong>{mesh.triangles.toLocaleString()}</strong> triangles ·{' '}
          <InfoTip text="The dual methods put one vertex in each cell and share it across every quad that touches it, so they carry about a quarter of the vertex data of Blocks and a sixth of Marching cubes — for the same triangles. Marching cubes does not share vertices between cells at all here.">
            <strong>{mesh.vertices.toLocaleString()}</strong> vertices
          </InfoTip>
          <br />
          <strong>{(volume.stats.inside * 100).toFixed(1)}%</strong> of the grid inside · sampled in{' '}
          <strong>{volume.stats.ms.toFixed(0)} ms</strong>, meshed in{' '}
          <strong>{mesh.ms.toFixed(0)} ms</strong>
          {mesh.blocks && mesh.blocks.naiveFaces > 0 && (
            <>
              <br />
              <InfoTip text="Faces emitted against the six-per-voxel a mesher that ignored its neighbours would produce. Every dropped face was sealed inside the solid, so nothing visible is lost. The saving depends entirely on the shape: a filled solid is almost all interior, while a thin shell is almost all surface.">
                interior faces dropped
              </InfoTip>
              : <strong>{((1 - mesh.blocks.faces / mesh.blocks.naiveFaces) * 100).toFixed(1)}%</strong>
              {mesh.blocks.quads !== undefined && (
                <>
                  , then{' '}
                  <InfoTip text="Coplanar faces merged into the largest rectangles that tile them. This is a flatness measurement: a terrain slab merges away most of its quads, a gyroid barely any, because the gyroid has almost no flat area to merge.">
                    merged
                  </InfoTip>{' '}
                  <strong>
                    {(((mesh.blocks.faces - mesh.blocks.quads) / mesh.blocks.faces) * 100).toFixed(1)}%
                  </strong>{' '}
                  ({mesh.blocks.quads.toLocaleString()} quads from{' '}
                  {mesh.blocks.faces.toLocaleString()})
                </>
              )}
            </>
          )}
        </p>

        {mode === 'blocks' && (
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="Greedy meshing: sweep each slice, grow a run of exposed faces along one axis, then grow that run along the other while every row still matches. The classic voxel-engine optimisation, and purely a win — the surface drawn is identical, there is just less of it to describe.">
                Merge coplanar faces
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={greedy}
              onChange={(event) => setGreedy(event.target.checked)}
            />
          </label>
        )}

        {mesh.triangles === 0 && (
          <p className="hint">
            Nothing to draw — the field never crosses the isolevel. Either every sample is
            inside the solid or every sample is outside it.
          </p>
        )}

        <h3 className="control-group">
          <InfoTip text="A stack of shapes combined by boolean operations. Each entry combines with everything beneath it, so the order is the expression: this is a left fold, not a general tree.">
            Shapes
          </InfoTip>
        </h3>

        <CsgPanel
          nodes={nodes}
          expandedId={expandedId}
          baseId={baseId}
          onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
          onUpdate={updateNode}
          onRemove={removeNode}
          onMove={moveNode}
          onAdd={addNode}
        />

        {anyInexact && (
          <p className="hint">
            This stack includes a{' '}
            <InfoTip text="Sphere, Box, Torus, Cylinder and Half-space return true Euclidean distance — measured, their gradient is 1.000 everywhere. Gyroid runs at about 1.5 and Terrain at 1.7, rising past 4 on steep ground. The sign is still right everywhere, so the shape is correct; it is Blend that is affected, because it assumes a value of 0.1 means the same distance in both fields.">
              shape whose field is not a true distance
            </InfoTip>
            , so Blend will bite less than the number suggests.
          </p>
        )}

        <h3 className="control-group">
          <InfoTip text="Presentation only. None of this changes the field or the mesh.">
            Display
          </InfoTip>
        </h3>

        <label className="control">
          <span className="control-label">
            <InfoTip text="Colours the solid by height, since on the finished surface the density is zero everywhere by construction — position is the only signal left in the geometry.">
              Palette
            </InfoTip>
          </span>
          <select
            value={palette}
            onChange={(event) => setPalette(event.target.value as PaletteName)}
          >
            {PALETTES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <Slider
          label="Spin"
          info="Turns the solid about its vertical axis, in degrees per second. Worth using here: a cavity and a bump can look identical in a still frame and never do once the shading moves."
          value={spin}
          display={spin === 0 ? 'off' : `${spin}°/s`}
          min={0}
          max={90}
          step={1}
          onChange={setSpin}
        />

        <label className="control control-toggle">
          <span className="control-label">
            <InfoTip text="The cube the field is sampled inside. Anything outside it is never evaluated, which is why a shape larger than the box comes out with flat sides where the box clipped it.">
              Sampling bounds
            </InfoTip>
          </span>
          <input
            type="checkbox"
            checked={showBounds}
            onChange={(event) => setShowBounds(event.target.checked)}
          />
        </label>

        <p className="hint">Drag to orbit, scroll to zoom, right-drag to pan.</p>
      </aside>
    </div>
  )
}
