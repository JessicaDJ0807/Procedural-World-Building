import { useCallback, useEffect, useMemo, useState } from 'react'
import { InfoTip } from '../InfoTip'
import { ViewControls } from '../ViewControls'
import { Slider } from '../Slider'
import { ROOF } from '../green/building'
import { DEFAULT_PARAMS, ENVIRONMENT_SLIDERS, type GrowthParams } from '../green/params'
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../green/species'
import { SEASONS, type Season } from '../green/sunPath'
import { CAMPUS_CELL, type Campus } from './campus'
import type { WorkerReply, WorkerRequest } from './campus.worker'
import { loadSite, polygonArea, ringArea, type Site, type SurfaceKind } from './siteData'
import { FULL_LIGHT_HOURS, STEPS_PER_YEAR, type SimMode, type SunSet } from './campusSim'
import type { Roadside } from './roadside'
import { SURFACE_TYPES, SURFACES } from './facadeSurfaces'
import { HOURS_RAMP, MOISTURE_RAMP, SITE_SPECIES, SUN_RAMP, SURFACE_COLOURS, rampGradient } from './siteLook'
import {
  MAX_SUN_HOURS,
  SITE_STALL_STEPS,
  SiteViewport,
  type Seeding,
  type SiteDisplay,
  type SiteLayer,
  type SiteReport,
  type SunMoment,
  type SiteView,
  type Study,
  type Tally,
} from './SiteViewport'
import { SiteHistory } from './SiteHistory'
import { SunDial } from './SunDial'
import { formatClock, formatDay, lateAfternoon, sunTimes } from './sunClock'
import '../green/green.css'
import './site.css'

const LAYERS: { id: SiteLayer; label: string; kinds: SurfaceKind[]; swatch: string }[] = [
  { id: 'buildings', label: 'Buildings', kinds: [], swatch: '#dccbb0' },
  { id: 'green', label: 'Green space', kinds: ['recreation', 'park', 'openSpace', 'vacant'], swatch: SURFACE_COLOURS.recreation },
  { id: 'roads', label: 'Roads', kinds: ['roadbed', 'median'], swatch: SURFACE_COLOURS.roadbed },
  { id: 'sidewalks', label: 'Sidewalks', kinds: ['sidewalk'], swatch: SURFACE_COLOURS.sidewalk },
  { id: 'parking', label: 'Parking', kinds: ['parking'], swatch: SURFACE_COLOURS.parking },
]

const ALL_ON: Record<SiteLayer, boolean> = { buildings: true, green: true, roads: true, sidewalks: true, parking: true }

const FEATURES: Record<number, string> = {
  1000: 'Parking structure',
  1004: 'Auxiliary structure',
  2100: 'Building',
  5100: 'Under construction',
  5110: 'Garage',
}

const m2 = (v: number) => `${Math.round(v).toLocaleString()} m²`

const DISPLAYS: { value: SiteDisplay; label: string; legend?: string }[] = [
  { value: 'final', label: 'Final' },
  { value: 'species', label: 'Species' },
  {
    value: 'hours',
    label: 'Sun hours',
    legend: `Hours of direct sun on each 0.5 m cell over a clear day: the half hours in which it faces the sun and no building, its own or a neighbour, stands in the way. Under 3 h is shade to a gardener, 3–6 h part sun, 6 h or more full sun. The plants read it as light: hours ÷ ${FULL_LIGHT_HOURS}, capped at 1.`,
  },
  {
    value: 'moisture',
    label: 'Moisture',
    legend:
      'Rain caught on the walls and carried down them, more on the roofs and at their edges, water running off a tall wall onto a lower roof — less where the sun dries it. The same moisture rule the game’s plants read; the city data has no ledges or windows to mark it further.',
  },
  {
    value: 'surfaces',
    label: 'Surfaces',
    legend:
      "Debug: what each campus cell is, from its building's façade rules — the surface type the growth reads. Glass can't be grown on; seams, louvers, ledges and railings are paths to follow; ground contact and recesses are damp; roof gardens are where planting starts.",
  },
  {
    value: 'suitability',
    label: 'Suitability',
    legend:
      'Debug: how much the species chosen under Planting wants each cell now — light, moisture and the surface, combined. What a growing tip ranks its neighbours by.',
  },
  {
    value: 'light',
    label: 'Sunlight',
    legend:
      'Direct sunlight over the day, weighted by how squarely it arrives and how much air it crosses, as a share of what open flat ground gets on a clear day in June.',
  },
]

/**
 * Gardeners' thresholds for a plant's light: six hours of direct sun or more
 * is full sun, three to six is part sun, under three is shade. Plant labels
 * use them, so a wall's sun hours say directly what could grow on it.
 */
const FULL_SUN = 6
const PART_SUN = 3

