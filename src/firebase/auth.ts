import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { requireFirebase } from './config'

const provider = new GoogleAuthProvider()

/**
 * Popup rather than redirect: a redirect unmounts the whole app and returns to a
 * fresh page, which on this page would throw away the voxel stack the user was
 * editing. The cost is that the popup needs the origin listed under
 * Authentication → Settings → Authorized domains (localhost already is).
 */
export async function signInWithGoogle(): Promise<void> {
  const { auth } = requireFirebase()
  await signInWithPopup(auth, provider)
}

export async function signOutUser(): Promise<void> {
  const { auth } = requireFirebase()
  await signOut(auth)
}

/**
 * Firebase error codes read as `auth/popup-closed-by-user`. Worth translating
 * the ones a user causes on purpose, so a cancelled sign-in does not look like
 * a fault. Anything unrecognised is shown as-is rather than hidden.
 */
export function describeAuthError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in cancelled.'
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by the browser.'
    case 'auth/unauthorized-domain':
      return 'This origin is not in the Firebase authorized domains list.'
    // Two codes for one cause: the SDK reports the second when the key reaches
    // Google and is rejected there, which is what a wrong .env actually produces.
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'VITE_FIREBASE_API_KEY is not valid for this project.'
    default:
      return error instanceof Error ? error.message : String(error)
  }
}
