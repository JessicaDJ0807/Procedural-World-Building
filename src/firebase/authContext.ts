import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'

export type AuthState = {
  /** null once resolved and signed out; only meaningful after `loading` clears. */
  user: User | null
  /** True until Firebase has restored (or ruled out) a persisted session. */
  loading: boolean
  /** A listener-level failure, surfaced rather than logged and forgotten. */
  error: string | null
}

export const AuthContext = createContext<AuthState>({ user: null, loading: true, error: null })

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
