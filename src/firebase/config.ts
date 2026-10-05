import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

/**
 * The six values Vite inlines from `.env` at build time. Copy `.env.example`
 * and fill them from the Firebase console (Project settings → Your apps).
 *
 * These are not secrets — they ship in the bundle by design, and a web API key
 * only identifies the project. What actually protects the data is the Firestore
 * and Storage rules, which pin every document to its owner's uid.
 */
const VARS = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
} as const

const ENV_NAMES: Record<keyof typeof VARS, string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
}

/** Names only — never the values, which would put credentials in the console. */
export const missingFirebaseKeys: string[] = (
  Object.keys(VARS) as (keyof typeof VARS)[]
).filter((key) => !VARS[key]).map((key) => ENV_NAMES[key])

export const firebaseReady = missingFirebaseKeys.length === 0

// Initialising with undefined values does not throw here — it fails later, at
// sign-in, with an opaque `auth/invalid-api-key`. Topics 1 and 2 have nothing to
// do with Firebase, so a missing .env must not break them: skip init entirely
// and let AuthBar say so. getApps() is the HMR guard — Vite re-executes this
// module on edit, and a second initializeApp would throw `app/duplicate-app`.
const app: FirebaseApp | null = firebaseReady
  ? getApps().length > 0
    ? getApp()
    : initializeApp(VARS)
  : null

export const auth: Auth | null = app ? getAuth(app) : null
export const db: Firestore | null = app ? getFirestore(app) : null
export const storage: FirebaseStorage | null = app ? getStorage(app) : null

/**
 * For call sites that cannot proceed without Firebase. Throws a message worth
 * showing the user rather than letting an undefined slip further in.
 */
export function requireFirebase(): { auth: Auth; db: Firestore; storage: FirebaseStorage } {
  if (!auth || !db || !storage) {
    throw new Error(
      `Firebase is not configured. Copy .env.example to .env and set: ${missingFirebaseKeys.join(', ')}`,
    )
  }
  return { auth, db, storage }
}

export { app }
