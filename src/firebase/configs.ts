import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore'
import { requireFirebase } from './config'
import {
  CONFIG_SCHEMA_VERSION,
  parseSettings,
  type VoxelConfig,
  type VoxelSettings,
} from '../config/voxelConfig'

/**
 * users/{uid}/configs/{configId}
 *
 * A subcollection under the owner rather than a top-level `configs` collection
 * with an ownerUid field. Both can be secured, but this way the uid is in the
 * path, so the rule is `request.auth.uid == uid` and a query can never be
 * written that spans two users by accident.
 */
const configsPath = (uid: string) => `users/${uid}/configs`

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

function toConfig(id: string, data: Record<string, unknown>): VoxelConfig {
  const { settings, repairs } = parseSettings(data.settings)
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : '(untitled)',
    topic: 'voxels',
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 0,
    ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : '',
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    storagePath: typeof data.storagePath === 'string' ? data.storagePath : undefined,
    settings,
    repairs,
  }
}

/**
 * Create or overwrite one configuration. Returns the id, which the caller needs
 * in order to name the Storage object after it.
 */
export async function saveConfiguration(
  uid: string,
  name: string,
  settings: VoxelSettings,
  existingId?: string,
): Promise<string> {
  const { db } = requireFirebase()
  const ref = existingId
    ? doc(db, configsPath(uid), existingId)
    : doc(collection(db, configsPath(uid)))

  const base = {
    name,
    topic: 'voxels' as const,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ownerUid: uid,
    updatedAt: serverTimestamp(),
    settings,
  }

  if (existingId) {
    // updateDoc, not setDoc. setDoc REPLACES the document, and `base` has no
    // createdAt — overwriting a saved configuration was silently deleting the
    // date it was first saved. updateDoc leaves untouched fields alone while
    // still replacing `settings` wholesale, which is what an overwrite means
    // here: a removed shape has to disappear, not merge back in.
    await updateDoc(ref, base)
  } else {
    await setDoc(ref, { ...base, createdAt: serverTimestamp() })
  }
  return ref.id
}

/** Recorded after the fact, because the object is named after the document id. */
export async function attachStoragePath(
  uid: string,
  configId: string,
  storagePath: string,
): Promise<void> {
  const { db } = requireFirebase()
  await updateDoc(doc(db, configsPath(uid), configId), { storagePath })
}

export async function listConfigurations(uid: string): Promise<VoxelConfig[]> {
  const { db } = requireFirebase()
  // Newest first. A document saved this moment has a null updatedAt until the
  // server timestamp resolves, and Firestore sorts those last on a descending
  // order, which is why the list is re-fetched after a save rather than
  // optimistically prepended.
  const snap = await getDocs(query(collection(db, configsPath(uid)), orderBy('updatedAt', 'desc')))
  return snap.docs.map((d) => toConfig(d.id, d.data()))
}

export async function loadConfiguration(uid: string, configId: string): Promise<VoxelConfig> {
  const { db } = requireFirebase()
  const snap = await getDoc(doc(db, configsPath(uid), configId))
  if (!snap.exists()) throw new Error('That configuration no longer exists.')
  return toConfig(snap.id, snap.data())
}

export async function deleteConfiguration(uid: string, configId: string): Promise<void> {
  const { db } = requireFirebase()
  await deleteDoc(doc(db, configsPath(uid), configId))
}

/**
 * Firestore codes are terse and two of them are routinely misread as bugs in
 * the app: `failed-precondition` usually means the database was never created,
 * and `permission-denied` means the rules rejected the write, not that the user
 * is signed out.
 */
export function describeFirestoreError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'permission-denied':
      return 'Firestore rules rejected that. Check the rules are deployed and you are signed in as the owner.'
    case 'failed-precondition':
      return 'Firestore is not ready — the database may not have been created for this project yet.'
    case 'unauthenticated':
      return 'You are signed out. Sign in and try again.'
    case 'unavailable':
      return 'Could not reach Firestore. Check your connection.'
    case 'not-found':
      return 'That configuration no longer exists.'
    default:
      return error instanceof Error ? error.message : String(error)
  }
}
