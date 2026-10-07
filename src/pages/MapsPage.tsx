import { useMemo, useState } from 'react'
import { NoiseLabPage } from './NoiseLabPage'
import { NoisePage } from './NoisePage'
import { DEFAULT_LAB, generateLab, type LabSettings } from '../maplab/noiseLab'
import '../study/study.css'
import '../maplab/maplab.css'

type MapsView = 'lab' | 'simulate'

const VIEWS: { value: MapsView; label: string; hint: string }[] = [
  { value: 'lab', label: 'Noise', hint: 'What a point is: noise, shaping, warp — computed per point, in one pass' },
  { value: 'simulate', label: 'Simulate', hint: 'What happens to the ground: automata and erosion — neighbours, over time' },
]

/**
 * Topic 2 is two stages of one pipeline: noise → shape → simulate.
 *
 * The split is by kind of operation, not by feature. Everything in the Noise tab is
 * f(x): a point's value depends on its own coordinates and nothing else, and
 * is computed once. Everything in Simulate is f(x, neighbours), repeated —
 * the automaton votes with its block, a droplet carries material from one cell
 * to another — so it has Play, Step and Reset, and the Noise tab never does.
 *
 * Simulate erodes the Noise tab's field by default. The layered value-noise stack
 * the page began with is still there as its other source, because the
 * chapter's measurements were taken on it and should stay reproducible.
 */
export function MapsPage() {
  const [view, setView] = useState<MapsView>('lab')
  // Mounted on first visit rather than up front. Mounted hidden, its canvases
  // measure a width of 0, and the map preview has no reason to repaint when it
  // is later shown — the first build of this page opened it blank. After that
  // it stays mounted, so an erosion run survives a look at the Noise tab.
  const [simulateOpened, setSimulateOpened] = useState(false)
  // Lifted out of the Noise tab so both tabs read one field, generated once.
  const [lab, setLab] = useState<LabSettings>(DEFAULT_LAB)
  const labField = useMemo(() => generateLab(lab), [lab])

  const switcher = (
    <div className="segmented maps-switch" role="tablist" aria-label="Topic 2 view">
      {VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={view === option.value}
          className={`segmented-option${view === option.value ? ' is-active' : ''}`}
          title={option.hint}
          onClick={() => {
            setView(option.value)
            if (option.value === 'simulate') setSimulateOpened(true)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <div className="maps-view" hidden={view !== 'lab'}>
        <NoiseLabPage switcher={switcher} settings={lab} setSettings={setLab} field={labField} />
      </div>
      {simulateOpened && (
        <div className="maps-view" hidden={view !== 'simulate'}>
          <NoisePage switcher={switcher} lab={lab} labField={labField} onLabLoad={setLab} />
        </div>
      )}
    </>
  )
}
