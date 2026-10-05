import { useEffect, useState } from 'react'
import { InfoTip } from './InfoTip'
import { useAuth } from './firebase/authContext'
import {
  attachStoragePath,
  deleteConfiguration,
  describeFirestoreError,
  listConfigurations,
  loadConfiguration,
  saveConfiguration,
} from './firebase/configs'
import {
  deleteConfigurationJson,
  describeStorageError,
  downloadJson,
  uploadConfigurationJson,
} from './firebase/storage'
import { configToJson, type VoxelConfig, type VoxelSettings } from './config/voxelConfig'
import { firebaseReady } from './firebase/config'

type ConfigPanelProps = {
  /** The current page state, already stripped to what is stored. */
  settings: VoxelSettings
  onLoad: (settings: VoxelSettings, repairs: string[]) => void
}

const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voxel-config'

export function ConfigPanel({ settings, onLoad }: ConfigPanelProps) {
  const { user, loading: authLoading } = useAuth()
  const [name, setName] = useState('')
  // Both the list and the "currently loaded" marker belong to one account, so
  // they are stored with the uid that produced them and read back only when it
  // still matches. Clearing them from an effect on sign-out would be the same
  // thing done a render later, and a cascading render at that.
  const [owned, setOwned] = useState<{ owner: string | null; configs: VoxelConfig[] }>({
    owner: null,
    configs: [],
  })
  const [active, setActive] = useState<{ owner: string | null; id: string | null }>({
    owner: null,
    id: null,
  })
  const [uploadJson, setUploadJson] = useState(false)

  const [reloadToken, setReloadToken] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const uid = user?.uid ?? null
  const configs = owned.owner === uid ? owned.configs : []
  const activeId = active.owner === uid ? active.id : null
  const setActiveId = (id: string | null) => setActive({ owner: uid, id })
  // Not yet fetched for this account — derived, so signing out cannot leave the
  // previous account's list on screen and no effect has to clear it.
  const listing = uid !== null && owned.owner !== uid

  // The fetch sets state only in the promise callback. A synchronous setState in
  // an effect body cascades a second render before the first has painted, which
  // react-hooks/set-state-in-effect rejects outright. Event handlers re-fetch by
  // bumping `reloadToken` rather than by calling a loader directly.
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listConfigurations(uid)
      .then((fetched) => {
        if (!cancelled) setOwned({ owner: uid, configs: fetched })
      })
      .catch((caught) => {
        if (cancelled) return
        setError(describeFirestoreError(caught))
        // Mark the fetch as settled even though it failed. `listing` is derived
        // from whether this account has been fetched, so leaving it unset left
        // "Loading saved configurations…" on screen permanently beneath the
        // error message.
        setOwned({ owner: uid, configs: [] })
      })
    return () => {
      cancelled = true
    }
  }, [uid, reloadToken])

  const refresh = () => setReloadToken((n) => n + 1)

  if (!firebaseReady) return null

  if (authLoading) return <p className="hint">Checking sign-in…</p>

  if (!uid) {
    return (
      <p className="hint">
        Sign in from the header to save this stack and load it back on another machine. Saved
        configurations are per-account.
      </p>
    )
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the configuration a name first.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const id = await saveConfiguration(uid, trimmed, settings, activeId ?? undefined)
      setActiveId(id)
      // A local flag, not the `error` state: setError does not update the value
      // captured by this closure, so reading it back here would always see null.
      let storageFailure: string | null = null
      let suffix = ''
      if (uploadJson) {
        // The Firestore write already succeeded, so an upload failure is a
        // partial success, not a rollback: report it and keep the save.
        try {
          const path = await uploadConfigurationJson(uid, id, configToJson(trimmed, settings))
          await attachStoragePath(uid, id, path)
          suffix = ' and uploaded as JSON'
        } catch (caught) {
          storageFailure = `Saved “${trimmed}”, but the JSON upload failed. ${describeStorageError(caught)}`
        }
      }
      if (storageFailure) setError(storageFailure)
      else setNotice(`Saved “${trimmed}”${suffix}.`)
      refresh()
    } catch (caught) {
      setError(describeFirestoreError(caught))
    } finally {
      setSaving(false)
    }
  }

  const load = async (config: VoxelConfig) => {
    setBusyId(config.id)
    setError(null)
    setNotice(null)
    try {
      const fresh = await loadConfiguration(uid, config.id)
      onLoad(fresh.settings, fresh.repairs)
      setName(fresh.name)
      setActiveId(fresh.id)
      setNotice(
        fresh.repairs.length > 0
          ? `Loaded “${fresh.name}” with ${fresh.repairs.length} field(s) reset: ${fresh.repairs.join('; ')}`
          : `Loaded “${fresh.name}”.`,
      )
    } catch (caught) {
      setError(describeFirestoreError(caught))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (config: VoxelConfig) => {
    setBusyId(config.id)
    setError(null)
    setNotice(null)
    try {
      if (config.storagePath) await deleteConfigurationJson(config.storagePath)
      await deleteConfiguration(uid, config.id)
      if (activeId === config.id) setActiveId(null)
      setNotice(`Deleted “${config.name}”.`)
      refresh()
    } catch (caught) {
      setError(describeFirestoreError(caught))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="config-panel">
      <label className="control">
        <span className="control-label">Name</span>
        <input
          type="text"
          className="text-input"
          value={name}
          maxLength={120}
          placeholder="Gorges with a cut sphere"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="control control-toggle">
        <span className="control-label">
          <InfoTip text="Also writes the configuration to Firebase Storage as a JSON object, alongside the Firestore document. Storage has to be enabled in the console first, which for a new project means attaching a billing account — until then this fails and the Firestore save still succeeds.">
            Upload JSON copy
          </InfoTip>
        </span>
        <input
          type="checkbox"
          checked={uploadJson}
          onChange={(event) => setUploadJson(event.target.checked)}
        />
      </label>

      <div className="button-row">
        <button type="button" className="reset-button" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : activeId ? 'Update' : 'Save'}
        </button>
        <button
          type="button"
          className="reset-button"
          onClick={() => downloadJson(`${slug(name)}.json`, configToJson(name.trim() || 'Untitled', settings))}
        >
          Download
        </button>
      </div>

      {activeId && (
        <p className="hint">
          Saving overwrites the loaded configuration. Clear the{' '}
          <button type="button" className="link-button" onClick={() => setActiveId(null)}>
            link to it
          </button>{' '}
          to save a copy instead.
        </p>
      )}

      {error && (
        <p className="config-error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && <p className="config-notice">{notice}</p>}

      {listing && configs.length === 0 ? (
        <p className="hint">Loading saved configurations…</p>
      ) : configs.length === 0 ? (
        <p className="hint">Nothing saved yet.</p>
      ) : (
        <ul className="config-list">
          {configs.map((config) => (
            <li key={config.id} className={`config-row${config.id === activeId ? ' is-active' : ''}`}>
              <div className="config-meta">
                <span className="config-name">{config.name}</span>
                <span className="config-sub">
                  {config.settings.nodes.length} shapes · {config.settings.resolution}³
                  {config.storagePath ? ' · JSON' : ''}
                  {config.updatedAt ? ` · ${config.updatedAt.toLocaleDateString()}` : ''}
                </span>
              </div>
              <div className="config-actions">
                <button
                  type="button"
                  disabled={busyId === config.id}
                  onClick={() => void load(config)}
                >
                  Load
                </button>
                <button
                  type="button"
                  disabled={busyId === config.id}
                  onClick={() => void remove(config)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
