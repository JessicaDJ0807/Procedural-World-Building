import { InfoTip } from './InfoTip'
import { Slider } from './Slider'
import {
  CSG_OPS,
  SHAPES,
  defaultParamsFor,
  getShape,
  type CsgNode,
  type CsgOpName,
  type ShapeName,
} from './density'

type CsgPanelProps = {
  nodes: CsgNode[]
  /** Only one node is open at a time; the panel is too narrow for more. */
  expandedId: string | null
  /** The first enabled node, whose operation has nothing to combine with. */
  baseId: string | null
  onToggleExpand: (id: string) => void
  onUpdate: (id: string, patch: Partial<CsgNode>) => void
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onAdd: () => void
}

const OFFSET_AXES = [
  { key: 'x' as const, label: 'Offset X' },
  { key: 'y' as const, label: 'Offset Y' },
  { key: 'z' as const, label: 'Offset Z' },
]

export function CsgPanel({
  nodes,
  expandedId,
  baseId,
  onToggleExpand,
  onUpdate,
  onRemove,
  onMove,
  onAdd,
}: CsgPanelProps) {
  return (
    <div className="stack-list">
      {/* Rendered top-down so the newest operation reads first, while the array
          stays in evaluation order — the same inversion the layer stack uses. */}
      {nodes
        .map((node, index) => ({ node, index }))
        .reverse()
        .map(({ node, index }) => {
          const expanded = expandedId === node.id
          const shape = getShape(node.shape)
          const isBase = node.id === baseId

          return (
            <div key={node.id} className={`stack-card${expanded ? ' is-open' : ''}`}>
              <div className="stack-head">
                <input
                  type="checkbox"
                  checked={node.enabled}
                  aria-label={`Enable ${shape.label}`}
                  onChange={(event) => onUpdate(node.id, { enabled: event.target.checked })}
                />
                <button
                  type="button"
                  className="stack-title"
                  aria-expanded={expanded}
                  onClick={() => onToggleExpand(node.id)}
                >
                  <span className="stack-name">{shape.label}</span>
                  <span className="stack-meta">
                    {isBase
                      ? 'base'
                      : `${CSG_OPS.find((o) => o.value === node.op)?.label}${
                          node.blend > 0 ? ` · blend ${node.blend.toFixed(2)}` : ''
                        }`}
                  </span>
                </button>
                <div className="stack-actions">
                  <button
                    type="button"
                    aria-label={`Move ${shape.label} earlier`}
                    disabled={index === 0}
                    onClick={() => onMove(node.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${shape.label} later`}
                    disabled={index === nodes.length - 1}
                    onClick={() => onMove(node.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${shape.label}`}
                    disabled={nodes.length === 1}
                    onClick={() => onRemove(node.id)}
                  >
                    ×
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="stack-body">
                  <label className="control">
                    <span className="control-label">
                      <InfoTip text={shape.hint}>Shape</InfoTip>
                    </span>
                    <select
                      value={node.shape}
                      onChange={(event) => {
                        const next = getShape(event.target.value as ShapeName)
                        // Parameters are per-shape, so carrying the old ones
                        // across would leave a torus configured like a box.
                        onUpdate(node.id, { shape: next.value, params: defaultParamsFor(next) })
                      }}
                    >
                      {SHAPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {isBase ? (
                    <p className="hint">
                      The first enabled shape is the{' '}
                      <InfoTip text="Every operation combines this shape with everything beneath it in the stack. The bottom one has nothing beneath it, so its operation is skipped — subtracting from empty space would just give empty space.">
                        base
                      </InfoTip>
                      . Its operation is skipped.
                    </p>
                  ) : (
                    <>
                      <label className="control">
                        <span className="control-label">
                          <InfoTip
                            text={`How this shape combines with everything beneath it. ${
                              CSG_OPS.find((o) => o.value === node.op)?.hint ?? ''
                            }`}
                          >
                            Operation
                          </InfoTip>
                        </span>
                        <select
                          value={node.op}
                          onChange={(event) =>
                            onUpdate(node.id, { op: event.target.value as CsgOpName })
                          }
                        >
                          {CSG_OPS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <Slider
                        label="Blend"
                        info="Width of the band over which the two surfaces merge instead of meeting at a crease. 0 is a hard boolean. Blending assumes both fields measure true distance — on a Gyroid or Terrain base the same setting produces a visibly narrower weld, because those fields run steeper than 1."
                        value={node.blend}
                        display={node.blend === 0 ? 'hard' : node.blend.toFixed(2)}
                        min={0}
                        max={0.5}
                        step={0.01}
                        onChange={(value) => onUpdate(node.id, { blend: value })}
                      />
                    </>
                  )}

                  {shape.params.map((param) => (
                    <Slider
                      key={param.key}
                      label={param.label}
                      info={param.info}
                      value={node.params[param.key] ?? param.defaultValue}
                      display={
                        param.format
                          ? param.format(node.params[param.key] ?? param.defaultValue)
                          : (node.params[param.key] ?? param.defaultValue).toFixed(2)
                      }
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      onChange={(value) =>
                        onUpdate(node.id, { params: { ...node.params, [param.key]: value } })
                      }
                    />
                  ))}

                  {OFFSET_AXES.map((axis) => (
                    <Slider
                      key={axis.key}
                      label={axis.label}
                      info="Moves this shape before it is combined. The function is evaluated at the offset position, which is how a shape is transformed without touching any geometry."
                      value={node.offset[axis.key]}
                      display={node.offset[axis.key].toFixed(2)}
                      min={-1.2}
                      max={1.2}
                      step={0.01}
                      onChange={(value) =>
                        onUpdate(node.id, { offset: { ...node.offset, [axis.key]: value } })
                      }
                    />
                  ))}

                  {node.shape === 'terrain' && (
                    <button
                      type="button"
                      className="reset-button"
                      onClick={() => onUpdate(node.id, { seed: node.seed + 1 })}
                    >
                      New ground
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

      <button type="button" className="reset-button" onClick={onAdd}>
        + Add shape
      </button>
    </div>
  )
}