/** The roadside's own wording where the campus's would mislead. */
const ROADSIDE_LEGENDS: Partial<Record<SiteDisplay, string>> = {
  hours: `Hours of direct sun on each 1 m of ground over a clear day, with every building's shadow drawn onto it. Under 3 h is shade, 3–6 h part sun, 6 h or more full sun; the plants read hours ÷ ${FULL_LIGHT_HOURS} as light.`,
  moisture:
    'Rain on the ground, plus what the pavement within 3 m sheds onto it; cracks in pavement keep a little. Less where the sun dries it. The road itself grows nothing.',
}

/** A tally's covered share, as a whole percentage. */
const coveredPct = (t: Tally) => `${Math.round((100 * t.grown.reduce((a, c) => a + c, 0)) / Math.max(1, t.cells))}%`

/** What each species holds of a group of cells, as segments of one bar; the empty rest is bare. */
function SpeciesBar({ tally }: { tally: Tally }) {
  const bare = tally.cells - tally.grown.reduce((a, c) => a + c, 0)
  return (
    <span className="site-sunbar site-speciesbar" aria-hidden="true">
      {SPECIES_IDS.map((id, k) => (
        <span key={id} style={{ flexGrow: tally.grown[k], background: SITE_SPECIES[SPECIES_IDS.indexOf(id)].css }} />
      ))}
      <span style={{ flexGrow: bare }} />
    </span>
  )
}

/**
 * Each species as a behavior, in Build's terms: the way it grows, and what it
 * needs — from its parameters in green/species.ts.
 */
const BEHAVIOUR: Record<SpeciesId, { arrow: string; note: string }> = {
  ivy: { arrow: '↑', note: 'climbs in strands · part shade' },
  moss: { arrow: '↔', note: 'spreads into patches · deep shade, wet' },
  vine: { arrow: '↑', note: 'climbs fast in long runs · full sun' },
}

/** 64× because the campus is sixteen times the invented building's length of wall. */
const SPEEDS = [1, 4, 16, 64]
const speciesName = (id: SpeciesId) => SPECIES[id].name

/**
 * The site: Roosevelt Island, from the city's own data.
 *
 * Moving the growth model off its invented building and onto a real place.
 * The Cornell Tech buildings are cut into cells like the invented building,
 * and lit by the real sun path for the island; nothing grows on them yet.
 *
 * The sidebar holds the data and the day the sun is computed for; the View
 * popover holds what is painted, the camera and the layer switches, which
 * change nothing but what is drawn.
 */
/** How long Play the day takes, sunrise to sunset. */
const DAY_PLAY_MS = 9000

