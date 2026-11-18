import { useEffect, useRef, useState } from 'react'
import { Slider } from '../Slider'
import { landShapeKey, PATH_DEFAULTS, PATH_LIMITS, pathSettings, STREAM_DEFAULTS, STREAM_LIMITS, streamSettings, type PathSettings, type StreamSettings } from './landscape'
import type { BuildGame } from './game'

/**
 * The Lab's controls for the stream and the footpaths (landscape.ts's
 * StreamSettings and PathSettings). Saved with the world, like the seed and
 * density; scenery only — the simulation never reads the land.
 *
 * A slider moves its number at once but reaches the game only once it has
 * been still for COMMIT_MS: each change rebuilds the land and its decorations
 * (about a second at medium density), and rebuilding on every pointer move
 * would freeze the drag.
 */
const COMMIT_MS = 300

type Draft = { stream: StreamSettings; paths: PathSettings }
const fromGame = (game: BuildGame): Draft => ({ stream: streamSettings(game.landscape.stream), paths: pathSettings(game.landscape.paths) })
const same = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).every((k) => a[k] === b[k])

const PATH_COUNT = ['None', 'Main path', 'And its branch', 'And the east trail']

export function LandLinesPanel({ game, onChanged }: { game: BuildGame; onChanged: () => void }) {
  // The game's values, as last seen: when they change from outside (a world loaded, a new
  // landscape), the draft follows — adjusted during render, not in an effect.
  const key = landShapeKey(game.landscape)
  const [seen, setSeen] = useState(key)
  const [draft, setDraft] = useState<Draft>(() => fromGame(game))
  if (seen !== key) {
    setSeen(key)
    setDraft(fromGame(game))
  }

  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const change = (next: Draft) => {
    setDraft(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // Saved with the world from here on; a world never touched here saves none, and stays as it was.
      game.setLandscape({ stream: next.stream, paths: next.paths })
      onChanged()
    }, COMMIT_MS)
  }
  const setStream = (patch: Partial<StreamSettings>) => change({ ...draft, stream: { ...draft.stream, ...patch } })
  const setPaths = (patch: Partial<PathSettings>) => change({ ...draft, paths: { ...draft.paths, ...patch } })
  const isDefault = same(draft.stream, STREAM_DEFAULTS) && same(draft.paths, PATH_DEFAULTS)
  const reset = () => {
    window.clearTimeout(timer.current)
    setDraft({ stream: { ...STREAM_DEFAULTS }, paths: { ...PATH_DEFAULTS } })
    game.resetLandscapeLines()
    onChanged()
  }
  const { stream, paths } = draft
  const S = STREAM_LIMITS
  const P = PATH_LIMITS
  return (
    <div className="build-land-lines">
      <h5 className="build-land-lines-head">River</h5>
      <Slider label="Width" info="The stream's width, as a multiple of its tuned width. A wider one keeps further off the town (2 units for each 1× more), so its banks keep their room. Up to 1.5×: at 2× a bank stood at 1 in 0.7." value={stream.width} display={`${stream.width.toFixed(2)}×`} min={S.width[0]} max={S.width[1]} step={0.05} onChange={(v) => setStream({ width: v })} />
      <Slider label="Meander" info="How far it wanders across its line, as a multiple of the tuned wander. Low, it keeps close to the ridge's foot; high, it loops across the meadow's edge and down the valley." value={stream.meander} display={`${stream.meander.toFixed(2)}×`} min={S.meander[0]} max={S.meander[1]} step={0.05} onChange={(v) => setStream({ meander: v })} />
      <Slider label="Distance from town" info="How far its line keeps off the buildable grid along the ridge's foot (plus up to 2.5 by noise). 10 to 14: nearer, its banks were squeezed against the town's flat ground (1 in 1.6); further, it climbs the ridge and cuts into it." value={stream.distance} display={`${stream.distance.toFixed(1)}`} min={S.distance[0]} max={S.distance[1]} step={0.5} onChange={(v) => setStream({ distance: v })} />
      <Slider label="Pools" info="Pools at the sharpest bends, from 10 to 110 units downstream, at least 16 apart — fewer if there aren't that many bends." value={stream.pools} display={`${stream.pools}`} min={S.pools[0]} max={S.pools[1]} step={1} onChange={(v) => setStream({ pools: v })} />
      <h5 className="build-land-lines-head">Footpaths</h5>
      <Slider label="Paths" info="The main path from the western forest to the west building, its branch to the south-west, and a trail from the south-east to the east building. None ever runs between the buildings." value={paths.count} display={PATH_COUNT[paths.count]} min={P.count[0]} max={P.count[1]} step={1} onChange={(v) => setPaths({ count: v })} />
      <Slider label="Width" info="The paths' width, as a multiple of their tuned widths." value={paths.width} display={`${paths.width.toFixed(2)}×`} min={P.width[0]} max={P.width[1]} step={0.05} onChange={(v) => setPaths({ width: v })} />
      <Slider label="Slope avoidance" info="What steepness costs the route-finder (A*): a cell costs 1 + this × slope². Low, a path goes straight over the hollow's rim; high, it winds round to the gentle way." value={paths.slope} display={`${Math.round(paths.slope)}`} min={P.slope[0]} max={P.slope[1]} step={5} onChange={(v) => setPaths({ slope: v })} />
      <Slider label="Wear" info="How worn into the grass they are, as a multiple of the tuned wear." value={paths.wear} display={`${paths.wear.toFixed(2)}×`} min={P.wear[0]} max={P.wear[1]} step={0.05} onChange={(v) => setPaths({ wear: v })} />
      <button type="button" className="build-land-lines-reset" disabled={isDefault} onClick={reset}>
        Reset river and paths
      </button>
    </div>
  )
}
