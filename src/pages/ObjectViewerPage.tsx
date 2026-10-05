import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { RotationGizmo } from '../RotationGizmo'
import { SceneCanvas } from '../SceneCanvas'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { Workspace } from '../Workspace'
import { defaultObjectSettings, objectSpec, type ObjectSettings } from '../config/objectConfig'
import { SHAPES, type ShapeName } from '../shapes'

const INITIAL = defaultObjectSettings()

export function ObjectViewerPage() {
  const [shape, setShape] = useState<ShapeName>(INITIAL.shape)
  const [spinSpeed, setSpinSpeed] = useState(INITIAL.spinSpeed)
  const [scale, setScale] = useState(INITIAL.scale)
  const [color, setColor] = useState(INITIAL.color)
  const [metalness, setMetalness] = useState(INITIAL.metalness)
  const [roughness, setRoughness] = useState(INITIAL.roughness)
  const [wireframe, setWireframe] = useState(INITIAL.wireframe)

  // Held in a ref, not state: the gizmo mutates it every pointermove and both
  // render loops read it per frame, which is far too hot for a React round trip.
  const rotationRef = useRef(new THREE.Quaternion())

  const settings = useMemo<ObjectSettings>(
    () => ({ shape, spinSpeed, scale, color, metalness, roughness, wireframe }),
    [shape, spinSpeed, scale, color, metalness, roughness, wireframe],
  )

  const applySettings = (next: ObjectSettings) => {
    setShape(next.shape)
    setSpinSpeed(next.spinSpeed)
    setScale(next.scale)
    setColor(next.color)
    setMetalness(next.metalness)
    setRoughness(next.roughness)
    setWireframe(next.wireframe)
  }

  return (
    <Workspace
      topic="objects"
      library={<ConfigPanel spec={objectSpec} settings={settings} onLoad={applySettings} />}
      view={
        <ViewControls>
          <Slider
            label="Spin"
            info="Turns the object about its vertical axis, in degrees per second. A viewing aid: it does not change the object, only how much of it you see without dragging."
            value={spinSpeed}
            display={spinSpeed === 0 ? 'off' : `${spinSpeed}°/s`}
            min={0}
            max={180}
            step={1}
            onChange={setSpinSpeed}
          />

          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="Draws the triangles the geometry is actually made of. It is a material flag rather than a viewport setting, but it is here because it answers how you are looking at the shape, not what the shape is.">
                Wireframe
              </InfoTip>
            </span>
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(event) => setWireframe(event.target.checked)}
            />
          </label>
        </ViewControls>
      }
      inspector={
        <aside className="control-sidebar" aria-label="Scene controls">
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

        <p className="hint">Drag the canvas to orbit the view.</p>
        </aside>
      }
    >
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
    </Workspace>
  )
}
