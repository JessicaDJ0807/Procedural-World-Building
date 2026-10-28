import type { Route } from '../routes'
import { GAME } from '../routes'
import { OPEN_WORLDS_KEY } from './narrator'
import './game.css'

const HOW = [
  { n: '1', title: 'Build a little', text: 'Thirty blocks. Place them where the plants will need a leg up.' },
  { n: '2', title: 'Plant a lot', text: 'Climbers go up, Spreaders go sideways, Drapers hang around. Mix them.' },
  { n: '3', title: 'Let it grow', text: 'Where plants meet and pile up, they grow bridges, balconies, towers. You don’t get to choose which.' },
]

/**
 * The game's front door, in the Project tabs: the premise in a line, Play,
 * Continue a saved world, and the way to the Lab. The game itself opens
 * full-screen at /play.
 */
export function PlayPage({ navigate }: { navigate: (route: Route) => void }) {
  const play = (worlds: boolean) => {
    try {
      if (worlds) window.sessionStorage.setItem(OPEN_WORLDS_KEY, '1')
    } catch {
      // Storage blocked: the game opens on a fresh lawn instead.
    }
    navigate(GAME)
  }
  return (
    <div className="play-page">
      <section className="play-hero">
        {/* Framed for this banner: the world on the right, open sky and lawn on the left for the text. */}
        <img src="/project/play-hero.jpg" alt="" />
        <div className="play-hero-text">
          <h1 className="game-display">Wildform</h1>
          <p className="play-premise">Two buildings that won’t talk to each other. Time to send in the plants.</p>
          <div className="play-actions">
            <button type="button" className="play-button is-primary" onClick={() => play(false)}>
              Play
            </button>
            <button type="button" className="play-button" onClick={() => play(true)}>
              Continue a saved world
            </button>
          </div>
        </div>
      </section>
      <section className="play-how" aria-label="How to play">
        {HOW.map((h) => (
          <div key={h.n}>
            <span className="game-display play-how-n">{h.n}</span>
            <strong className="game-display">{h.title}</strong>
            <p>{h.text}</p>
          </div>
        ))}
      </section>
      <p className="play-lab">
        Want every dial and number? The <button type="button" onClick={() => navigate({ section: 'project', page: 'build' })}>Lab</button> is the same game with the hood up.
      </p>
    </div>
  )
}