export function SitePage() {
  const [site, setSite] = useState<Site | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState(ALL_ON)
  const [selected, setSelected] = useState<number | null>(null)
  const [view, setView] = useState<SiteView>('campus')
  const [viewToken, setViewToken] = useState(0)
  const [focus, setFocus] = useState<{ index: number; token: number } | null>(null)
  const [season, setSeason] = useState<Season | 'year'>('year')
  const [dieBack, setDieBack] = useState(true)
  const [display, setDisplay] = useState<SiteDisplay>('final')
  const [params, setParams] = useState<GrowthParams>(DEFAULT_PARAMS)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(16)
  const [stepToken, setStepToken] = useState(0)
  const [resetToken, setResetToken] = useState(0)
  const [seeding, setSeeding] = useState<Seeding>('auto')
  const [plantSpecies, setPlantSpecies] = useState(0)
  const [report, setReport] = useState<SiteReport | null>(null)
  const [stalledAt, setStalledAt] = useState<number | null>(null)
  // The scene's sun: null follows the growth's day; paused, a chosen day and hour.
  const [sunMoment, setSunMoment] = useState<SunMoment | null>(null)
  // A day played sunrise to sunset: the day, while it plays.
  const [dayPlay, setDayPlay] = useState<number | null>(null)
  const onStall = useCallback((step: number) => {
    setRunning(false)
    setStalledAt(step)
  }, [])
  const restart = () => {
    setStalledAt(null)
    setResetToken((t) => t + 1)
  }

  useEffect(() => {
    let live = true
    loadSite().then(
      (s) => live && setSite(s),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [])

  const stats = useMemo(() => {
    if (!site) return null
    const area = (kinds: SurfaceKind[]) =>
      kinds.reduce((sum, k) => sum + (site.surfaces[k] ?? []).reduce((s, p) => s + polygonArea(p), 0), 0)
    return {
      land: ringArea(site.island),
      footprint: site.buildings.reduce((s, b) => s + polygonArea(b.outline), 0),
      byLayer: Object.fromEntries(LAYERS.map((l) => [l.id, area(l.kinds)])) as Record<SiteLayer, number>,
      campus: site.buildings.map((b, i) => ({ b, i })).filter(({ b }) => b.campus).sort((a, b) => b.b.height - a.b.height),
    }
  }, [site])

  const [campus, setCampus] = useState<Campus | null>(null)
  const [suns, setSuns] = useState<SunSet | null>(null)
  const [roadside, setRoadside] = useState<{ data: Roadside; suns: SunSet } | null>(null)
  const [study, setStudy] = useState<Study>('campus')
  const [rawCells, setRawCells] = useState(false)
  const [facades, setFacades] = useState(true)
  /** The fixed day the sun bars and sun views describe; over a year, the equinox — the year's middle. */
  const barDay: Season = season === 'year' ? 'equinox' : season
  const daySun = suns?.[barDay] ?? null
  const sunInfo = SEASONS.find((x) => x.id === barDay)!
  const mode = useMemo<SimMode>(() => ({ day: season, dieBack }), [season, dieBack])

  // One worker per visit: it builds the campus, then traces all three days.
  useEffect(() => {
    if (!site) return
    const w = new Worker(new URL('./campus.worker.ts', import.meta.url), { type: 'module' })
    w.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const msg = event.data
      if (msg.type === 'campus') setCampus(msg.campus)
      else if (msg.type === 'suns') setSuns(msg.suns)
      else setRoadside({ data: msg.roadside, suns: msg.suns })
    })
    w.postMessage({ type: 'build', site } satisfies WorkerRequest)
    return () => w.terminate()
  }, [site])

  /** Per campus building: its walls' share in full sun, part sun and shade, and its roof's mean hours. */
  const sunBy = useMemo(() => {
    if (!campus || !daySun) return null
    const by = new Map<number, { full: number; part: number; shade: number; walls: number; roofHours: number; roofs: number }>()
    for (const i of campus.indices) by.set(i, { full: 0, part: 0, shade: 0, walls: 0, roofHours: 0, roofs: 0 })
    const b = campus.building
    for (let c = 0; c < b.count; c++) {
      const entry = by.get(campus.owner[c])
      if (!entry) continue
      const h = daySun.hours[c]
      if (b.flags[c] & ROOF) {
        entry.roofHours += h
        entry.roofs++
      } else {
        entry.walls++
        if (h >= FULL_SUN) entry.full++
        else if (h >= PART_SUN) entry.part++
        else entry.shade++
      }
    }
    return by
  }, [campus, daySun])

  const chosen = site && selected !== null ? site.buildings[selected] : null
  const legend = DISPLAYS.find((d) => d.value === display)

  const frame = (index: number) => {
    setSelected(index)
    setFocus((f) => ({ index, token: (f?.token ?? 0) + 1 }))
  }

  const lat = site?.origin.lat ?? 40.76
  const lon = site?.origin.lon ?? -73.95
  useEffect(() => {
    if (dayPlay === null) return
    const t = sunTimes(lat, lon, dayPlay)
    // From a quarter of an hour before sunrise to as long after sunset.
    const from = t.sunrise - 0.25
    const span = t.length + 0.5
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const f = Math.min(1, (now - start) / DAY_PLAY_MS)
      setSunMoment({ day: dayPlay, hour: from + f * span })
      if (f < 1) frame = requestAnimationFrame(tick)
      else setDayPlay(null)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dayPlay, lat, lon])
  const shownSun = sunMoment ?? (report && report.sun.day >= 0 ? report.sun : null)

  return (
    <div className="workspace green-workspace">
      <div className="workspace-canvas">
        {site && campus && suns ? (
          <SiteViewport
            site={site}
            campus={campus}
            suns={suns}
            study={study}
            facades={facades}
            rawCells={rawCells}
            roadside={roadside}
            mode={mode}
            display={display}
            params={params}
            running={running}
            speed={speed}
            stepToken={stepToken}
            resetToken={resetToken}
            seeding={seeding}
            plantSpecies={plantSpecies}
            onReport={setReport}
            onStall={onStall}
            layers={layers}
            selected={selected}
            onSelect={setSelected}
            view={view}
            viewToken={viewToken}
            focus={focus}
            sunMoment={sunMoment}
          >
            {shownSun && <SunDial lat={lat} lon={lon} day={shownSun.day} hour={shownSun.hour} chosen={sunMoment !== null} />}
          </SiteViewport>
        ) : (
          <p className="site-status">
            {error
              ? `Could not load the site data: ${error}`
              : !site
                ? 'Loading Roosevelt Island…'
                : !campus
                  ? 'Cutting the Cornell Tech buildings into cells…'
                  : 'Tracing the sun across the campus…'}
          </p>
        )}

        {display === 'species' && (
          <div className="green-legend" aria-live="polite">
            <div className="green-legend-species">
              {SPECIES_IDS.map((id) => (
                <span key={id}>
                  <span className="green-swatch" style={{ background: SITE_SPECIES[SPECIES_IDS.indexOf(id)].css }} aria-hidden="true" />
                  {SPECIES[id].name}
                </span>
              ))}
            </div>
            <p>Which species holds each campus cell. A cell belongs to whichever species reached it first.</p>
          </div>
        )}

        {display === 'surfaces' && (
          <div className="green-legend" aria-live="polite">
            <div className="site-surface-legend">
              {SURFACE_TYPES.map((t) => (
                <span key={t}>
                  <span className="green-swatch" style={{ background: SURFACES[t].debug }} aria-hidden="true" />
                  {SURFACES[t].label}
                </span>
              ))}
            </div>
            <p>{study === 'roadside' ? 'On the roadside: the ground surfaces, as drawn.' : legend?.legend}</p>
          </div>
        )}

        {legend?.legend && display !== 'surfaces' && (
          <div className="green-legend" aria-live="polite">
            <div className="green-legend-head">
              <strong>
                {legend.label} · {sunInfo.date}
              </strong>
              <span
                className="green-ramp"
                style={{ background: rampGradient(display === 'hours' ? HOURS_RAMP : display === 'moisture' ? MOISTURE_RAMP : SUN_RAMP) }}
                aria-hidden="true"
              />
              {display === 'hours' ? (
                <span className="site-legend-ticks">
                  <span style={{ left: '0%' }}>0</span>
                  <span style={{ left: `${(100 * PART_SUN) / MAX_SUN_HOURS}%` }}>3</span>
                  <span style={{ left: `${(100 * FULL_SUN) / MAX_SUN_HOURS}%` }}>6</span>
                  <span style={{ left: '100%' }}>{MAX_SUN_HOURS} h</span>
                </span>
              ) : (
                <span className="green-legend-ends">
                  <span>{display === 'moisture' ? 'dry' : '0%'}</span>
                  <span>{display === 'moisture' ? 'wet' : '100%'}</span>
                </span>
              )}
            </div>
            <p>{study === 'roadside' && ROADSIDE_LEGENDS[display] ? ROADSIDE_LEGENDS[display] : legend.legend}</p>
            <p className="green-legend-note">
              {study === 'roadside'
                ? 'The ground is painted; every building casts its shadow on it.'
                : display === 'moisture'
                  ? 'Only the Cornell Tech buildings are painted.'
                  : 'Only the Cornell Tech buildings are painted; every building casts shadows.'}
            </p>
          </div>
        )}

        <ViewControls>
          <span className="control-label green-view-label">Display</span>
          <div className="green-display" role="radiogroup" aria-label="Display">
            {DISPLAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={display === d.value}
                className={`segmented-option${display === d.value ? ' is-active' : ''}`}
                onClick={() => setDisplay(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="control-label green-view-label">Camera</span>
          <div className="segmented">
            {(['island', 'campus'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`segmented-option${view === v ? ' is-active' : ''}`}
                onClick={() => {
                  setView(v)
                  setViewToken((t) => t + 1)
                }}
              >
                {v === 'island' ? 'Island' : 'Cornell Tech'}
              </button>
            ))}
          </div>
          <span className="control-label green-view-label site-view-gap">Layers</span>
          {LAYERS.map((l) => (
            <label key={l.id} className="control control-toggle">
              <span className="control-label">
                <span className="green-swatch" style={{ background: l.swatch }} aria-hidden="true" />
                {l.label}
              </span>
              <input
                type="checkbox"
                checked={layers[l.id]}
                onChange={(e) => setLayers((current) => ({ ...current, [l.id]: e.target.checked }))}
              />
            </label>
          ))}
          <label className="control control-toggle">
            <span className="control-label">
              <InfoTip text="Debug: draw the growth as the simulation holds it — one square per cell — instead of as plant masses. The masses are drawn from exactly these cells; this is for checking that they match.">
                Show simulation cells
              </InfoTip>
            </span>
            <input type="checkbox" checked={rawCells} onChange={(e) => setRawCells(e.target.checked)} />
          </label>
          <p className="hint">Drag to rotate, right-drag or ⌘-drag to move, scroll to zoom. Hover a building to name it; click to select.</p>
        </ViewControls>
      </div>

      <div className="workspace-inspector green-inspector">
        <aside className="control-sidebar" aria-label="Site">
          <header className="site-intro">
            <h2>Wildform at Campus Scale</h2>
            <p>
              Apply Wildform’s growth logic to Cornell Tech and Roosevelt Island. Plants respond to façades, sunlight,
              moisture and architecture, and the campus changes over a simulated year.
            </p>
            <p className="site-intro-note">
              A larger-scale experiment: the real buildings stay fixed, with the same environment fields as the game and the
              real sun. The plants here are the three species of the model Wildform grew from; the game’s behaviors and living
              architecture are the next step for the campus.
            </p>
          </header>
          {site && stats ? (
            <>
              <h3 className="control-group">
                <InfoTip text="Two studies on the same island and the same growth model. Buildings grows on the six Cornell Tech buildings' walls and roofs. Roadside grows on the ground — every 1 m of the island that isn't river or building, classed as road, sidewalk, parking, median, lawn, vacant lot or unmapped ground.">
                  Study
                </InfoTip>
              </h3>
              <div className="segmented" role="radiogroup" aria-label="Study">
                {(['campus', 'roadside'] as const).map((x) => (
                  <button
                    key={x}
                    type="button"
                    role="radio"
                    aria-checked={study === x}
                    disabled={x === 'roadside' && !roadside}
                    className={`segmented-option${study === x ? ' is-active' : ''}`}
                    onClick={() => {
                      setRunning(false)
                      setStalledAt(null)
                      setStudy(x)
                    }}
                  >
                    {x === 'campus' ? 'Buildings' : roadside ? 'Roadside' : 'Roadside…'}
                  </button>
                ))}
              </div>
              {study === 'campus' && (
                <div className="segmented site-facade-toggle" role="radiogroup" aria-label="Façades">
                  {([true, false] as const).map((on) => (
                    <button
                      key={String(on)}
                      type="button"
                      role="radio"
                      aria-checked={facades === on}
                      className={`segmented-option${facades === on ? ' is-active' : ''}`}
                      title={on ? 'Procedural façades: windows, seams, louvers, ledges, terraces — and what each means to a plant' : 'The plain footprint massing the earlier studies used'}
                      onClick={() => {
                        setRunning(false)
                        setStalledAt(null)
                        setFacades(on)
                      }}
                    >
                      {on ? 'Detailed façades' : 'Massing'}
                    </button>
                  ))}
                </div>
              )}
              <p className="hint">
                {study === 'campus'
                  ? facades
                    ? 'Ivy, moss and a flowering vine on the Cornell Tech buildings, with procedural façades: glass stays clear, seams, louvers and ledges are what plants hold on to.'
                    : 'Ivy, moss and a flowering vine on the Cornell Tech buildings as plain massing — every wall the same surface.'
                  : 'The same three plants on the ground: ivy as ground cover, moss in damp shade, and the vine standing in for bindweed along sunny verges. Seeds start along the edges of pavement.'}
              </p>

              <h3 className="control-group">
                <InfoTip text="The three species of the growth model the Site runs — the one Wildform grew out of — each with its own needs for light and water, and a way of growing. Switching one on or off starts again. The game's Climber, Spreader and Draper, and its living architecture, are not on the campus yet.">
                  Plant behavior
                </InfoTip>
              </h3>
              <div className="green-species">
                {SPECIES_IDS.map((id, k) => (
                  <label key={id} className="green-species-row site-species-row">
                    <input
                      type="checkbox"
                      aria-label={`Grow ${SPECIES[id].name}`}
                      checked={params.species[id].enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked
                        setStalledAt(null)
                        setParams((p) => ({ ...p, species: { ...p.species, [id]: { ...p.species[id], enabled } } }))
                      }}
                    />
                    <span className="green-swatch" style={{ background: SITE_SPECIES[SPECIES_IDS.indexOf(id)].css }} aria-hidden="true" />
                    <span className="site-species-text">
                      <span className="green-species-name">
                        {SPECIES[id].name} <span className="site-species-arrow" aria-hidden="true">{BEHAVIOUR[id].arrow}</span>
                      </span>
                      <span className="site-species-note">{BEHAVIOUR[id].note}</span>
                    </span>
                    <span className="green-species-share">
                      {report && params.species[id].enabled ? `${(report.bySpecies[k] * 100).toFixed(1)}%` : 'off'}
                    </span>
                  </label>
                ))}
              </div>

              <span className="control-label green-view-label site-subhead">
                <InfoTip text="Automatic plants seeds along the foot of every campus wall (Buildings) or along every edge of pavement (Roadside) — roads carry seeds, which is the assumption the roadside study makes. Manual starts empty: click a campus wall or roof, or a patch of ground, to plant the chosen species there.">
                  Planting
                </InfoTip>
              </span>
              <div className="segmented" role="radiogroup" aria-label="Planting">
                {(['auto', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={seeding === m}
                    className={`segmented-option${seeding === m ? ' is-active' : ''}`}
                    onClick={() => {
                      setStalledAt(null)
                      setSeeding(m)
                    }}
                  >
                    {m === 'auto' ? 'Automatic' : 'Manual'}
                  </button>
                ))}
              </div>
              {seeding === 'manual' && (
                <>
                  <div className="site-plant-picker" role="radiogroup" aria-label="Species to plant">
                    {SPECIES_IDS.map((id, k) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={plantSpecies === k}
                        disabled={!params.species[id].enabled}
                        className={`site-plant${plantSpecies === k ? ' is-active' : ''}`}
                        onClick={() => setPlantSpecies(k)}
                      >
                        <span className="green-swatch" style={{ background: SITE_SPECIES[SPECIES_IDS.indexOf(id)].css }} aria-hidden="true" />
                        {speciesName(id)}
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    Click {study === 'campus' ? 'a wall or roof on a Cornell Tech building' : 'the ground anywhere off the road'} to plant{' '}
                    {speciesName(SPECIES_IDS[plantSpecies]).toLowerCase()} there, then press Play.
                  </p>
                </>
              )}

              <h3 className="control-group">
                <InfoTip text="Rain feeds the moisture field; the day above sets the light. A change carries the growth on under the new conditions.">
                  Environment
                </InfoTip>
              </h3>
              {ENVIRONMENT_SLIDERS.filter((x) => x.key === 'rain').map((spec) => (
                <Slider
                  key={spec.key}
                  label={spec.label}
                  info={spec.info}
                  value={params[spec.key]}
                  display={spec.format(params[spec.key])}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  onChange={(v) => setParams((p) => ({ ...p, [spec.key]: v }))}
                />
              ))}

              <h3 className="control-group">
                <InfoTip text="The sun's real path over Roosevelt Island (40.76° N) on a clear day, every half hour, with a shadow ray from every campus cell through every building on the island. Open View → Display to paint it on the campus. The scene is lit by the real sun on the day showing, late in the afternoon; pause to choose any date and hour.">
                  Sunlight
                </InfoTip>
              </h3>
              <div className="segmented" role="radiogroup" aria-label="Day">
                {[...SEASONS.map((x) => ({ id: x.id as Season | 'year', label: x.label })), { id: 'year' as const, label: 'Year' }].map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="radio"
                    aria-checked={season === x.id}
                    className={`segmented-option${season === x.id ? ' is-active' : ''}`}
                    onClick={() => setSeason(x.id)}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              {season === 'year' ? (
                <p className="readout">
                  {report?.month ? (
                    <>
                      Year <strong>{report.year}</strong> · <strong>{report.month}</strong>
                      <br />
                    </>
                  ) : null}
                  The light moves through the seasons — {STEPS_PER_YEAR.toLocaleString()} steps a year, starting at the March equinox — and
                  growth slows to a tenth in deep winter.
                </p>
              ) : (
                daySun && (
                  <p className="readout">
                    {sunInfo.date}: <strong>{daySun.samples.length / 2} h</strong> of sun above 2°,{' '}
                    <strong>{daySun.openGround.toFixed(1)} kWh/m²</strong> on open ground
                  </p>
                )
              )}
              {shownSun &&
                (running ? (
                  <p className="hint">The light follows the growth&apos;s day, late in the afternoon. Pause to choose a date and hour.</p>
                ) : (
                  <div className="site-sun-scrub">
                    <Slider
                      label="Light on"
                      info="Only what you see: the sun, sky and shadows. The growth keeps its own day."
                      value={shownSun.day}
                      display={formatDay(shownSun.day)}
                      min={0}
                      max={364}
                      step={1}
                      onChange={(day) => {
                        setDayPlay(null)
                        setSunMoment({ day, hour: sunMoment ? sunMoment.hour : lateAfternoon(lat, lon, day) })
                      }}
                    />
                    <Slider
                      label="At"
                      value={shownSun.hour}
                      display={formatClock(shownSun.hour)}
                      min={4}
                      max={21}
                      step={0.25}
                      onChange={(hour) => {
                        setDayPlay(null)
                        setSunMoment({ day: shownSun.day, hour })
                      }}
                    />
                    <div className="button-row">
                      <button type="button" className="reset-button" onClick={() => setDayPlay(shownSun.day)}>
                        {dayPlay !== null ? 'Playing…' : 'Play the day'}
                      </button>
                      <button
                        type="button"
                        className="reset-button"
                        disabled={sunMoment === null}
                        onClick={() => {
                          setDayPlay(null)
                          setSunMoment(null)
                        }}
                      >
                        Follow growth
                      </button>
                    </div>
                  </div>
                ))}
              <label className="control control-toggle">
                <span className="control-label">
                  <InfoTip text="Grown cells wither where their species can't live, and a climber's stem takes everything above it when it goes. Roots survive and regrow when conditions turn. Off, nothing ever dies, and growth only adds.">
                    Die-back
                  </InfoTip>
                </span>
                <input type="checkbox" checked={dieBack} onChange={(e) => setDieBack(e.target.checked)} />
              </label>
              {report && report.history.length > 1 && <SiteHistory history={report.history} cycling={season === 'year'} />}
              {campus && daySun && (
                <p className="hint">
                  {campus.building.count.toLocaleString()} cells at {CAMPUS_CELL} m, built in {Math.round(campus.ms)} ms; a day of sun in{' '}
                  {Math.round(daySun.ms)} ms.
                </p>
              )}

              <h3 className="control-group">
                <InfoTip text="The growth rule the Site runs, on the campus cells: tips look at their eight neighbours, score them by light, moisture and geometry for their species, and grow. 1× is 8 steps a second.">
                  Growth
                </InfoTip>
              </h3>
              <div className="button-row">
                <button
                  type="button"
                  className="reset-button is-primary"
                  onClick={() => {
                    setStalledAt(null)
                    // Playing hands the scene's sun back to the growth.
                    if (!running) {
                      setDayPlay(null)
                      setSunMoment(null)
                    }
                    setRunning((r) => !r)
                  }}
                >
                  {running ? 'Pause' : 'Play'}
                </button>
                <button type="button" className="reset-button" disabled={running} onClick={() => setStepToken((t) => t + 1)}>
                  Step
                </button>
                <button
                  type="button"
                  className="reset-button"
                  title={seeding === 'auto' ? 'Replant the same seeds and start again' : 'Clear everything planted'}
                  onClick={restart}
                >
                  {seeding === 'auto' ? 'Reset' : 'Clear'}
                </button>
              </div>
              <div className="segmented" role="radiogroup" aria-label="Speed">
                {SPEEDS.map((x) => (
                  <button
                    key={x}
                    type="button"
                    role="radio"
                    aria-checked={speed === x}
                    className={`segmented-option${speed === x ? ' is-active' : ''}`}
                    onClick={() => setSpeed(x)}
                  >
                    {x}×
                  </button>
                ))}
              </div>
              {report && (
                <p className="readout green-readout">
                  Step <strong>{report.step.toLocaleString()}</strong> · <strong>{(report.coverage * 100).toFixed(1)}%</strong> covered
                  <br />
                  <strong>{report.grown.toLocaleString()}</strong> cells · <strong>{report.tips}</strong> growing tips
                </p>
              )}
              {stalledAt !== null && (
                <p className="hint green-stalled">
                  Growth stopped: the last new cell grew at step {stalledAt.toLocaleString()}, and nothing has grown in the{' '}
                  {SITE_STALL_STEPS} steps since, so Play paused itself.
                </p>
              )}

              {study === 'campus' ? (
                <>
              <h3 className="control-group">
                <InfoTip text="Identified by address in the Department of Buildings' job filings for each building number, not by eye. The Tata Innovation Center opened as The Bridge. The first bar is each building's walls by hours of direct sun on the chosen day (over a year, the equinox): full sun (6 h or more), part sun (3–6 h), shade (under 3 h). The second is how much of the building — walls and roof — each species holds now; the number is the total.">
                  Cornell Tech
                </InfoTip>
              </h3>
              <div className="site-campus">
                {stats.campus.map(({ b, i }) => {
                  const sun = sunBy?.get(i)
                  const held = report?.byBuilding.find((t) => t.key === i)
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`site-campus-row${selected === i ? ' is-active' : ''}`}
                      onClick={() => frame(i)}
                    >
                      <span className="site-campus-name">
                        <span>{b.name}</span>
                        <span className="site-campus-height">
                          {b.height.toFixed(0)} m{held && held.cells > 0 && <> · {coveredPct(held)}</>}
                        </span>
                      </span>
                      {sun && sun.walls > 0 && (
                        <span className="site-sunbar" aria-label={`Walls: ${Math.round((100 * sun.full) / sun.walls)}% full sun, ${Math.round((100 * sun.part) / sun.walls)}% part sun, ${Math.round((100 * sun.shade) / sun.walls)}% shade`}>
                          <span className="is-full" style={{ flexGrow: sun.full }} />
                          <span className="is-part" style={{ flexGrow: sun.part }} />
                          <span className="is-shade" style={{ flexGrow: sun.shade }} />
                        </span>
                      )}
                      {held && held.cells > 0 && <SpeciesBar tally={held} />}
                    </button>
                  )
                })}
              </div>
              <p className="hint site-sun-key">
                <span className="site-key is-full" /> full sun <span className="site-key is-part" /> part sun{' '}
                <span className="site-key is-shade" /> shade, walls only; then what has grown
              </p>
              {report && (
                <>
                  <h3 className="control-group">
                    <InfoTip text="Every campus cell grouped by the way it faces — walls by compass sector, 45° either side of north, east, south and west — and the roofs. The number is how much of that group is covered now; the bar, by which species.">
                      By direction
                    </InfoTip>
                  </h3>
                  <div className="site-facings">
                    {report.byFacing.map((t) => (
                      <div key={t.key} className="site-facing">
                        <span className="site-facing-name">{t.key}</span>
                        <SpeciesBar tally={t} />
                        <span className="site-facing-pct">{coveredPct(t)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

                </>
              ) : report?.bySurface.length ? (
                <>
                  <h3 className="control-group">
                    <InfoTip text="Every ground cell a plant could grow on, by the surface the city maps it as; then the unpaved ground within 2 m of pavement against the unpaved ground farther away — the comparison the roadside study asks about. The number is how much is covered now; the bar, by which species.">
                      By surface
                    </InfoTip>
                  </h3>
                  <div className="site-facings site-surfaces">
                    {report.bySurface.map((t) => (
                      <div key={t.key} className="site-facing">
                        <span className="site-facing-name">{t.key}</span>
                        <SpeciesBar tally={t} />
                        <span className="site-facing-pct">{coveredPct(t)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <h3 className="control-group">
                <InfoTip text="A snapshot of NYC Open Data, fetched by scripts/fetch-roosevelt-island.mjs and saved with the app — the page never calls the city's API, so what you see here does not change until the snapshot is refreshed.">
                  Roosevelt Island
                </InfoTip>
              </h3>
              <p className="readout">
                <strong>{site.buildings.length}</strong> building footprints on <strong>{m2(stats.land)}</strong> of land
                <br />
                Snapshot of <strong>{site.fetched}</strong>
              </p>
              <dl className="site-areas">
                <div className="site-area-row">
                  <dt>
                    <span className="green-swatch" style={{ background: LAYERS[0].swatch }} aria-hidden="true" />
                    Building footprints
                  </dt>
                  <dd>{m2(stats.footprint)}</dd>
                </div>
                {LAYERS.filter((l) => l.kinds.length).map((l) => (
                  <div key={l.id} className="site-area-row">
                    <dt>
                      <span className="green-swatch" style={{ background: l.swatch }} aria-hidden="true" />
                      {l.label}
                    </dt>
                    <dd>{m2(stats.byLayer[l.id])}</dd>
                  </div>
                ))}
              </dl>

              {chosen && (
                <>
                  <h3 className="control-group">Selected</h3>
                  <dl className="site-details">
                    <dt>Name</dt>
                    <dd>{chosen.name ?? '—'}</dd>
                    {chosen.address && (
                      <>
                        <dt>Address</dt>
                        <dd>{chosen.address}</dd>
                      </>
                    )}
                    <dt>Type</dt>
                    <dd>{FEATURES[chosen.feature] ?? `Code ${chosen.feature}`}</dd>
                    <dt>Roof height</dt>
                    <dd>{chosen.heightMissing ? 'not recorded (drawn at 3 m)' : `${chosen.height.toFixed(1)} m`}</dd>
                    <dt>Built</dt>
                    <dd>{chosen.year ?? 'not recorded'}</dd>
                    <dt>Footprint</dt>
                    <dd>{m2(polygonArea(chosen.outline))}</dd>
                    <dt>BIN</dt>
                    <dd>{chosen.bin}</dd>
                    {selected !== null && sunBy?.get(selected) && (() => {
                      const sun = sunBy.get(selected)!
                      const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, sun.walls))}%`
                      return (
                        <>
                          <dt>Walls</dt>
                          <dd>
                            {pct(sun.full)} full sun · {pct(sun.part)} part · {pct(sun.shade)} shade
                          </dd>
                          <dt>Roof</dt>
                          <dd>{(sun.roofHours / Math.max(1, sun.roofs)).toFixed(1)} h of sun on average</dd>
                        </>
                      )
                    })()}
                  </dl>
                  <div className="button-row">
                    <button type="button" className="reset-button" onClick={() => selected !== null && frame(selected)}>
                      Frame
                    </button>
                    <button type="button" className="reset-button" onClick={() => setSelected(null)}>
                      Clear
                    </button>
                  </div>
                </>
              )}

              <h3 className="control-group">Sources</h3>
              <p className="hint">
                NYC Open Data: Building Footprints for outlines and roof heights; the planimetric Open Space, Roadbed,
                Sidewalk, Parking Lot and Median layers for the ground; the clipped borough boundary for the shoreline.
              </p>
              <p className="hint">
                The island&rsquo;s parks are run by the state, not NYC Parks, so the Parks Properties layer has none of
                them. Green space here is the planimetric open-space layers, which outline them without names.
              </p>
            </>
          ) : (
            <p className="hint">{error ?? 'Loading…'}</p>
          )}
        </aside>
      </div>
    </div>
  )
}
