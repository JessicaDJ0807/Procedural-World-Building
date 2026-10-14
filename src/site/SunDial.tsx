import { useMemo } from 'react'
import { SEASON_DAY, formatClock, formatDay, sunAtClock, sunTimes } from './sunClock'

/**
 * The sun the scene is lit by, as a path across the sky: azimuth across,
 * from east to west with south in the middle, and height up. The day showing
 * is the solid arc, with the June and December solstices faint behind it for
 * scale, and a dot where the sun is now.
 *
 * It says what the light is and, in a line, what it isn't: the shadows are
 * this one moment's, while the growth reads a whole day's sun hours, blended
 * from three traced days.
 */

const W = 216
const H = 96
const AZ0 = 45
const AZ1 = 315
const EL_MAX = 75
const x = (az: number) => 8 + ((az - AZ0) / (AZ1 - AZ0)) * (W - 16)
const y = (el: number) => H - 14 - (Math.max(el, 0) / EL_MAX) * (H - 24)

function arc(lat: number, lon: number, day: number): string {
  const t = sunTimes(lat, lon, day)
  const points: string[] = []
  for (let h = t.sunrise; h <= t.sunset + 1e-6; h += (t.sunset - t.sunrise) / 48) {
    const s = sunAtClock(lat, lon, day, h)
    points.push(`${x(s.azimuth).toFixed(1)},${y(s.elevation).toFixed(1)}`)
  }
  return points.join(' ')
}

const length = (hours: number) => `${Math.floor(hours)} h ${String(Math.round((hours % 1) * 60)).padStart(2, '0')} m`

export function SunDial({ lat, lon, day, hour, chosen }: { lat: number; lon: number; day: number; hour: number; chosen: boolean }) {
  const solstices = useMemo(() => [arc(lat, lon, SEASON_DAY.june), arc(lat, lon, SEASON_DAY.december)], [lat, lon])
  const today = useMemo(() => arc(lat, lon, day), [lat, lon, day])
  const times = sunTimes(lat, lon, day)
  const sun = sunAtClock(lat, lon, day, hour)
  const up = sun.elevation > 0
  return (
    <div className="site-sundial" aria-label="Sun path">
      <div className="site-sundial-head">
        <strong>{formatDay(day)}</strong> · {formatClock(hour)}
        <span className="site-sundial-mode">{chosen ? 'chosen' : 'follows growth'}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sun ${sun.elevation.toFixed(0)}° up, bearing ${sun.azimuth.toFixed(0)}°`}>
        <line className="site-sundial-horizon" x1={4} x2={W - 4} y1={y(0)} y2={y(0)} />
        {[90, 180, 270].map((az, i) => (
          <text key={az} x={x(az)} y={H - 2} textAnchor="middle">
            {'ESW'[i]}
          </text>
        ))}
        {solstices.map((p, i) => (
          <polyline key={i} className="site-sundial-solstice" points={p} />
        ))}
        <polyline className="site-sundial-today" points={today} />
        <circle className={up ? 'site-sundial-sun' : 'site-sundial-sun is-down'} cx={x(Math.min(AZ1, Math.max(AZ0, sun.azimuth)))} cy={y(sun.elevation)} r={5} />
      </svg>
      <div>
        {up ? `${sun.elevation.toFixed(0)}° up, bearing ${sun.azimuth.toFixed(0)}°` : 'Below the horizon'} · {length(times.length)} of day
        <br />
        Sunrise {formatClock(times.sunrise)} · sunset {formatClock(times.sunset)}
      </div>
      <div className="site-sundial-note">Shadows show this moment. Growth uses each day&apos;s hours of sun, blended from three traced days.</div>
    </div>
  )
}
