import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { requireFirebase } from './config'

/**
 * users/{uid}/configs/{configId}.json
 *
 * The same path shape as the Firestore document, so one rule covers both and
 * the object is findable from the document id alone.
 */
export const configObjectPath = (uid: string, configId: string) =>
  `users/${uid}/configs/${configId}.json`

/**
 * Upload the configuration as a JSON blob and return its path.
 *
 * This is the assignment's Storage requirement, and it is deliberately NOT the
 * source of truth — Firestore is. The object is an export: a copy of the same
 * bytes `configToJson` produces for a download, so a configuration can leave
 * the app without going through the UI.
 *
 * Capturing the WebGL canvas was the obvious alternative and does not work
 * here: none of the renderers set `preserveDrawingBuffer`, so `toDataURL()`
 * returns a blank image, and turning it on costs a frame copy on every draw.
 */
export async function uploadConfigurationJson(
  uid: string,
  configId: string,
  json: string,
): Promise<string> {
  const { storage } = requireFirebase()
  const path = configObjectPath(uid, configId)
  const blob = new Blob([json], { type: 'application/json' })
  await uploadBytes(ref(storage, path), blob, { contentType: 'application/json' })
  return path
}

export async function getConfigurationJsonUrl(path: string): Promise<string> {
  const { storage } = requireFirebase()
  return getDownloadURL(ref(storage, path))
}

/** Best effort: a missing object is the desired end state, not a failure. */
export async function deleteConfigurationJson(path: string): Promise<void> {
  const { storage } = requireFirebase()
  try {
    await deleteObject(ref(storage, path))
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code !== 'storage/object-not-found') throw error
  }
}

/**
 * Storage has to be turned on in the console before any of the above works, and
 * for a new project that means attaching a billing account. Until then the
 * upload fails with a code that reads like a bug in the app, so it is named.
 */
export function describeStorageError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'storage/unknown':
    case 'storage/bucket-not-found':
    case 'storage/project-not-found':
      return 'Firebase Storage is not set up for this project. Enable it in the console, then try again.'
    case 'storage/unauthorized':
      return 'Storage rules rejected that upload.'
    case 'storage/unauthenticated':
      return 'You are signed out. Sign in and try again.'
    case 'storage/retry-limit-exceeded':
      return 'The upload timed out. Check your connection.'
    default:
      return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The export path that works without Storage: identical bytes, saved locally.
 * Kept here beside the upload so the two cannot drift apart.
 */
export function downloadJson(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
