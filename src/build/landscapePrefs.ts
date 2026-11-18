import { useCallback, useSyncExternalStore } from 'react'
import { DENSITIES, type Density } from './landscape'
import type { BuildGame } from './game'

/**
 * "Show decorations": a display preference, like Show Inhabitants — kept in
 * the browser, shared by Play and the Lab, never a change to a world. The
 * land's seed and density, by contrast, are saved with the world
 * (BuildGame.landscape), so changing them is a change.
 */

const KEY = 'wildform.show-decorations'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let current = typeof window === 'undefined' ? true : read()

export function useShowDecorations(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
    () => true,
  )
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

/** The next density round: Low → Medium → High → Low. */
export function nextDensity(d: Density): Density {
  return DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]
}

/** A new land for a game: a fresh random seed, keeping its density. Growth and the town are untouched. */
export function newLandscape(game: BuildGame) {
  game.setLandscape({ seed: Math.floor(Math.random() * 2 ** 31) })
}
