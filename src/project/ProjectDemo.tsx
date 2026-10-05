import { useState } from 'react'
import { ControlSection } from '../ControlSection'
import { InfoTip } from '../InfoTip'
import { NoiseViewport } from '../NoiseViewport'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { VoxelViewport } from '../VoxelViewport'
import { Workspace } from '../Workspace'
import { PALETTES, type PaletteName } from '../palette'
import { useWorld } from './useWorld'
import { RESOLUTIONS, SCENARIOS, defaultWorld, type WorldSettings } from './world'
import './project.css'

/**
 * The integrated world, with the controls that survived.
 *
 * ## Why this has nine controls and Topic 2 has thirty
 *
 * Topic 2 exposes every parameter because the parameter space *is* the subject:
 * you cannot learn what carry capacity does without being able to set it to
 * something destructive. Here the subject is the world, so a control earns its
 * place by changing the world in a way worth describing — and eight erosion
 * dials that each need a measurement to set responsibly do not.
 *
 * So the droplet's character is fixed to Topic 2's `gorges` preset, which was
 * chosen there against a structure-function sweep, and what is exposed is how
 * much rain falls on it. The rule throughout: the project picks the settings
 * that need evidence, and leaves the ones that read as decisions.
 *
 * ## Why it borrows Workspace
 *
 * This page is an instrument, not a reading — the one Project page that is. So
 * it takes the Playground's three columns and the floating View popover rather
 * than inventing a second layout language for the same job. Its own stylesheet
 * only changes what is inside the panels.
 */
