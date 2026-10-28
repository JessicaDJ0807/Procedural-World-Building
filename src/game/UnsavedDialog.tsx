import { useEffect, useRef, useState } from 'react'
import type { WorldSession } from '../build/WorldMenu'
import { MAX_NAME, validName } from '../firebase/worlds'
import { describeAuthError, signInWithGoogle } from '../firebase/auth'
import { useAuth } from '../firebase/authContext'

/**
 * The game's warning before unsaved work is lost: leaving (the ← chip or the
 * browser's Back) or starting a fresh lawn.
 *
 * The world menu has its own confirmation, but it lives inside the menu, and
 * at phone width the game hides the menu — so the menu's dialog opened
 * invisibly, made the page inert, and the player was stuck. This one belongs
 * to the game and shows at every width. What counts as unsaved is still the
 * menu's (its session): the player's own changes, or 200 steps of growth.
 *
 * Keep playing is the default — Esc, or clicking it. Save and leave saves in
 * place: to the world's own record, or under a name typed here if it has
 * none. Signed out, it offers to sign in right here — the game has no site
 * bar to sign in from, and the menu's "Sign in (top right)" pointed at
 * nothing. If saving isn't possible at all, it says why and offers only the
 * other two.
 *
 * The session is read live (`current`), not kept from when the dialog
 * opened: after signing in, saving has to use the signed-in session.
 */
export function UnsavedDialog({ current, action, onStay, onGo }: { current: () => WorldSession | null; action: 'leave' | 'fresh'; onStay: () => void; onGo: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  // Re-render when sign-in changes; the menu publishes its new session just after, hence the bump.
  useAuth()
  const [, bump] = useState(0)
  const [signingIn, setSigningIn] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const session = current()
  if (!session) return null
  const named = !!session.id
  const problem = named ? null : validName(name)
  const leave = action === 'leave'
  const signIn = async () => {
    setSigningIn(true)
    setAuthError(null)
    try {
      await signInWithGoogle()
      window.setTimeout(() => bump((n) => n + 1), 60)
    } catch (e) {
      setAuthError(describeAuthError(e))
    } finally {
      setSigningIn(false)
    }
  }
  const save = async () => {
    setTouched(true)
    if (problem) return
    setBusy(true)
    setFailed(false)
    const ok = await session.save(named ? undefined : name.trim())
    setBusy(false)
    if (ok) onGo()
    else setFailed(true)
  }

  return (
    <dialog
      ref={ref}
      className="game-unsaved"
      aria-labelledby="game-unsaved-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onStay()
      }}
    >
      <p className="game-celebrate-kicker">Unsaved changes</p>
      <h2 id="game-unsaved-title">{leave ? 'Leave without saving?' : 'Start fresh without saving?'}</h2>
      <p>
        {session.edited
          ? `“${session.name}” has changes you haven’t saved.`
          : `“${session.name}” has grown ${session.grown.toLocaleString()} steps since you saved it.`}{' '}
        {leave ? 'If you leave now, ' : 'If you start over, '}
        {session.edited ? 'they’re gone.' : 'that growth is gone.'}
      </p>
      {session.signedOut ? (
        <p className="game-unsaved-note">
          You’re not signed in, so this world can’t be saved yet.{' '}
          <button type="button" className="game-unsaved-link" onClick={() => void signIn()} disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Sign in with Google to save it'}
          </button>
          {authError && <span className="is-error"> {authError}</span>}
        </p>
      ) : session.blocked ? (
        <p className="game-unsaved-note">{session.blocked}</p>
      ) : (
        !named && (
          <label className="game-unsaved-name">
            <span>Name it to save</span>
            <input
              value={name}
              maxLength={MAX_NAME + 20}
              placeholder="Hanging Garden 01"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
            {touched && problem && <em>{problem}</em>}
          </label>
        )
      )}
      {failed && <p className="game-unsaved-note is-error">Couldn’t save — your world is still here. Try again, or keep playing.</p>}
      <div className="game-celebrate-actions">
        <button type="button" className="is-primary" autoFocus onClick={onStay} disabled={busy}>
          Keep playing
        </button>
        {!session.blocked && (
          <button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : leave ? 'Save and leave' : 'Save, then start fresh'}
          </button>
        )}
        <button type="button" className="is-danger" onClick={onGo} disabled={busy}>
          {leave ? 'Leave without saving' : 'Start fresh anyway'}
        </button>
      </div>
    </dialog>
  )
}
