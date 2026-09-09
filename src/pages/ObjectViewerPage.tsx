import { useRef, useState } from 'react'
import * as THREE from 'three'
import { RotationGizmo } from '../RotationGizmo'
import { SceneCanvas } from '../SceneCanvas'
import { Slider } from '../Slider'
import { SHAPES, type ShapeName } from '../shapes'

export function ObjectViewerPage() {
  const [shape, setShape] = useState<ShapeName>('box')
  const [spinSpeed, setSpinSpeed] = useState(0)
  const [scale, setScale] = useState(1)
  const [color, setColor] = useState('#6ea8fe')
  const [metalness, setMetalness] = useState(0.2)
  const [roughness, setRoughness] = useState(0.35)
  const [wireframe, setWireframe] = useState(false)

  // Held in a ref, not state: the gizmo mutates it every pointermove and both
  // render loops read it per frame, which is far too hot for a React round trip.
  const rotationRef = useRef(new THREE.Quaternion())

  return (
    <div className="viewer-page">
      <SceneCanvas
        shape={shape}
        rotationRef={rotationRef}
        spinSpeed={spinSpeed}
        scale={scale}
        color={color}
        metalness={metalness}
        roughness={roughness}
        wireframe={wireframe}
      />
      <aside className="control-widget" aria-label="Scene controls">
        <h2>Scene</h2>

        <label className="control">
          <span className="control-label">Shape</span>
          <select value={shape} onChange={(event) => setShape(event.target.value as ShapeName)}>
            {SHAPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <h3 className="control-group">Orientation</h3>

        <RotationGizmo rotationRef={rotationRef} />
        <button
          type="button"
          className="reset-button"
          onClick={() => rotationRef.current.identity()}
        >
          Reset orientation
        </button>

        <h3 className="control-group">Transform</h3>

        <Slider
          label="Spin"
          value={spinSpeed}
          display={spinSpeed === 0 ? 'off' : `${spinSpeed}°/s`}
          min={0}
          max={180}
          step={1}
          onChange={setSpinSpeed}
        />
        <Slider
          label="Scale"
          value={scale}
          display={scale.toFixed(2)}
          min={0.2}
          max={3}
          step={0.01}
          onChange={setScale}
        />

        <h3 className="control-group">Material</h3>

        <label className="control">
          <span className="control-label">
            Color
            <span className="control-value">{color}</span>
          </span>
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <Slider
          label="Metalness"
          value={metalness}
          display={metalness.toFixed(2)}
          min={0}
          max={1}
          step={0.01}
          onChange={setMetalness}
        />
        <Slider
          label="Roughness"
          value={roughness}
          display={roughness.toFixed(2)}
          min={0}
          max={1}
          step={0.01}
          onChange={setRoughness}
        />
        <label className="control control-toggle">
          <span className="control-label">Wireframe</span>
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(event) => setWireframe(event.target.checked)}
          />
        </label>

        <p className="hint">Drag the canvas to orbit the view.</p>
      </aside>
    </div>
  )
}
