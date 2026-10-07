import { useEffect, useRef } from 'react'
import { rampIndex, type Ramp } from '../palette'

/** WATER_COLOUR in NoiseViewport, so the map and the terrain agree on what is sea. */
const WATER_RGB: [number, number, number] = [0x3d, 0x6f, 0x8f]
const WATER_MIX = 0.72

type LabMapProps = {
  resolution: number
  field: Float32Array
  ramp: Ramp
  seaLevel: number
  /** The row the profile below is cut along. */
  row: number
  onRow: (row: number) => void
}

/**
 * The field as a picture: one pixel per sample, coloured by the same ramp the
 * terrain uses. Clicking or dragging picks the row the profile is cut along —
 * the line is the bridge between "a value per pixel" and "a height per point".
 */
export function LabMap({ resolution, field, ramp, seaLevel, row, onRow }: LabMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Painted once per field into an offscreen tile; moving the row line only
  // redraws the scaled copy.
  const tileRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const r = resolution
    const tile = tileRef.current ?? document.createElement('canvas')
    tileRef.current = tile
    tile.width = r
    tile.height = r
    const ctx = tile.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(r, r)
    for (let i = 0; i < field.length; i++) {
      const value = field[i]
      const c = rampIndex(ramp, value) * 3
      let red = ramp.srgb[c]
      let green = ramp.srgb[c + 1]
      let blue = ramp.srgb[c + 2]
      if (seaLevel > 0 && value < seaLevel) {
        red += (WATER_RGB[0] - red) * WATER_MIX
        green += (WATER_RGB[1] - green) * WATER_MIX
        blue += (WATER_RGB[2] - blue) * WATER_MIX
      }
      const o = i * 4
      image.data[o] = red
      image.data[o + 1] = green
      image.data[o + 2] = blue
      image.data[o + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  }, [resolution, field, ramp, seaLevel])

  useEffect(() => {
    const canvas = canvasRef.current
    const tile = tileRef.current
    if (!canvas || !tile) return
    const ctx = canvas.getContext('2d')
    const size = canvas.clientWidth
    if (!ctx || size <= 0) return
    const dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tile, 0, 0, size, size)

    const y = ((row + 0.5) / resolution) * size
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.95)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  })

  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * resolution)
    onRow(Math.min(resolution - 1, Math.max(0, y)))
  }

  return (
    <canvas
      ref={canvasRef}
      className="lab-map"
      aria-label="Noise map. Click or drag to choose the row the profile is cut along."
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) pick(event)
      }}
    />
  )
}
