import { Slider } from './Slider'
import {
  BLEND_MODES,
  SHAPING_OPS,
  defaultParamsFor,
  getShapingOp,
  type BlendName,
  type NoiseLayer,
  type ShapingName,
} from './noise'

type LayerPanelProps = {
  layers: NoiseLayer[]
  /** Only one layer is open at a time; the panel is too narrow for more. */
  expandedId: string | null
  maxFrequency: number
  onToggleExpand: (id: string) => void
  onUpdate: (id: string, patch: Partial<NoiseLayer>) => void
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onAdd: () => void
}

export function LayerPanel({
  layers,
  expandedId,
  maxFrequency,
  onToggleExpand,
  onUpdate,
  onRemove,
  onMove,
  onAdd,
}: LayerPanelProps) {
  return (
    <div className="layer-list">
      {/* Rendered top-down so the visual order matches an image editor, while
          the array itself stays bottom-up in compositing order. */}
      {layers
        .map((layer, index) => ({ layer, index }))
        .reverse()
        .map(({ layer, index }) => {
          const expanded = expandedId === layer.id
          const shaping = getShapingOp(layer.shapingName)

          return (
            <div key={layer.id} className={`layer-card${expanded ? ' is-open' : ''}`}>
              <div className="layer-head">
                <input
                  type="checkbox"
                  checked={layer.enabled}
                  aria-label={`Enable ${layer.name}`}
                  onChange={(event) => onUpdate(layer.id, { enabled: event.target.checked })}
                />
                <button
                  type="button"
                  className="layer-title"
                  aria-expanded={expanded}
                  onClick={() => onToggleExpand(layer.id)}
                >
                  <span className="layer-name">{layer.name}</span>
                  <span className="layer-meta">
                    {BLEND_MODES.find((m) => m.value === layer.blendName)?.label} ·{' '}
                    {Math.round(layer.opacity * 100)}% · f{layer.frequency}
                  </span>
                </button>
                <div className="layer-actions">
                  <button
                    type="button"
                    aria-label={`Move ${layer.name} up`}
                    disabled={index === layers.length - 1}
                    onClick={() => onMove(layer.id, 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${layer.name} down`}
                    disabled={index === 0}
                    onClick={() => onMove(layer.id, -1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${layer.name}`}
                    disabled={layers.length === 1}
                    onClick={() => onRemove(layer.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="layer-body">
                  <Slider
                    label="Frequency"
                    value={Math.min(layer.frequency, maxFrequency)}
                    display={String(Math.min(layer.frequency, maxFrequency))}
                    min={2}
                    max={maxFrequency}
                    step={1}
                    onChange={(value) => onUpdate(layer.id, { frequency: value })}
                  />
                  <Slider
                    label="Spread (σ)"
                    value={layer.spread}
                    display={layer.spread.toFixed(3)}
                    min={0.01}
                    max={0.5}
                    step={0.005}
                    onChange={(value) => onUpdate(layer.id, { spread: value })}
                  />

                  <label className="control">
                    <span className="control-label">Blend</span>
                    <select
                      value={layer.blendName}
                      onChange={(event) =>
                        onUpdate(layer.id, { blendName: event.target.value as BlendName })
                      }
                    >
                      {BLEND_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Slider
                    label="Opacity"
                    value={layer.opacity}
                    display={`${Math.round(layer.opacity * 100)}%`}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => onUpdate(layer.id, { opacity: value })}
                  />

                  <label className="control">
                    <span className="control-label">Shaping</span>
                    <select
                      value={layer.shapingName}
                      onChange={(event) => {
                        const name = event.target.value as ShapingName
                        // Parameters are per-operation, so carrying the old set
                        // over would leave stale keys and miss new defaults.
                        onUpdate(layer.id, {
                          shapingName: name,
                          shapingParams: defaultParamsFor(getShapingOp(name)),
                        })
                      }}
                    >
                      {SHAPING_OPS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {shaping.params.map((param) => {
                    const value = layer.shapingParams[param.key] ?? param.defaultValue
                    return (
                      <Slider
                        key={param.key}
                        label={param.label}
                        value={value}
                        display={param.format ? param.format(value) : value.toFixed(2)}
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        onChange={(next) =>
                          onUpdate(layer.id, {
                            shapingParams: { ...layer.shapingParams, [param.key]: next },
                          })
                        }
                      />
                    )
                  })}

                  <button
                    type="button"
                    className="reset-button"
                    onClick={() => onUpdate(layer.id, { seed: layer.seed + 1 })}
                  >
                    Reseed layer
                  </button>
                </div>
              )}
            </div>
          )
        })}

      <button type="button" className="reset-button" onClick={onAdd}>
        + Add layer
      </button>
    </div>
  )
}
