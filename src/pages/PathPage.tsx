import { useCallback, useState } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { ViewControls } from '../ViewControls'
import { Workspace } from '../Workspace'
import {
  MAX_PATHS,
  MAX_POINTS,
  MIN_POINTS,
  PATH_COLOURS,
  RIVER_SPECS,
  ROAD_SPECS,
  defaultPathSettings,
  firstPath,
  newRiver,
  newRoad,
  pathLabel,
  pathSpec,
  routeFor,
  type PathKind,
  type PathParamSpec,
  type PathRef,
  type PathSettings,
} from '../config/pathConfig'
import { PathViewport, type PathReport } from '../paths/PathViewport'
import type { P2 } from '../paths/spline'
import '../study/study.css'

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

const ENDINGS: Record<NonNullable<PathReport['river']>['ending'], string> = {
  lake: 'reached the lake',
  joined: 'joined an earlier river as a tributary',
  edge: 'ran off the edge of the map',
  pit: 'ended in a basin with no outlet',
  length: 'stopped at the step limit',
}

/** Inserts a point halfway along the longest segment, so the curve barely moves. */
function addPoint(points: P2[]): P2[] {
  let best = 0
  let longest = -1
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z)
    if (d > longest) {
      longest = d
      best = i
    }
  }
  const a = points[best]
  const b = points[best + 1]
  return [...points.slice(0, best + 1), { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, ...points.slice(best + 1)]
}

