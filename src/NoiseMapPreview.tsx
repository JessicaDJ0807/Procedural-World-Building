import { useEffect, useRef } from 'react'
import { rampIndex, type Ramp } from './palette'

export type Cell = { x: number; y: number }

type NoiseMapPreviewProps = {
  resolution: number
  /** `resolution²` values in [0, 1] — the surface source, or a slice of the volume. */
  field: Float32Array
  selected: Cell | null
  /** `null` clears the selection. */
  onSelect: (cell: Cell | null) => void
  /** Colour ramp the cell value indexes into. */
  ramp: Ramp
}

const MIN_CELL_PX = 5 // below this, grid lines swamp the cells they divide

export function NoiseMapPreview({
  resolution,
  field,
  selected,
  onSelect,
  ramp,
}: NoiseMapPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = canvas.clientWidth
    if (size <= 0) return

    const dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    // Painted at one device pixel per cell, then blown up with smoothing off —
    // far cheaper than a fillStyle change per cell at high resolutions.
    const tile = document.createElement('canvas')
    tile.width = resolution
    tile.height = resolution
    const tileCtx = tile.getContext('2d')
    if (!tileCtx) return

    // ImageData is sRGB, so it takes the ramp's sRGB side directly.
    const image = tileCtx.createImageData(resolution, resolution)
    for (let i = 0; i < field.length; i++) {
      const value = field[i]
      const o = i * 4
      const c = rampIndex(ramp, value) * 3
      image.data[o] = ramp.srgb[c]
      image.data[o + 1] = ramp.srgb[c + 1]
      image.data[o + 2] = ramp.srgb[c + 2]
      image.data[o + 3] = 255
    }
    tileCtx.putImageData(image, 0, 0)

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tile, 0, 0, size, size)

    const step = size / resolution

    if (step >= MIN_CELL_PX) {
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.beginPath()
      for (let i = 1; i < resolution; i++) {
        const p = Math.round(i * step) + 0.5
        ctx.moveTo(p, 0)
        ctx.lineTo(p, size)
        ctx.moveTo(0, p)
        ctx.lineTo(size, p)
      }
      ctx.stroke()
    }

    if (selected) {
      // Outlined rather than filled so the cell's own value stays visible.
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffb347'
      ctx.strokeRect(
        Math.round(selected.x * step) - 1,
        Math.round(selected.y * step) - 1,
        Math.max(Math.round(step) + 2, 4),
        Math.max(Math.round(step) + 2, 4),
      )
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1)
  }, [resolution, field, selected, ramp])

  // Set on pointerdown and cleared on release. A click that deselects leaves it
  // false, so the pointermove that follows cannot immediately reselect the cell
  // the user just cleared.
  const draggingRef = useRef(false)

  const cellAt = (event: React.PointerEvent<HTMLCanvasElement>): Cell => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * resolution)
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * resolution)
    // A click on the exact right or bottom edge rounds up to resolution.
    return {
      x: Math.min(Math.max(x, 0), resolution - 1),
      y: Math.min(Math.max(y, 0), resolution - 1),
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="map-preview"
      onPointerDown={(event) => {
        const cell = cellAt(event)
        const isSelected = selected?.x === cell.x && selected?.y === cell.y
        onSelect(isSelected ? null : cell)
        draggingRef.current = !isSelected
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || event.buttons !== 1) return
        onSelect(cellAt(event))
      }}
      onPointerUp={() => {
        draggingRef.current = false
      }}
      onPointerLeave={() => {
        draggingRef.current = false
      }}
      onPointerCancel={() => {
        draggingRef.current = false
      }}
    />
  )
}
