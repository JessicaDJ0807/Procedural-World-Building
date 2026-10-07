import { useState } from 'react'
import { NoiseLabPage } from './NoiseLabPage'
import { NoisePage } from './NoisePage'
import '../study/study.css'
import '../maplab/maplab.css'

type MapsView = 'lab' | 'workbench'

const VIEWS: { value: MapsView; label: string; hint: string }[] = [
  { value: 'lab', label: 'Lab', hint: 'Noise → shaping → terrain, one step at a time' },
  { value: 'workbench', label: 'Workbench', hint: 'The full stack: layers, automata, erosion, volume and planet' },
]

/**
 * Topic 2 is two views of one subject.
 *
 * The Lab came second, after the workbench had grown to thirty controls: it
 * shows what a noise function *is* and what each operation does to the ground,
 * which the workbench — built around one kind of noise and everything that can
 * happen afterwards — never made legible. The Lab is the front door; the
 * workbench is kept whole behind it rather than folded away, because its
 * measurements are what the rest of the course was built on.
 */
export function MapsPage() {
  const [view, setView] = useState<MapsView>('lab')
  // Mounted on first visit rather than up front. Mounted hidden, its canvases
  // measure a width of 0, and the map preview has no reason to repaint when it
  // is later shown — the first build of this page opened the workbench blank.
  // After that it stays mounted, so an erosion run survives a look at the Lab.
  const [workbenchOpened, setWorkbenchOpened] = useState(false)

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
            if (option.value === 'workbench') setWorkbenchOpened(true)
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
        <NoiseLabPage switcher={switcher} />
      </div>
      {workbenchOpened && (
        <div className="maps-view" hidden={view !== 'workbench'}>
          <NoisePage switcher={switcher} />
        </div>
      )}
    </>
  )
}
