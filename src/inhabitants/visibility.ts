import { useCallback, useSyncExternalStore } from 'react'

/**
 * "Show Inhabitants": a display preference, not part of a world. Kept in the
 * browser (localStorage), shared by Play and the Lab, and never counted as a
 * change — so it never marks a world unsaved. Hiding hides the models; the
 * inhabitants carry on underneath.
 */

const KEY = 'wildform.show-inhabitants'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let current = typeof window === 'undefined' ? true : read()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Whether inhabitants are shown, and a setter; on by default. */
export function useShowInhabitants(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(subscribe, () => current, () => true)
  const set = useCallback((v: boolean) => {
    current = v
    try {
      window.localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      // Private mode or blocked storage: the choice holds for this visit.
    }
    for (const fn of listeners) fn()
  }, [])
  return [show, set]
}