export function PathPage() {
  const [settings, setSettings] = useState<PathSettings>(defaultPathSettings)
  const [showRoad, setShowRoad] = useState(true)
  const [showRiver, setShowRiver] = useState(true)
  const [report, setReport] = useState<PathReport | null>(null)

  const active = settings.active
  const update = (patch: Partial<PathSettings>) => setSettings((s) => ({ ...s, ...patch }))

  // One updater for "change this path", whichever list it lives in. Typed
  // loosely on purpose: roads and rivers differ only in their params, and
  // every caller passes params that belong to the kind it names.
  const editPath = useCallback(
    (ref: PathRef, change: (path: { points: P2[]; params: Record<string, number> }) => object) =>
      setSettings((s) => {
        const key = ref.kind === 'road' ? 'roads' : 'rivers'
        const list = s[key] as { points: P2[]; params: Record<string, number> }[]
        return { ...s, [key]: list.map((p, i) => (i === ref.index ? { ...p, ...change(p) } : p)) }
      }),
    [],
  )
  const setPoints = (ref: PathRef, points: P2[]) => editPath(ref, () => ({ points }))
  const setParam = (ref: PathRef, key: string, value: number) =>
    editPath(ref, (p) => ({ params: { ...p.params, [key]: value } }))

  // Stable, so the viewport's pointer handlers never close over stale state.
  const movePoint = useCallback(
    (ref: PathRef, index: number, point: P2) =>
      editPath(ref, (p) => ({ points: p.points.map((q, i) => (i === index ? point : q)) })),
    [editPath],
  )
  const pick = useCallback(
    (ref: PathRef) =>
      setSettings((s) => (s.active.kind === ref.kind && s.active.index === ref.index ? s : { ...s, active: ref })),
    [],
  )

  const addPath = (kind: PathKind) =>
    setSettings((s) => {
      const list = kind === 'road' ? s.roads : s.rivers
      if (list.length >= MAX_PATHS) return s
      const index = list.length
      return kind === 'road'
        ? { ...s, roads: [...s.roads, newRoad(index)], active: { kind, index } }
        : { ...s, rivers: [...s.rivers, newRiver(index)], active: { kind, index } }
    })

  const deletePath = (ref: PathRef) =>
    setSettings((s) => {
      const next =
        ref.kind === 'road'
          ? { ...s, roads: s.roads.filter((_, i) => i !== ref.index) }
          : { ...s, rivers: s.rivers.filter((_, i) => i !== ref.index) }
      // Stay on the same kind if any are left, on its neighbour; otherwise
      // whatever exists.
      const left = ref.kind === 'road' ? next.roads : next.rivers
      next.active = left.length > 0 ? { kind: ref.kind, index: Math.min(ref.index, left.length - 1) } : firstPath(next)
      return next
    })

  const current = active.index < 0 ? null : active.kind === 'road' ? settings.roads[active.index] : settings.rivers[active.index]
  const specs = (active.kind === 'road' ? ROAD_SPECS : RIVER_SPECS) as PathParamSpec<string>[]
  const params = (current?.params ?? {}) as Record<string, number>
  const points = current?.points ?? []
  const refs: PathRef[] = [
    ...settings.roads.map((_, index) => ({ kind: 'road' as const, index })),
    ...settings.rivers.map((_, index) => ({ kind: 'river' as const, index })),
  ]

  return (
    <Workspace
      topic="paths"
      library={<ConfigPanel spec={pathSpec} settings={settings} onLoad={(next) => setSettings(next)} />}
      view={
        <ViewControls>
          <label className="control control-toggle">
            <span className="control-label">Show roads</span>
            <input type="checkbox" checked={showRoad} onChange={(e) => setShowRoad(e.target.checked)} />
          </label>
          <label className="control control-toggle">
            <span className="control-label">Show rivers</span>
            <input type="checkbox" checked={showRiver} onChange={(e) => setShowRiver(e.target.checked)} />
          </label>
          <p className="hint">
            Hiding the surfaces leaves their effect on the terrain in place — which is the
            clearest way to see the cuts, the fills and the channels.
          </p>
        </ViewControls>
      }
      inspector={
        <aside className="control-sidebar" aria-label="Path controls">
          <h3 className="control-group">
            <InfoTip text="Every path is on the terrain at once. Rivers are carved first, each on the ground the earlier ones left, so a later river can find an earlier one's channel and join it as a tributary. Roads are graded last: across a river a road becomes a causeway, and where two roads cross the later grade wins. Pick a path here, or click one of its handles in the view, to edit it.">
              Paths
            </InfoTip>
          </h3>
          <div className="path-list" role="tablist" aria-label="Path to edit">
            {refs.map((ref) => {
              const selected = ref.kind === active.kind && ref.index === active.index
              return (
                <button
                  key={`${ref.kind}-${ref.index}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`segmented-option${selected ? ' is-active' : ''}`}
                  onClick={() => update({ active: ref })}
                >
                  <span className="swatch" style={{ background: hex(PATH_COLOURS[ref.kind]) }} />
                  {pathLabel(ref)}
                </button>
              )
            })}
          </div>
          <div className="button-row">
            <button
              type="button"
              className="reset-button"
              disabled={settings.roads.length >= MAX_PATHS}
              onClick={() => addPath('road')}
            >
              + Road
            </button>
            <button
              type="button"
              className="reset-button"
              disabled={settings.rivers.length >= MAX_PATHS}
              onClick={() => addPath('river')}
            >
              + River
            </button>
            <button
              type="button"
              className="reset-button is-destructive"
              disabled={!current}
              onClick={() => deletePath(active)}
              title={current ? `Delete ${pathLabel(active)}` : undefined}
            >
              Delete
            </button>
          </div>

          {current ? (
            <>
              <h3 className="control-group">{pathLabel(active)}</h3>
              <p className="hint">
                {active.kind === 'road'
                  ? 'The spline is drawn where you put it and takes its heights from the ground — then levels the ground to a smoothed grade. Terrain → spline, then spline → terrain.'
                  : 'The terrain decides the route: from the source, each step blends toward the next guide point and straight downhill. The water only descends and the channel only cuts.'}
              </p>

              {specs.map((spec) => (
                <Slider
                  key={spec.key}
                  label={spec.label}
                  info={spec.info}
                  value={params[spec.key]}
                  display={spec.format ? spec.format(params[spec.key]) : params[spec.key].toFixed(2)}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  onChange={(v) => setParam(active, spec.key, v)}
                />
              ))}

              <h3 className="control-group">
                <InfoTip text="Drag a handle in the view to move it across the terrain; the path and everything it does to the ground rebuild as you drag. New points are inserted halfway along the longest span, so adding one barely moves the curve.">
                  Control points
                </InfoTip>
              </h3>
              <p className="hint">
                {points.length} points ·{' '}
                {active.kind === 'river' ? 'the large handle is the source; the rest are guides' : 'drag any handle'}
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="reset-button"
                  disabled={points.length >= MAX_POINTS}
                  onClick={() => setPoints(active, addPoint(points))}
                >
                  Add point
                </button>
                <button
                  type="button"
                  className="reset-button"
                  disabled={points.length <= MIN_POINTS}
                  onClick={() => setPoints(active, points.filter((_, i) => i !== points.length - 2))}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="reset-button"
                  onClick={() => setPoints(active, routeFor(active))}
                >
                  Reset
                </button>
              </div>
            </>
          ) : (
            <p className="hint">No paths left. Add a road or a river to start again.</p>
          )}

          <h3 className="control-group">
            <InfoTip text="Draws the 2D spline flat on a map plane above the terrain, with a line down to the ground from it and a dot where each lands — the projection, literally. The coloured line on the ground is the centreline the path was built to, and the terrain is tinted where each path changed it.">
              Debug
            </InfoTip>
          </h3>
          <label className="control control-toggle">
            <span className="control-label">Centreline, control points, projection</span>
            <input type="checkbox" checked={settings.debug} onChange={(e) => update({ debug: e.target.checked })} />
          </label>

          <Slider
            label="Terrain seed"
            info="Rebuilds the ground. The control points stay where they are, so the same routes can be tried on a different landscape — the defaults were placed for seed 3."
            value={settings.terrainSeed}
            display={String(settings.terrainSeed)}
            min={1}
            max={40}
            step={1}
            onChange={(v) => update({ terrainSeed: v })}
          />

          {report && (
            <p className="readout">
              {report.road && (
                <>
                  length <strong>{report.road.length.toFixed(2)}</strong> · steepest{' '}
                  <InfoTip text="The steepest rise over any half-unit stretch: first along the raw projection, then along the smoothed grade the road was built to.">
                    <strong>{report.road.rawMaxGrade.toFixed(0)}%</strong> on the ground →{' '}
                    <strong>{report.road.roadMaxGrade.toFixed(0)}%</strong> on the road
                  </InfoTip>
                  <br />
                  cut <strong>{report.road.cut.toFixed(3)}</strong> · fill{' '}
                  <strong>{report.road.fill.toFixed(3)}</strong> units³
                  <br />
                </>
              )}
              {report.river && (
                <>
                  {ENDINGS[report.river.ending]} · length <strong>{report.river.length.toFixed(2)}</strong>
                  <br />
                  <InfoTip text="Sum of every rise in the ground along the course. A river that follows the terrain climbs nothing; one held to its guides has to climb, and the channel is then cut down through the rise to keep the water descending.">
                    ground climbed <strong>{report.river.climbed.toFixed(3)}</strong>
                  </InfoTip>{' '}
                  · water fell <strong>{report.river.drop.toFixed(3)}</strong>
                  <br />
                  deepest cut <strong>{report.river.maxCarve.toFixed(3)}</strong>
                  <br />
                </>
              )}
              {settings.roads.length > 1 && (
                <>
                  all roads: cut <strong>{report.totals.cut.toFixed(3)}</strong> · fill{' '}
                  <strong>{report.totals.fill.toFixed(3)}</strong> units³
                  <br />
                </>
              )}
              rebuilt in <strong>{report.buildMs.toFixed(1)} ms</strong>
            </p>
          )}
        </aside>
      }
    >
      <PathViewport
        settings={settings}
        showRoad={showRoad}
        showRiver={showRiver}
        onReport={setReport}
        onMovePoint={movePoint}
        onPick={pick}
      />
      {report && current && <Profile report={report} active={active} />}
    </Workspace>
  )
}

/**
 * Elevation along the active path: the ground the spline was projected onto,
 * and the height it was actually built to. The gap between the two lines is
 * the whole study — for the road it is cut and fill, for the river it is the
 * channel the water needed in order never to flow uphill.
 */
function Profile({ report, active }: { report: PathReport; active: PathRef }) {
  const kind = active.kind
  const { s, ground, path, bed } = report.profile
  if (s.length < 2) return null
  const W = 300
  const H = 92
  const all = [...ground, ...path, ...(bed ?? [])]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = Math.max(hi - lo, 0.05)
  const len = s[s.length - 1] || 1
  const xy = (values: number[]) =>
    values.map((v, i) => `${((s[i] / len) * W).toFixed(1)},${(H - 6 - ((v - lo) / span) * (H - 14)).toFixed(1)}`).join(' ')
  return (
    <div className="study-overlay study-profile">
      <div className="profile-title">
        Elevation along {pathLabel(active)} · {len.toFixed(1)} units
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Elevation profile of ${pathLabel(active)}`}>
        <polyline points={xy(ground)} fill="none" stroke="#949aa3" strokeWidth="1.2" strokeDasharray="3 2" />
        {bed && <polyline points={xy(bed)} fill="none" stroke={hex(PATH_COLOURS.river)} strokeWidth="1" opacity="0.5" />}
        <polyline points={xy(path)} fill="none" stroke={hex(PATH_COLOURS[kind])} strokeWidth="1.8" />
      </svg>
      <div className="profile-key">
        <span><span className="key-line is-dashed" /> ground under the spline</span>
        <span>
          <span className="key-line" style={{ background: hex(PATH_COLOURS[kind]) }} />{' '}
          {kind === 'road' ? 'road grade' : 'water surface'}
        </span>
        {bed && (
          <span>
            <span className="key-line" style={{ background: hex(PATH_COLOURS.river), opacity: 0.5 }} /> bed
          </span>
        )}
      </div>
    </div>
  )
}
