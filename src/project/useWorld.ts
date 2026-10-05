import { useDeferredValue, useMemo } from 'react'
import type { Mesh } from '../mesher'
import { CONTINUOUS, buildLut, fieldDomain, type Ramp } from '../palette'
import { ACCENT_BLUE } from '../theme'
import { generate, meshCaves, type GenerationInputs, type World, type WorldSettings } from './world'

export type WorldView = {
  world: World
  ramp: Ramp
  /** Only built for the caves view; `null` on the surface. */
  mesh: Mesh | null
  /** True while the terrain on screen is behind the controls. */
  stale: boolean
}

/**
 * Generate the world, off the interaction path.
 *
 * ## Why the generation inputs are separated out
 *
 * Not tidiness — correctness of the controls' own claims. Relief is applied
 * when the geometry is built and palette only picks a lookup table, so neither
 * one changes a single cell of the field. Keying the memo on the whole settings
 * object would have regenerated the terrain for both of them anyway, which
 * would make Relief the most expensive control on the page while its own
 * tooltip calls it the cheapest. The subset below is rebuilt only when one of
 * the seven fields that matter moves, so its identity is stable across a relief
 * drag and the memo holds.
 *
 * ## Why it is deferred
 *
 * Droplet erosion costs around 50 ms at 128² and the cave pass samples a full
 * cube, so generating inside the render a slider's `onChange` triggers would
 * drop frames for the whole drag — the thumb would stick while the terrain
 * caught up. `useDeferredValue` lets the controls commit at full rate and
 * re-runs generation at low priority, so the sliders stay smooth and the
 * terrain follows a beat behind.
 *
 * Comparing the deferred subset against the live one is what `stale` reports.
 * React will not say whether a deferred pass is still outstanding, and the
 * alternative — showing nothing — makes a slow regeneration look like a control
 * that does not work.
 */
export function useWorld(settings: WorldSettings): WorldView {
  const inputs = useMemo<GenerationInputs>(
    () => ({
      resolution: settings.resolution,
      ruggedness: settings.ruggedness,
      landmass: settings.landmass,
      meander: settings.meander,
      weathering: settings.weathering,
      slopeCollapse: settings.slopeCollapse,
      seaLevel: settings.seaLevel,
    }),
    [
      settings.resolution,
      settings.ruggedness,
      settings.landmass,
      settings.meander,
      settings.weathering,
      settings.slopeCollapse,
      settings.seaLevel,
    ],
  )

  const deferred = useDeferredValue(inputs)

  const world = useMemo(() => generate(deferred), [deferred])

  // The view itself is not deferred: switching to Caves is one click and one
  // mesh build, and deferring it would show the surface for a beat first, which
  // reads as the button having missed. Only the dial that drags is deferred.
  const caveDensity = useDeferredValue(settings.caveDensity)

  const mesh = useMemo(
    () => (settings.view === 'caves' ? meshCaves(world, caveDensity) : null),
    [settings.view, caveDensity, world],
  )

  /**
   * Fitted to whatever the view actually colours — and the two views do not
   * colour the same quantity.
   *
   * `NoiseViewport` indexes the ramp by the field's value, which lives in
   * roughly [0, 1]. `VoxelViewport` indexes it by a vertex's world-space Y,
   * which lives in [-1.3, 1.3], because on a finished isosurface the density is
   * zero everywhere by construction and height is the only signal left. Handing
   * the caves view a ramp fitted to the field put every vertex below the ramp's
   * floor, so the whole solid clamped to the terrain palette's deepest blue and
   * the tunnels were invisible inside it. Two domains, not one.
   *
   * Either way it is fitted rather than fixed: flooding raises the floor and
   * erosion lowers the ceiling, so a fixed domain would spend a growing part of
   * the palette on heights the terrain no longer reaches.
   */
  const ramp = useMemo<Ramp>(() => {
    const lut = buildLut(settings.palette, ACCENT_BLUE, CONTINUOUS)
    if (!mesh) return { ...lut, ...fieldDomain(world.height) }

    let min = Infinity
    let max = -Infinity
    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i]
      if (y < min) min = y
      if (y > max) max = y
    }
    // An empty mesh — cave density high enough to eat everything — leaves the
    // bounds at infinity, which would make every lookup NaN.
    if (!Number.isFinite(min) || max <= min) return { ...lut, min: 0, span: 1 }
    return { ...lut, min, span: max - min }
  }, [settings.palette, world, mesh])

  return { world, ramp, mesh, stale: deferred !== inputs || caveDensity !== settings.caveDensity }
}
