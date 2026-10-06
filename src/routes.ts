import { useCallback, useEffect, useState } from 'react'

/**
 * Where you are in the app, and how that maps to a URL.
 *
 * Two top-level sections rather than one list of pages. The Playground is where
 * a technique gets taken apart — every parameter exposed, every metric on
 * screen. The Project is where the techniques are put back together and shown.
 * They want opposite things from a UI, which is why they are separated here
 * rather than being seven tabs in a row.
 *
 * ## Why no router
 *
 * Seven static destinations, no route parameters, no nested data loading, no
 * code splitting. react-router-dom 7.18.4 bundles to 42,538 bytes minified
 * (15,235 gzipped) for the handful of exports this would need — 3.6% on top of
 * the app's 425 KB gzipped bundle, for a feature set that is almost entirely
 * about the cases this app does not have. The History API covers what is
 * actually needed in the ~40 lines below, and a reader of this notebook can see
 * all of it. If this ever grows route parameters or per-route data, that is the
 * point to reconsider.
 */
export type Section = 'playground' | 'project'

export type PlaygroundId = 'objects' | 'maps' | 'voxels' | 'shaders'
export type ProjectId = 'overview' | 'demo' | 'explore' | 'progress'

export type Route =
  | { section: 'playground'; page: PlaygroundId }
  | { section: 'project'; page: ProjectId }

/**
 * One entry per topic, newest last.
 *
 * Topics rather than weeks: the course meets weekly but not every week
 * produces a page — some are lectures — so a "Week 3" label would drift
 * further from the calendar with every gap, and numbering it honestly would
 * mean leaving holes. A topic is the unit of work, and it never has gaps.
 */
export const PLAYGROUND: { id: PlaygroundId; topic: string; title: string }[] = [
  { id: 'objects', topic: 'Topic 1', title: 'Objects' },
  { id: 'maps', topic: 'Topic 2', title: 'Maps' },
  { id: 'voxels', topic: 'Topic 3', title: 'Voxels' },
  { id: 'shaders', topic: 'Topic 4', title: 'Shaders' },
]

/** Project pages carry no topic number — the project is not Topic 5. */
export const PROJECT: { id: ProjectId; title: string; blurb: string }[] = [
  { id: 'overview', title: 'Overview', blurb: 'What the project is and which systems build it' },
  { id: 'demo', title: 'Demo', blurb: 'The integrated world, with the controls that matter' },
  { id: 'explore', title: 'Explore', blurb: 'Three worlds you can walk around in' },
  { id: 'progress', title: 'Progress', blurb: 'How each experiment feeds the project' },
]

export const SECTIONS: { id: Section; title: string; hint: string }[] = [
  { id: 'playground', title: 'Playground', hint: 'Take a technique apart' },
  { id: 'project', title: 'Project', hint: 'Put the techniques together' },
]

/** Clicking "Playground" opens its newest topic, matching the old shell. */
export const DEFAULT_PLAYGROUND: Route = {
  section: 'playground',
  page: PLAYGROUND[PLAYGROUND.length - 1].id,
}

export const DEFAULT_PROJECT: Route = { section: 'project', page: 'overview' }

/**
 * `/` lands on the project, not on a topic.
 *
 * The app has a front door now, and "what am I building" is the right thing
 * behind it — a visitor who follows a bare link should not arrive in the middle
 * of a shader study. Change this one constant to land on a topic instead.
 */
export const HOME: Route = DEFAULT_PROJECT

export function toPath(route: Route): string {
  if (route.section === 'playground') return `/playground/${route.page}`
  // Overview is the section root, so /project is a real address rather than a
  // redirect to /project/overview.
  return route.page === 'overview' ? '/project' : `/project/${route.page}`
}

/** Anything unrecognised is HOME — a bad path is not worth an error page. */
export function parsePath(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'playground') {
    const page = PLAYGROUND.find((entry) => entry.id === parts[1])
    return page ? { section: 'playground', page: page.id } : DEFAULT_PLAYGROUND
  }
  if (parts[0] === 'project') {
    if (parts.length === 1) return DEFAULT_PROJECT
    const page = PROJECT.find((entry) => entry.id === parts[1])
    return page ? { section: 'project', page: page.id } : DEFAULT_PROJECT
  }
  return HOME
}

export const sameRoute = (a: Route, b: Route) => a.section === b.section && a.page === b.page

/**
 * The route, and a setter that moves the address bar with it.
 *
 * `popstate` fires for back and forward but never for `pushState`, so the two
 * halves do not fight: the setter updates both, the listener updates only
 * state. A push to the address already shown is dropped, so clicking the
 * active tab does not stack duplicate history entries to walk back through.
 */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname))

  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route) => {
    const path = toPath(next)
    if (path !== window.location.pathname) window.history.pushState(null, '', path)
    setRoute(next)
  }, [])

  return [route, navigate]
}
