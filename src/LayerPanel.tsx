import { InfoTip } from './InfoTip'
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
    <div className="stack-list">
      {/* Rendered top-down so the visual order matches an image editor, while
          the array itself stays bottom-up in compositing order. */}
      {layers
        .map((layer, index) => ({ layer, index }))
        .reverse()
        .map(({ layer, index }) => {
          const expanded = expandedId === layer.id
          const shaping = getShapingOp(layer.shapingName)

          return (
            <div key={layer.id} className={`stack-card${expanded ? ' is-open' : ''}`}>
              <div className="stack-head">
                <input
                  type="checkbox"
                  checked={layer.enabled}
                  aria-label={`Enable ${layer.name}`}
                  onChange={(event) => onUpdate(layer.id, { enabled: event.target.checked })}
                />
                <button
                  type="button"
                  className="stack-title"
                  aria-expanded={expanded}
                  onClick={() => onToggleExpand(layer.id)}
                >
                  <span className="stack-name">{layer.name}</span>
                  <span className="stack-meta">
                    {BLEND_MODES.find((m) => m.value === layer.blendName)?.label} ·{' '}
                    {Math.round(layer.opacity * 100)}% · f{layer.frequency}
                  </span>
                </button>
                <div className="stack-actions">
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
                <div className="stack-body">
                  <Slider
                    label="Frequency"
                    info={"Lattice cells per side for this layer, interpolated up to the display resolution. A coarse lattice under a fine one is the octave stacking fractal noise is built from; at frequency equal to the resolution it degenerates back to per-cell white noise."}
                    value={Math.min(layer.frequency, maxFrequency)}
                    display={String(Math.min(layer.frequency, maxFrequency))}
                    min={2}
                    max={maxFrequency}
                    step={1}
                    onChange={(value) => onUpdate(layer.id, { frequency: value })}
                  />
                  <Slider
                    label="Spread (σ)"
                    info={"Standard deviation of this layer’s distribution, about a mean of 0.5. Out-of-range samples are clamped rather than rescaled, so a large spread genuinely piles mass onto pure black and white."}
                    value={layer.spread}
                    display={layer.spread.toFixed(3)}
                    min={0.01}
                    max={0.5}
                    step={0.005}
                    onChange={(value) => onUpdate(layer.id, { spread: value })}
                  />

                  <label className="control">
                    <span className="control-label">
                      <InfoTip text={"How this layer combines with everything beneath it. The stack starts from 0 and the bottom layer blends against that like any other, so a bottom layer set to Multiply yields nothing — exactly as it would in an image editor."}>Blend</InfoTip>
                    </span>
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
                    info={"How much of the blend result is kept. Because Normal blend is a lerp rather than a sum, this is also what sets the layer’s weight in the finished field — which is why an fBm stack needs the odd-looking 1, 0.33, 0.14 sequence."}
                    value={layer.opacity}
                    display={`${Math.round(layer.opacity * 100)}%`}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => onUpdate(layer.id, { opacity: value })}
                  />

                  <label className="control">
                    <span className="control-label">
                      <InfoTip text={"A remap applied to this layer alone, before it is blended. Shaping the finished composite instead is what the Output section does."}>Shaping</InfoTip>
                    </span>
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
