import { useState } from 'react'
import { BEHAVIOR_NAMES, type Inhabitant } from './agent'
import { GOALS, GOAL_NAMES, GOAL_TEXT, type Goal } from './mind'

/**
 * The inhabitant's mind, read straight off it: what it wants and what it is
 * doing, its needs against its nature, how it scored its goals the last time
 * it looked, and what it has done lately. Nothing here is computed for show —
 * the scores are the ones it last decided (or checked its plans) by.
 */

function Bar({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'need' | 'trait' | 'muted' }) {
  return (
    <div className={`mind-bar is-${tone ?? 'need'}`} title={hint}>
      <span className="mind-bar-label">{label}</span>
      <span className="mind-bar-track">
        <span className="mind-bar-fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </span>
      <span className="mind-bar-value">{value.toFixed(2)}</span>
    </div>
  )
}

/** What it wants (a goal) and how it is going about it (a state): two different things, side by side. */
export function GoalCard({ a, place }: { a: Inhabitant; place: string }) {
  return (
    <div className="mind-goal">
      <div>
        <span className="mind-kicker">Wants to</span>
        <strong>{a.sent ? 'Go where it was sent' : a.goal ? GOAL_NAMES[a.goal] : 'Decide'}</strong>
        <span className="mind-sub">{a.sent ? 'The studio sent it' : a.reason || 'Hasn’t chosen yet'}</span>
      </div>
      <div>
        <span className="mind-kicker">Is</span>
        <strong className={`is-${a.behavior}`}>{BEHAVIOR_NAMES[a.behavior]}</strong>
        <span className="mind-sub">{place ? `To ${place}` : a.why}</span>
      </div>
    </div>
  )
}

/** Needs, which change as it lives, against its nature, which never does. */
export function NeedsAndNature({ a }: { a: Inhabitant }) {
  return (
    <div className="mind-needs">
      <p className="mind-head">Needs <span>change as it lives</span></p>
      <Bar label="Energy" value={a.needs.energy} hint="Falls while it walks; rest brings it back." />
      <Bar label="Comfort" value={a.needs.comfort} hint="Follows how the place it stands feels: rain, cold, sun, cover." />
      <Bar label="Curiosity" value={a.needs.curiosity} hint="Builds while it stays put; new places satisfy it." />
      <p className="mind-head">Nature <span>never changes</span></p>
      <Bar label="Curious" value={a.traits.curiosity} tone="trait" hint="How strongly new places draw it." />
      <Bar label="Cautious" value={a.traits.caution} tone="trait" hint="How much it prefers the familiar and the near." />
      <Bar label="Sociable" value={a.traits.sociability} tone="muted" hint="Kept for later: nothing uses it yet." />
    </div>
  )
}

/** Its goals as it last scored them: each score, which it chose, and what pushed each up or down. */
export function Utilities({ a }: { a: Inhabitant }) {
  const [open, setOpen] = useState<Goal | null>(null)
  const d = a.decision
  if (!d) return <p className="mind-empty">It hasn’t weighed its options yet.</p>
  const shown = open ?? a.goal ?? d.chosen
  const top = Math.max(0.6, ...d.options.filter((o) => o.available).map((o) => o.score))
  const opt = d.options.find((o) => o.goal === shown)
  const ago = a.clock - a.decidedAt
  return (
    <div className="mind-utils">
      <ul>
        {GOALS.map((g) => {
          const o = d.options.find((x) => x.goal === g)!
          const chosen = a.goal === g && !a.sent
          return (
            <li key={g}>
              <button type="button" className={`mind-util${chosen ? ' is-chosen' : ''}${o.available ? '' : ' is-unavailable'}${shown === g ? ' is-open' : ''}`} onClick={() => setOpen(g)} title={GOAL_TEXT[g]}>
                <span className="mind-util-name">{GOAL_NAMES[g]}</span>
                {o.available ? (
                  <>
                    <span className="mind-util-track">
                      <span style={{ width: `${Math.max(0, (o.score / top) * 100)}%` }} />
                    </span>
                    <span className="mind-util-score">{o.score.toFixed(2)}</span>
                  </>
                ) : (
                  <span className="mind-util-none">Not possible — {o.unavailable}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {opt && (
        <div className="mind-factors">
          <p>
            <strong>{GOAL_NAMES[opt.goal]}</strong> {opt.available && opt.place ? `· best place: ${opt.place}` : ''}
          </p>
          {opt.available ? (
            <ul>
              {opt.factors
                .filter((f) => Math.abs(f.value) >= 0.005)
                .map((f) => (
                  <li key={f.label} className={f.value >= 0 ? 'is-up' : 'is-down'}>
                    <span>{f.label}</span>
                    <span>{f.value >= 0 ? '+' : '−'}{Math.abs(f.value).toFixed(2)}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mind-empty">Not scored: {opt.unavailable}.</p>
          )}
        </div>
      )}
      <p className="mind-note">
        Scored {ago < 0.5 ? 'just now' : `${ago.toFixed(1)} s ago`}
        {!a.sent && a.goal && d.chosen && d.chosen !== a.goal ? ` · would now choose ${GOAL_NAMES[d.chosen]}, but keeps to ${GOAL_NAMES[a.goal]} until it’s done or something is clearly more urgent` : ''}
      </p>
    </div>
  )
}

/** What it has done lately: changes of goal and of state, as they happened. */
export function History({ a }: { a: Inhabitant }) {
  const items = a.log.slice(-12).reverse()
  if (!items.length) return <p className="mind-empty">Nothing yet.</p>
  return (
    <ol className="mind-log">
      {items.map((e, k) => (
        <li key={`${e.at}-${k}`} className={`is-${e.kind}`}>
          <span className="mind-log-at">{e.at.toFixed(0)} s</span>
          <span>{e.text}</span>
        </li>
      ))}
    </ol>
  )
}