export function ProjectDemo() {
  const [settings, setSettings] = useState<WorldSettings>(defaultWorld)
  const [scenario, setScenario] = useState('highlands')
  const [spin, setSpin] = useState(0)
  const [wireframe, setWireframe] = useState(false)

  const { world, ramp, mesh, stale } = useWorld(settings)

  const set = <K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
    // A nudged dial is no longer the scenario that was loaded, the same way
    // Topic 2's erosion panel stops claiming a preset it has left behind.
    setScenario('')
  }

  const load = (value: string) => {
    const chosen = SCENARIOS.find((option) => option.value === value)
    if (!chosen) return
    setScenario(value)
    setSettings({ ...chosen.settings })
  }

  const chosen = SCENARIOS.find((option) => option.value === scenario)
  const resolutions = RESOLUTIONS[settings.view]

  return (
    <Workspace
      topic="project-demo"
      library={
        <aside className="control-sidebar" aria-label="Project worlds">
          <h3 className="control-group">
            <InfoTip text="Named points in the project's own parameter space. These are built into the page rather than stored per account — the demo has no saved-world collection of its own yet, so nothing here needs you to be signed in.">
              Worlds
            </InfoTip>
          </h3>

          <ul className="project-scenarios">
            {SCENARIOS.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={`project-scenario${scenario === option.value ? ' is-active' : ''}`}
                  aria-current={scenario === option.value ? 'true' : undefined}
                  onClick={() => load(option.value)}
                >
                  <span className="project-scenario-name">{option.label}</span>
                  <span className="project-scenario-summary">
                    {option.settings.view === 'caves' ? 'Caves' : 'Surface'} ·{' '}
                    {option.settings.resolution}
                    {option.settings.view === 'caves' ? '³' : '²'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {chosen ? (
            <p className="hint">{chosen.hint}</p>
          ) : (
            <p className="hint">
              Custom — the controls have moved away from every built-in world. Pick one
              above to go back.
            </p>
          )}
        </aside>
      }
      view={
        <ViewControls>
          <Slider
            label="Spin"
            info="Degrees per second about the vertical axis. Turning the world does not change it, which is why this lives here and the terrain dials do not."
            value={spin}
            display={spin === 0 ? 'still' : `${spin.toFixed(0)}°/s`}
            min={0}
            max={90}
            step={1}
            onChange={setSpin}
          />
          {settings.view === 'surface' && (
            <label className="control">
              <span className="control-label">
                <InfoTip text="Draws the sampling lattice over the terrain, so you can see the grid the field is actually stored on.">
                  Lattice
                </InfoTip>
              </span>
              <input
                type="checkbox"
                checked={wireframe}
                onChange={(event) => setWireframe(event.target.checked)}
              />
            </label>
          )}
        </ViewControls>
      }
      inspector={
        <aside className="control-sidebar" aria-label="World controls">
          <h3 className="control-group">
            <InfoTip text="The whole world comes from these nine values. Everything else — the droplet's behaviour, the octave weights, the talus angle — is fixed to the settings the Playground measured, because those are the ones that need evidence rather than taste.">
              World
            </InfoTip>
          </h3>

          <label className="control">
            <span className="control-label">
              <InfoTip text="Surface draws the heightfield directly. Caves reads the same heightfield as a distance field and subtracts a tunnel network from it, so you are looking at one world two ways rather than at two worlds.">
                View
              </InfoTip>
            </span>
            <select
              value={settings.view}
              onChange={(event) => {
                const view = event.target.value as WorldSettings['view']
                // Resolution ceilings differ by an order of magnitude between a
                // squared grid and a cubed one, so switching has to bring the
                // grid with it or the cave pass would sample 160³.
                const allowed = RESOLUTIONS[view]
                setSettings((current) => ({
                  ...current,
                  view,
                  resolution: allowed.includes(current.resolution)
                    ? current.resolution
                    : allowed[allowed.length - 1],
                }))
                setScenario('')
              }}
            >
              <option value="surface">Surface</option>
              <option value="caves">Caves</option>
            </select>
          </label>

          <label className="control">
            <span className="control-label">
              <InfoTip text="Grid edge. The surface samples resolution² cells; caves sample resolution³, which is why its ceiling is far lower — 72³ is 373,248 samples against 160² for 25,600.">
                Quality
              </InfoTip>
            </span>
            <select
              value={settings.resolution}
              onChange={(event) => set('resolution', Number(event.target.value))}
            >
              {resolutions.map((value) => (
                <option key={value} value={value}>
                  {value}
                  {settings.view === 'caves' ? '³' : '²'}
                </option>
              ))}
            </select>
          </label>

          <p className="readout">
            <strong>{world.resolution}</strong>
            {settings.view === 'caves' ? '³' : '²'} cells ·{' '}
            <InfoTip text="Time to run the whole chain — noise, warp, rain, slope collapse and flooding. Meshing the cave solid is counted separately, under Caves.">
              <strong>{world.ms.toFixed(0)} ms</strong>
            </InfoTip>
            <br />
            rain: <strong>{world.droplets.toLocaleString()}</strong> droplets
            {mesh && (
              <>
                <br />
                mesh: <strong>{mesh.triangles.toLocaleString()}</strong> triangles in{' '}
                <strong>{mesh.ms.toFixed(0)} ms</strong>
              </>
            )}
            {stale && (
              <>
                <br />
                <span className="project-stale">regenerating…</span>
              </>
            )}
          </p>

          <ControlSection
            title="Terrain"
            info="The noise the world starts as, before anything wears it down."
          >
            <Slider
              label="Landmass scale"
              info="Base frequency of the octave stack: how many landmasses fit across the map. Low values give one continent, high values give an archipelago before the sea is even raised."
              value={settings.landmass}
              display={settings.landmass.toFixed(1)}
              min={1}
              max={6}
              step={0.1}
              onChange={(value) => set('landmass', value)}
            />
            <Slider
              label="Ruggedness"
              info="How many octaves are stacked. More octaves is finer detail at the same overall shape, not more terrain — the sixth octave changes the texture of a hillside, not where the hill is. Six is Topic 2's measured default: two octaves score 0.960 for straightness where real topography is above 0.99, and six score 0.990."
              value={settings.ruggedness}
              display={`${settings.ruggedness.toFixed(0)} octaves`}
              min={3}
              max={9}
              step={1}
              onChange={(value) => set('ruggedness', value)}
            />
            <Slider
              label="Meander"
              info="Domain warp, in cells: the field is displaced sideways by a second noise field before anything else touches it, which bends straight ridges into something that looks like it has a history. Stops at 12 because past about 20 cells it starts shearing the fine octaves apart and the roughness measurably drops."
              value={settings.meander}
              display={settings.meander === 0 ? 'off' : `${settings.meander.toFixed(0)} cells`}
              min={0}
              max={12}
              step={0.5}
              onChange={(value) => set('meander', value)}
            />
          </ControlSection>

          <ControlSection
            title="Weather"
            info="What wears the noise into landforms. This is the step that makes the difference between a noise field and terrain."
          >
            <Slider
              label="Weathering"
              info="Rain, in droplets per cell — never a droplet count, because a count means something different at every resolution. More is not better: channel concentration peaks around 0.3 droplets per cell and decays from there, so the default sits at the peak rather than at the top of the range."
              value={settings.weathering}
              display={settings.weathering === 0 ? 'none' : `${settings.weathering.toFixed(2)} /cell`}
              min={0}
              max={1.5}
              step={0.02}
              onChange={(value) => set('weathering', value)}
            />
            <Slider
              label="Slope collapse"
              info="Thermal erosion passes. Any slope steeper than the talus angle fails and its material slides downhill, which rounds the ridges and fans debris into the valleys. Off by default — it is a strong effect and reads as a decision, not as a baseline."
              value={settings.slopeCollapse}
              display={settings.slopeCollapse === 0 ? 'off' : `${settings.slopeCollapse.toFixed(0)} passes`}
              min={0}
              max={20}
              step={1}
              onChange={(value) => set('slopeCollapse', value)}
            />
          </ControlSection>

          <ControlSection title="Water and scale" info="The two controls that set how the finished terrain reads.">
            <Slider
              label="Sea level"
              info="Everything below the waterline is raised flat to it, rather than being recoloured. A lake with a bumpy surface reads as wet ground; a flat one reads as water, and the terrain palette's lowest stops are already the two blues, so the colour follows for free."
              value={settings.seaLevel}
              display={settings.seaLevel === 0 ? 'dry' : `${(settings.seaLevel * 100).toFixed(0)}%`}
              min={0}
              max={0.7}
              step={0.01}
              onChange={(value) => set('seaLevel', value)}
            />
            <Slider
              label="Relief"
              info="Vertical exaggeration, applied when the geometry is built rather than baked into the field. Nothing is regenerated when this moves, which is why it is the cheapest control on the page."
              value={settings.relief}
              display={`${settings.relief.toFixed(2)}×`}
              min={0.2}
              max={3}
              step={0.05}
              onChange={(value) => set('relief', value)}
            />
          </ControlSection>

          {settings.view === 'caves' && (
            <ControlSection
              title="Caves"
              info="Topic 3's CSG applied to Topic 2's terrain: the heightfield becomes a solid, and a tunnel network is subtracted from it."
            >
              <Slider
                label="Cave density"
                info="How much of the rock the tunnel network eats. It moves the gyroid's wall thickness rather than its scale: scale would change how many tunnels there are, which rescales the whole network and makes the control read as zoom instead of as more cave."
                value={settings.caveDensity}
                display={settings.caveDensity === 0 ? 'solid' : settings.caveDensity.toFixed(2)}
                min={0}
                max={0.9}
                step={0.01}
                onChange={(value) => set('caveDensity', value)}
              />
              <p className="hint">
                Where the ground is thin the tunnels break the surface, which is the
                clearest sign that both systems are reading the same heightfield.
              </p>
            </ControlSection>
          )}

          <ControlSection title="Appearance" defaultOpen={false} info="How height is turned into colour.">
            <label className="control">
              <span className="control-label">
                <InfoTip text="Ramps are interpolated in OKLab, so equal steps in height land as equal-looking steps in colour. Terrain is the hypsometric convention — the one palette here that reads as land and sea rather than as a data visualisation.">
                  Palette
                </InfoTip>
              </span>
              <select
                value={settings.palette}
                onChange={(event) => set('palette', event.target.value as PaletteName)}
              >
                {PALETTES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </ControlSection>
        </aside>
      }
    >
      {settings.view === 'caves' && mesh ? (
        <VoxelViewport mesh={mesh} ramp={ramp} spin={spin} showBounds={false} />
      ) : (
        <NoiseViewport
          mode="surface"
          resolution={world.resolution}
          field={world.height}
          heightScale={settings.relief}
          selected={null}
          ramp={ramp}
          overlay={null}
          spin={spin}
          wireframe={wireframe}
        />
      )}
    </Workspace>
  )
}
