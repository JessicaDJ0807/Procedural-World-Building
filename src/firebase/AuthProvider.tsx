import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { AuthContext, type AuthState } from './authContext'
import { auth, firebaseReady } from './config'

/**
 * The context and `useAuth` live in `authContext.ts` rather than here: Vite's
 * fast refresh only handles a module whose exports are all components, so a hook
 * exported alongside the provider would break hot reloading (and the lint rule
 * that guards it).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState['user']>(null)
  const [loading, setLoading] = useState(firebaseReady)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Without a configured project there is no session to wait for, so `loading`
    // starts false and the rest of the app stays usable.
    if (!auth) return

    // StrictMode mounts effects twice in development. onAuthStateChanged returns
    // its own unsubscribe, and returning it is what stops the first mount's
    // listener from outliving the unmount and firing into a dead component.
    const unsubscribe = onAuthStateChanged(
      auth,
      (next) => {
        setUser(next)
        setLoading(false)
        setError(null)
      },
      (listenerError) => {
        setError(listenerError.message)
        setLoading(false)
      },
    )
    return unsubscribe
  }, [])

  const value = useMemo<AuthState>(() => ({ user, loading, error }), [user, loading, error])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
