import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BuildViewport, DRAPER, type GameReport, type Tool } from '../build/BuildViewport'
import { DRAPER_SWATCH } from '../build/draperMesh'
import { BuildGame } from '../build/game'
import { BUDGET } from '../build/town'
import { WorldMenu, type WorldSession } from '../build/WorldMenu'
import { UnsavedDialog } from './UnsavedDialog'
import { WILD_SPECIES } from '../wildform/species'
import type { Route } from '../routes'
import { LOW_BLOCKS, MERGED, OPEN_WORLDS_KEY, narrate, plantLine, verdict } from './narrator'
import { lookAt } from './seasonLook'
import { MOOD_NORMAL, WARNING_STEPS, moodFace, moodScores, rainBadge, seasonAt, sunBadge, weatherAt } from './seasons'
import '../build/build.css'
import './game.css'

const TUTORIAL_KEY = 'wildform.game.tutorial-done'

const PLANTS = [
  { id: 0, name: 'Climber', arrow: '↑', swatch: WILD_SPECIES[0].look.swatch, hint: 'Goes up. Loves edges.' },
  { id: 1, name: 'Spreader', arrow: '↔', swatch: WILD_SPECIES[1].look.swatch, hint: 'Goes sideways. Loves sun.' },
  { id: DRAPER, name: 'Draper', arrow: '↓', swatch: DRAPER_SWATCH, hint: 'Hangs off edges. Very dramatic.' },
]

const SPEEDS = [1, 4, 16]

/** The guided opening: each beat waits for the player to do it. */
const BEATS = [
  {
    title: 'Mind the gap',
    text: 'Plants can stretch about five columns. These buildings are eight apart. Give them a stepping stone: pick Build and click the lawn between them.',
    done: (r: GameReport) => r.placed > 0,
  },
  {
    title: 'Plant a pair',
    text: 'Now pick a Climber and plant it on a wall facing the gap, then a Spreader right beside it. They grow best together.',
    done: (r: GameReport) => r.bySpecies[0] > 0 && r.bySpecies[1] > 0,
  },
  { title: 'Let them grow', text: 'Hit play and let them get to know each other.', done: (_r: GameReport, running: boolean) => running },
  { title: 'Wait for it…', text: 'Where they meet and pile up, something will grow. You can speed things up with the ⏩ button.', done: (r: GameReport) => r.structures > 0 },
]


type Toast = { id: number; text: string }

function safeGet(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private window or blocked storage: the tutorial just shows again next time.
  }
}

/**
 * Wildform, the game: Build's simulation, full-screen, with a HUD instead of
 * a sidebar and a voice instead of a log. Everything the player does goes
 * through the same BuildGame and BuildViewport as the Lab; only the
 * presentation is the game's.
 */
