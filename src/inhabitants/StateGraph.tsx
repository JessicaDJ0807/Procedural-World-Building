import { BEHAVIORS, BEHAVIOR_NAMES, TRANSITIONS, type Behavior, type Transition } from './agent'

/**
 * The inhabitants' state machine, drawn from `TRANSITIONS` — the same table
 * every state change is checked against (agent.ts). Nodes are its states;
 * every edge is a row of the table, and a row from any state (`*`) is drawn
 * from an "any state" node. Only where the nodes stand is set here: a state
 * or transition added to the table appears without touching this file, and
 * one that isn't in the table can't be drawn.
 *
 * The inhabitant's current state is filled; the edge it last crossed flashes
 * (re-keyed on each change, so its animation restarts); a selected state's
 * edges are drawn strong and the rest faded.
 */

type Pos = { x: number; y: number }
const W = 660
const H = 360
const NODE_W = 112
const NODE_H = 34
const ANY = 'any' as const

/** Where each state stands. Typed by `Behavior`: a new state without a place is a type error, not a missing node. */
const LAYOUT: Record<Behavior | typeof ANY, Pos> = {
  exploring: { x: 110, y: 70 },
  discovering: { x: 330, y: 44 },
  travelling: { x: 550, y: 82 },
  idle: { x: 330, y: 182 },
  resting: { x: 560, y: 220 },
  observing: { x: 470, y: 320 },
  'no-route': { x: 110, y: 320 },
  stranded: { x: 300, y: 320 },
  any: { x: 96, y: 196 },
}

/** Where a line from a node's centre toward a point leaves its box. */
function rim(c: Pos, toward: Pos, pad = 3): Pos {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  const sx = Math.abs(dx) / (NODE_W / 2 + pad)
  const sy = Math.abs(dy) / (NODE_H / 2 + pad)
  const k = 1 / Math.max(sx, sy, 1e-6)
  return { x: c.x + dx * k, y: c.y + dy * k }
}

/** A curved edge; bowed to one side when the reverse edge also exists, so the two don't overlap. */
function edgePath(t: Transition, both: boolean) {
  const a = LAYOUT[t.from === '*' ? ANY : t.from]
  const b = LAYOUT[t.to]
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1
  const bow = both ? 22 : 8
  const c = { x: mx - (dy / l) * bow, y: my + (dx / l) * bow }
  const p0 = rim(a, c)
  const p1 = rim(b, c, 6)
  return { d: `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`, mid: { x: (p0.x + 2 * c.x + p1.x) / 4, y: (p0.y + 2 * c.y + p1.y) / 4 } }
}

const key = (t: Transition) => `${t.from}>${t.to}`

export function StateGraph({
  current,
  last,
  lastKey,
  selected,
  onSelect,
}: {
  /** The inhabitant's state, if one is shown. */
  current: Behavior | null
  /** The transition it last made, and something that changes each time it makes one. */
  last: { from: Behavior; to: Behavior } | null
  lastKey: number
  selected: Behavior | null
  onSelect: (b: Behavior | null) => void
}) {
  const has = (from: Behavior | '*', to: Behavior) => TRANSITIONS.some((t) => t.from === from && t.to === to)
  // The row it last took: its own state's, or the from-any row if that's how it got there.
  const lastRow = last ? (TRANSITIONS.find((t) => t.from === last.from && t.to === last.to) ?? TRANSITIONS.find((t) => t.from === '*' && t.to === last.to)) : undefined
  const involved = (t: Transition) => !selected || t.to === selected || t.from === selected
  return (
    <svg className="fsm" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The inhabitants' state machine: states and the transitions between them">
      <defs>
        <marker id="fsm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fsm-arrowhead" />
        </marker>
        <marker id="fsm-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fsm-arrowhead is-hot" />
        </marker>
      </defs>
      {TRANSITIONS.map((t) => {
        const from = t.from === '*' ? null : t.from
        const { d } = edgePath(t, !!from && has(t.to, from))
        const hot = lastRow === t
        return (
          <path
            key={hot ? `${key(t)}#${lastKey}` : key(t)}
            d={d}
            className={`fsm-edge${t.command ? ' is-command' : ''}${t.from === '*' ? ' is-any' : ''}${involved(t) ? '' : ' is-faded'}${hot ? ' is-hot' : ''}`}
            markerEnd={hot ? 'url(#fsm-arrow-hot)' : 'url(#fsm-arrow)'}
          >
            <title>{`${t.from === '*' ? 'Any state' : BEHAVIOR_NAMES[t.from]} → ${BEHAVIOR_NAMES[t.to]}: ${t.when}`}</title>
          </path>
        )
      })}
      <g className="fsm-node is-any" transform={`translate(${LAYOUT.any.x},${LAYOUT.any.y})`}>
        <rect x={-48} y={-14} width={96} height={28} rx={14} />
        <text y={4}>any state</text>
      </g>
      {BEHAVIORS.map((b) => {
        const p = LAYOUT[b]
        return (
          <g
            key={b}
            className={`fsm-node${current === b ? ' is-current' : ''}${selected === b ? ' is-selected' : ''}${b === 'no-route' || b === 'stranded' ? ' is-trouble' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            role="button"
            tabIndex={0}
            aria-pressed={selected === b}
            aria-label={`${BEHAVIOR_NAMES[b]}${current === b ? ' (current)' : ''}`}
            onClick={() => onSelect(selected === b ? null : b)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(selected === b ? null : b))}
          >
            <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={10} />
            <text y={5}>{BEHAVIOR_NAMES[b]}</text>
          </g>
        )
      })}
    </svg>
  )
}
