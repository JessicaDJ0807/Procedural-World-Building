import { useState } from 'react'
import { describeAuthError, signInWithGoogle, signOutUser } from './firebase/auth'
import { useAuth } from './firebase/authContext'
import { firebaseReady, missingFirebaseKeys } from './firebase/config'

/**
 * Sign-in lives in the header because the saved configurations it unlocks are
 * per-topic: whichever page is open, the account is the same one.
 *
 * Note that focus mode (H) hides the whole nav, this included.
 */
export function AuthBar() {
  const { user, loading, error } = useAuth()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (caught) {
      setActionError(describeAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!firebaseReady) {
    return (
      <div className="auth-bar">
        <span className="auth-note" title={`Missing: ${missingFirebaseKeys.join(', ')}`}>
          Firebase not configured — copy <code>.env.example</code> to <code>.env</code>
        </span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="auth-bar">
        <span className="auth-note">Checking sign-in…</span>
      </div>
    )
  }

  return (
    <div className="auth-bar">
      {(actionError ?? error) && (
        // Ellipsised at 320px rather than allowed to push the tabs around; the
        // title carries the full text for anything longer.
        <span className="auth-error" role="alert" title={actionError ?? error ?? undefined}>
          {actionError ?? error}
        </span>
      )}

      {user ? (
        <>
          <span className="auth-user" title={user.email ?? undefined}>
            {user.displayName ?? user.email ?? 'Signed in'}
          </span>
          <button
            type="button"
            className="auth-button"
            disabled={busy}
            onClick={() => run(signOutUser)}
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          type="button"
          className="auth-button is-primary"
          disabled={busy}
          onClick={() => run(signInWithGoogle)}
        >
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
      )}
    </div>
  )
}