export function GamePage({ navigate }: { navigate: (route: Route) => void }) {
  const game = useMemo(() => new BuildGame(), [])
  const [tool, setTool] = useState<Tool>('build')
  const [species, setSpecies] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [revision, setRevision] = useState(0)
  const [report, setReport] = useState<GameReport | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [beat, setBeat] = useState(() => (safeGet(TUTORIAL_KEY) ? BEATS.length : 0))
  const [celebrate, setCelebrate] = useState(false)
  /** The seed counter's breakdown by plant, open or not. */
  const [seedsOpen, setSeedsOpen] = useState(false)
  const [initialBrowse] = useState(() => {
    try {
      const v = window.sessionStorage.getItem(OPEN_WORLDS_KEY) === '1'
      window.sessionStorage.removeItem(OPEN_WORLDS_KEY)
      return v
    } catch {
      return false
    }
  })
  const session = useRef<WorldSession | null>(null)
  /** The season whose weather is applied, and the season instance last warned about. */
  const appliedSeason = useRef(-1)
  const warnedFor = useRef(-1)
  const weatherBucket = useRef(-1)
  const onSession = useCallback((s: WorldSession) => {
    session.current = s
  }, [])
  /** The unsaved-changes warning, open for leaving or for a fresh lawn. */
  const [unsaved, setUnsaved] = useState<null | { action: 'leave' | 'fresh' }>(null)
  const leaveNow = useCallback(() => navigate({ section: 'project', page: 'play' }), [navigate])

  // The browser's Back, which used to leave with no warning. The game puts a
  // guard entry on the history; Back pops it, and lands here — where, if
  // there is anything to lose, the guard goes back on and the warning opens.
  // With nothing to lose, Back carries on as Back.
  useEffect(() => {
    const isGuard = () => (window.history.state as { wildformGame?: boolean } | null)?.wildformGame === true
    if (!isGuard()) window.history.pushState({ wildformGame: true }, '', window.location.pathname)
    const onPop = () => {
      if (isGuard()) return
      const s = session.current
      if (s?.dirty) {
        window.history.pushState({ wildformGame: true }, '', window.location.pathname)
        setUnsaved({ action: 'leave' })
      } else window.history.back()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // --- the voice: new log events, said playfully ---
  const seen = useRef<Set<string> | null>(null)
  const nextToast = useRef(0)
  const lastLeft = useRef(BUDGET)
  const wasMerged = useRef(false)
  const wasGoal = useRef(false)
  const say = useCallback((text: string) => {
    const id = nextToast.current++
    setToasts((t) => [...t.slice(-2), { id, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4800)
  }, [])

  const onReport = useCallback(
    (r: GameReport) => {
      setReport(r)
      const keys = r.events.map((e) => `${e.step}|${e.text}`)
      // The first report (a fresh or loaded world) says nothing about its history.
      if (!seen.current) {
        seen.current = new Set(keys)
        lastLeft.current = r.left
        wasMerged.current = r.merged
        wasGoal.current = r.goal
        return
      }
      r.events.forEach((e, k) => {
        if (seen.current!.has(keys[k])) return
        seen.current!.add(keys[k])
        // Climber and Spreader plantings get a line about the spot (onPlanted); the log's generic one would repeat it.
        if (/^(Climber|Spreader) planted$/.test(e.text)) return
        const line = narrate(e.text)
        if (line) say(line)
      })
      for (const n of [10, 3, 0]) if (lastLeft.current > n && r.left <= n && r.placed > 0) say(LOW_BLOCKS[n])
      lastLeft.current = r.left
      if (r.merged && !wasMerged.current) say(MERGED)
      wasMerged.current = r.merged
      if (r.goal && !wasGoal.current) {
        setCelebrate(true)
        setRunning(false)
        // Whatever beat the opening was on, the player has done the whole thing.
        setBeat(BEATS.length)
        safeSet(TUTORIAL_KEY, '1')
      }
      wasGoal.current = r.goal
    },
    [say],
  )

  /** A new or loaded world: paused, the voice starting over, the seasons picked up from its step. */
  const onReplaced = useCallback(() => {
    setRunning(false)
    setCelebrate(false)
    seen.current = null
    appliedSeason.current = -1
    weatherBucket.current = -1
    setRevision((v) => v + 1)
  }, [])

  // --- the seasons: weather from the step (seasons.ts) ---
  // Eased across each change (weatherAt), applied as growth advances, every
  // five steps while it is changing: a field update costs about 2.6 ms.
  const applyWeather = useCallback(
    (at: number) => {
      const bucket = Math.floor(at / 5)
      if (bucket === weatherBucket.current) return
      weatherBucket.current = bucket
      const w = weatherAt(at)
      const e = game.env
      if (Math.abs(e.rain - w.env.rain) < 1e-4 && Math.abs(e.sunAzimuth - w.env.sunAzimuth) < 1e-3 && Math.abs(game.warmth - w.warmth) < 1e-4) return
      game.setEnvironment(w.env, false)
      game.setWarmth(w.warmth)
    },
    [game],
  )
  const step = report?.step ?? 0
  const now = seasonAt(step)
  // Seeds planted: counted by the game at each successful planting (BuildGame.seeds), never by growth.
  const seeds = report?.seeds ?? game.seeds
  const seedTotal = seeds[0] + seeds[1] + seeds[2]
  // A world saved before seeds were counted shows what was planted since it was opened, as "n+".
  const seedsComplete = report?.seedsComplete ?? game.seedsComplete
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
  const seasonCount = Math.floor(step / 500)
  useEffect(() => {
    if (!report) return
    const { season, index, left, next } = seasonAt(report.step)
    const n = Math.floor(report.step / 500)
    if (index !== appliedSeason.current) {
      // A change of season during play is announced; picking up a world's season (fresh or loaded) is not.
      const announce = appliedSeason.current >= 0
      appliedSeason.current = index
      applyWeather(report.step)
      if (announce) say(season.arrives)
    } else if (left <= WARNING_STEPS && warnedFor.current !== n) {
      warnedFor.current = n
      say(next.coming)
    }
  }, [report, say, applyWeather])

  // How each plant feels about the conditions: recomputed when the season or the building changes.
  const moods = useMemo(() => {
    void seasonCount
    void revision
    const s = moodScores(game)
    return s.map((v, k) => moodFace(v, MOOD_NORMAL[k], game.warmth))
  }, [game, seasonCount, revision])

  // The tutorial advances as each beat is done.
  useEffect(() => {
    if (!report || beat >= BEATS.length) return
    if (BEATS[beat].done(report, running)) {
      const next = beat + 1
      queueMicrotask(() => setBeat(next))
      if (next >= BEATS.length) safeSet(TUTORIAL_KEY, '1')
    }
  }, [report, running, beat])

  const exit = () => {
    const s = session.current
    if (s?.dirty) setUnsaved({ action: 'leave' })
    else leaveNow()
  }
  const freshLawn = () => {
    const s = session.current
    if (s?.dirty) setUnsaved({ action: 'fresh' })
    else void s?.startNew(true)
  }

  const left = report?.left ?? BUDGET
  const steps = [
    { label: 'Plant', done: !!report && (report.bySpecies[0] + report.bySpecies[1] > 0 || report.drapers > 0) },
    { label: 'Sprout', done: (report?.structures ?? 0) > 0 },
    { label: 'Grow up', done: (report?.matured ?? 0) > 0 },
    { label: 'Hold hands', done: !!report?.joined },
  ]
  const pickPlant = (id: number) => {
    setSpecies(id)
    setTool('plant')
  }
  /** A planting, rated from the light and water where it went. */
  // The season you can see: leaves, lawn, sky, light and weather in the air, following the real rain.
  const look = useCallback((step: number) => lookAt(step, game.env.rain), [game])

  const onPlanted = useCallback(
    (sp: number, cell: number) => {
      const w = game.sim.world
      say(plantLine(sp, verdict(w.suitability[sp][cell], w.sun[cell], WILD_SPECIES[sp].lightPreference, w.moistureMatch[sp][cell])))
    },
    [game, say],
  )

  return (
    <div className="game">
      <BuildViewport game={game} tool={tool} species={species} running={running} speed={speed} stepToken={0} revision={revision} surfaceView="off" onPlanted={onPlanted} onAdvance={applyWeather} look={look} onReport={onReport} />

      <div className="game-top-left">
        <button type="button" className="game-chip" onClick={exit} aria-label="Leave the game">
          ← Wildform
        </button>
        <div className="game-season" aria-label="Season and weather">
          <p className="game-season-name">
            <span aria-hidden="true">{now.season.emoji}</span> {now.season.name} <span className="game-season-year">· Year {now.year}</span>
          </p>
          <p className="game-season-weather">
            <span>
              {rainBadge(game.env.rain).emoji} {rainBadge(game.env.rain).word}
            </span>
            <span>☀️ {sunBadge(game.env.sunAzimuth)}</span>
          </p>
          <p className="game-season-next">
            {now.next.emoji} {now.next.name} in {now.left.toLocaleString()} steps
          </p>
        </div>
      </div>

      <div className="game-objective" role="status">
        <p className="game-objective-title">{report?.goal ? 'They’re holding hands!' : 'Get these two buildings holding hands'}</p>
        <ol className="game-steps">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? 'is-done' : ''}>
              <span aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      <div className="game-top-right">
        <WorldMenu game={game} changes={report?.changes ?? game.changes} step={report?.step ?? game.sim.step} onReplaced={onReplaced} onSession={onSession} initialBrowse={initialBrowse} />
      </div>

      {beat < BEATS.length && !celebrate && (
        <div className="game-coach" role="dialog" aria-label={BEATS[beat].title}>
          <span className="game-coach-step">
            {beat + 1} / {BEATS.length}
          </span>
          <strong>{BEATS[beat].title}</strong>
          <p>{BEATS[beat].text}</p>
          <button
            type="button"
            onClick={() => {
              setBeat(BEATS.length)
              safeSet(TUTORIAL_KEY, '1')
            }}
          >
            I’ve got this
          </button>
        </div>
      )}

      <div className="game-toasts" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} className="game-toast">
            {t.text}
          </p>
        ))}
      </div>

      <div className="game-toolbar" role="toolbar" aria-label="Tools">
        <div className="game-group">
          <button type="button" className={`game-tool${tool === 'build' ? ' is-active' : ''}`} onClick={() => setTool('build')} title="Click the lawn or a block to add one. Right-click removes.">
            <span className="game-tool-icon" aria-hidden="true">▣</span>
            Build
          </button>
          <button type="button" className={`game-tool${tool === 'remove' ? ' is-active' : ''}`} onClick={() => setTool('remove')} title="Click one of your blocks to take it away.">
            <span className="game-tool-icon" aria-hidden="true">✕</span>
            Remove
          </button>
          <span className={`game-blocks${left <= 3 ? ' is-low' : ''}`} title="Blocks you can still place">
            <strong>{left}</strong> blocks
          </span>
        </div>
        <div className="game-group">
          {PLANTS.map((p, k) => (
            <button key={p.id} type="button" className={`game-tool is-plant${tool === 'plant' && species === p.id ? ' is-active' : ''}`} style={{ ['--plant' as string]: p.swatch }} onClick={() => pickPlant(p.id)} title={`${p.hint} Right now: ${moods[k].word}.`}>
              <span className="game-mood" aria-label={`${p.name} feels: ${moods[k].word}`}>{moods[k].face}</span>
              <span className="game-tool-icon" aria-hidden="true">{p.arrow}</span>
              {p.name}
            </button>
          ))}
          <div className="game-seeds-wrap">
            <button
              type="button"
              className="game-blocks game-seeds"
              aria-expanded={seedsOpen}
              onClick={() => setSeedsOpen((o) => !o)}
              title={`Seeds you’ve planted — Climber ${seeds[0]}, Spreader ${seeds[1]}, Draper ${seeds[2]}${seedsComplete ? '' : ' (since this world was opened)'}`}
            >
              <strong>
                {seedTotal}
                {!seedsComplete && '+'}
              </strong>
              {seedTotal === 1 && seedsComplete ? 'seed' : 'seeds'}
            </button>
            {seedsOpen && (
              <div className="game-seeds-pop" role="status">
                <p className="game-seeds-head">Seeds planted</p>
                {PLANTS.map((p, k) => (
                  <p key={p.id} className="game-seeds-row">
                    <i style={{ background: p.swatch }} aria-hidden="true" />
                    {p.name}
                    <strong>{seeds[k]}</strong>
                  </p>
                ))}
                {!seedsComplete && <p className="game-seeds-note">This world was saved before seeds were counted: these are the ones planted since you opened it.</p>}
              </div>
            )}
          </div>
        </div>
        <div className="game-group">
          <button type="button" className={`game-play${running ? ' is-running' : ''}`} onClick={() => setRunning((v) => !v)} aria-label={running ? 'Pause' : 'Play'}>
            {running ? '❚❚' : '▶'}
          </button>
          <button type="button" className="game-speed" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} title="Speed">
            ⏩ {speed}×
          </button>
        </div>
      </div>

      <p className="game-mouse">Drag to look around · right-drag to move · scroll to zoom</p>

      {celebrate && report && (
        <div className="game-celebrate" role="dialog" aria-label="Goal complete">
          <div>
            <p className="game-celebrate-kicker">Goal complete</p>
            <h2>They’re holding hands!</h2>
            <p className="game-celebrate-stats">
              {plural(report.placed, 'block', 'blocks')} used · {plural(seedTotal, 'seed', 'seeds')}
              {!seedsComplete && '+'} planted · Year {now.year}, {now.season.name}
            </p>
            <p>The plants did the rest.</p>
            <div className="game-celebrate-actions">
              <button type="button" className="is-primary" onClick={() => setCelebrate(false)}>
                Keep growing
              </button>
              <button
                type="button"
                onClick={freshLawn}
              >
                Try a fresh lawn
              </button>
            </div>
          </div>
        </div>
      )}

      {unsaved && (
        <UnsavedDialog
          current={() => session.current}
          action={unsaved.action}
          onStay={() => setUnsaved(null)}
          onGo={() => {
            const action = unsaved.action
            setUnsaved(null)
            if (action === 'leave') leaveNow()
            else {
              setCelebrate(false)
              void session.current?.startNew(true)
            }
          }}
        />
      )}
    </div>
  )
}
