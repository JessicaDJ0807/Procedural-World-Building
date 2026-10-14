import { SPECIES, SPECIES_IDS } from '../green/species'
import { SITE_SPECIES } from './siteLook'
import { STEPS_PER_YEAR, yearPhase, type HistoryPoint } from './campusSim'

const W = 268
const H = 92
const PAD = 4

/**
 * Coverage over the run, total and by species, sampled every 200 steps.
 *
 * Over a year the winters are shaded — 21 December to 20 March — because
 * that is where die-back shows: the vine's line dips each winter and the
 * total with it, and the dip is the season, not noise. On a fixed day there
 * are no seasons to shade.
 */
export function SiteHistory({ history, cycling }: { history: HistoryPoint[]; cycling: boolean }) {
  const last = history[history.length - 1].step || 1
  const x = (step: number) => PAD + (step / last) * (W - 2 * PAD)
  const y = (v: number) => H - PAD - v * (H - 2 * PAD)
  const line = (value: (p: HistoryPoint) => number) =>
    history.map((p, i) => `${i ? 'L' : 'M'}${x(p.step).toFixed(1)},${y(value(p)).toFixed(1)}`).join('')

  // Winter bands: the stretches whose phase falls in the first quarter of the year.
  const winters: [number, number][] = []
  if (cycling) {
    for (let s = 0; s < last; s += STEPS_PER_YEAR / 4) {
      if (yearPhase(s) < 0.25) winters.push([s, Math.min(last, s + STEPS_PER_YEAR / 4)])
    }
  }

  return (
    <figure className="site-history">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Coverage over the run, total and by species">
        {winters.map(([a, b]) => (
          <rect key={a} x={x(a)} y={PAD} width={Math.max(0, x(b) - x(a))} height={H - 2 * PAD} className="site-history-winter" />
        ))}
        {[0.25, 0.5, 0.75].map((v) => (
          <line key={v} x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)} className="site-history-grid" />
        ))}
        {SPECIES_IDS.map((id, k) => (
          <path key={id} d={line((p) => p.bySpecies[k] ?? 0)} fill="none" stroke={SITE_SPECIES[SPECIES_IDS.indexOf(id)].css} strokeWidth={1.4} />
        ))}
        <path d={line((p) => p.coverage)} fill="none" className="site-history-total" strokeWidth={1.6} />
      </svg>
      <figcaption className="hint">
        Covered, 0–100%, over {last.toLocaleString()} steps: <span className="site-history-key is-total" /> all
        {SPECIES_IDS.map((id) => (
          <span key={id}>
            {' '}
            <span className="site-history-key" style={{ background: SITE_SPECIES[SPECIES_IDS.indexOf(id)].css }} /> {SPECIES[id].name.toLowerCase()}
          </span>
        ))}
        {cycling && <>; winters shaded</>}
      </figcaption>
    </figure>
  )
}
