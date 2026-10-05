import { useEffect, useRef, useState } from 'react'
import { useAuth } from './firebase/authContext'
import {
  deleteConfiguration,
  describeFirestoreError,
  listConfigurations,
  renameConfiguration,
  saveConfiguration,
} from './firebase/configs'
import { deleteConfigurationJson, downloadJson } from './firebase/storage'
import { configToJson, type ConfigSpec } from './config/spec'
import type { SavedConfig } from './firebase/configs'
import { firebaseReady } from './firebase/config'

type ConfigPanelProps<S> = {
  /** The topic's saved-document contract: defaults, validation, summary line. */
  spec: ConfigSpec<S>
  /** The current page state, already stripped to what is stored. */
  settings: S
  onLoad: (settings: S, repairs: string[]) => void
}

const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voxel-config'

/** Coarse on purpose: the exact minute a world was saved is never the question. */
function savedAgo(date: Date | null): string {
  if (!date) return 'saving…'
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}

const sameSettings = <S,>(a: S, b: S) => JSON.stringify(a) === JSON.stringify(b)

export function ConfigPanel<S>({ spec, settings, onLoad }: ConfigPanelProps<S>) {
  const { user, loading: authLoading } = useAuth()

  // The list and the active marker belong to one account, so they are stored
  // with the uid that produced them and read back only while it still matches.
  // Clearing them from an effect on sign-out is the same thing a render later,
  // and a cascading render at that.
  const [owned, setOwned] = useState<{ owner: string | null; configs: SavedConfig<S>[] }>({
    owner: null,
    configs: [],
  })
  const [active, setActive] = useState<{
    owner: string | null
    id: string | null
    /** The settings as stored, to compare against for the unsaved marker. */
    snapshot: S | null
  }>({ owner: null, id: null, snapshot: null })

  const [reloadToken, setReloadToken] = useState(0)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uid = user?.uid ?? null
  const configs = owned.owner === uid ? owned.configs : []
  const activeId = active.owner === uid ? active.id : null
  const snapshot = active.owner === uid ? active.snapshot : null
  const listing = uid !== null && owned.owner !== uid
  const dirty = snapshot !== null && !sameSettings(settings, snapshot)

  const menuRef = useRef<HTMLDivElement | null>(null)

  // The fetch sets state only in the promise callback: a synchronous setState
  // in an effect body cascades a second render before the first has painted,
  // which react-hooks/set-state-in-effect rejects. Handlers re-fetch by bumping
  // reloadToken rather than calling a loader directly.
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listConfigurations(uid, spec)
      .then((fetched) => {
        if (!cancelled) setOwned({ owner: uid, configs: fetched })
      })
      .catch((caught) => {
        if (cancelled) return
        setError(describeFirestoreError(caught))
        // Mark the fetch settled even though it failed, or `listing` stays true
        // and the panel shows a loading line underneath the error forever.
        setOwned({ owner: uid, configs: [] })
      })
    return () => {
      cancelled = true
    }
  }, [uid, spec, reloadToken])

  useEffect(() => {
    if (!menuId) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuId])

  if (!firebaseReady) {
    return (
      <aside className="config-library" aria-label="Saved worlds">
        <div className="library-head">
          <h3 className="library-title">Worlds</h3>
        </div>
        <p className="library-note">
          Firebase is not configured, so nothing can be saved. Copy <code>.env.example</code> to{' '}
          <code>.env</code>.
        </p>
      </aside>
    )
  }

  if (authLoading || !uid) {
    return (
      <aside className="config-library" aria-label="Saved worlds">
        <div className="library-head">
          <h3 className="library-title">Worlds</h3>
        </div>
        <p className="library-note">
          {authLoading
            ? 'Checking sign-in…'
            : 'Sign in from the header to save a world and open it again later.'}
        </p>
      </aside>
    )
  }

  const refresh = () => setReloadToken((n) => n + 1)
  const setActiveFrom = (config: SavedConfig<S> | null) =>
    setActive({ owner: uid, id: config?.id ?? null, snapshot: config?.settings ?? null })

  const startNew = () => {
    setError(null)
    setMenuId(null)
    setActiveFrom(null)
    setDraftName('')
    onLoad(spec.defaults(), [])
  }

  // Straight from the list, with no second read. listConfigurations already
  // returns whole documents parsed by the same code path a per-document get
  // would use, so re-fetching bought nothing and put a network round trip in
  // front of every click on a row.
  const open = (config: SavedConfig<S>) => {
    if (config.id === activeId) return
    setError(null)
    setMenuId(null)
    onLoad(config.settings, config.repairs)
    setActiveFrom(config)
  }

  const save = async () => {
    const name = activeId
      ? (configs.find((c) => c.id === activeId)?.name ?? 'Untitled')
      : draftName.trim()
    if (!activeId && !name) {
      setError('Name the world before saving it.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const id = await saveConfiguration(uid, spec, name, settings, activeId ?? undefined)
      // Snapshot what was just written, so the unsaved marker clears without
      // waiting for the list to come back.
      setActive({ owner: uid, id, snapshot: settings })
      setDraftName('')
      refresh()
    } catch (caught) {
      setError(describeFirestoreError(caught))
    } finally {
      setSaving(false)
    }
  }

  const commitRename = async () => {
    if (!renaming) return
    const next = renaming.value.trim()
    const target = renaming.id
    setRenaming(null)
    if (!next) return
    setBusyId(target)
    setError(null)
    try {
      await renameConfiguration(uid, target, next)
      refresh()
    } catch (caught) {
      setError(describeFirestoreError(caught))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (config: SavedConfig<S>) => {
    setBusyId(config.id)
    setError(null)
    setMenuId(null)
    try {
      if (config.storagePath) await deleteConfigurationJson(config.storagePath)
      await deleteConfiguration(uid, config.id)
      if (activeId === config.id) setActiveFrom(null)
      refresh()
    } catch (caught) {
      setError(describeFirestoreError(caught))
    } finally {
      setBusyId(null)
    }
  }

  const exportName = activeId
    ? (configs.find((c) => c.id === activeId)?.name ?? 'Untitled')
    : draftName.trim() || 'Untitled'

  return (
    <aside className="config-library" aria-label="Saved worlds">
      <div className="library-head">
        <h3 className="library-title">Worlds</h3>
        <button type="button" className="library-new" onClick={startNew}>
          + New
        </button>
      </div>

      {error && (
        <p className="library-error" role="alert">
          {error}
        </p>
      )}

      <div className="library-list">
        {listing ? (
          <p className="library-note">Loading…</p>
        ) : configs.length === 0 ? (
          <p className="library-note">No saved worlds yet.</p>
        ) : (
          <ul>
            {configs.map((config) => {
              const isActive = config.id === activeId
              return (
                <li
                  key={config.id}
                  className={`world-row${isActive ? ' is-active' : ''}${
                    busyId === config.id ? ' is-busy' : ''
                  }`}
                >
                  {renaming?.id === config.id ? (
                    <input
                      type="text"
                      className="text-input world-rename"
                      value={renaming.value}
                      maxLength={120}
                      autoFocus
                      onChange={(event) => setRenaming({ id: config.id, value: event.target.value })}
                      onBlur={() => void commitRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRename()
                        if (event.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <>
                      {/* The whole row opens the world; only the menu is separate. */}
                      <button
                        type="button"
                        className="world-open"
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => open(config)}
                      >
                        <span className="world-name">
                          <span className="world-dot" aria-hidden="true" />
                          <span className="world-label" title={config.name}>
                            {config.name}
                          </span>
                          {isActive && dirty && <span className="world-dirty">• Unsaved</span>}
                        </span>
                        <span className="world-sub">
                          {spec.summary(config.settings)} · {savedAgo(config.updatedAt)}
                        </span>
                      </button>
                      <div className="world-menu-wrap" ref={menuId === config.id ? menuRef : null}>
                        <button
                          type="button"
                          className="world-menu-button"
                          aria-label={`More actions for ${config.name}`}
                          aria-expanded={menuId === config.id}
                          disabled={busyId === config.id}
                          onClick={() => setMenuId((id) => (id === config.id ? null : config.id))}
                        >
                          •••
                        </button>
                        {menuId === config.id && (
                          <div className="world-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuId(null)
                                setRenaming({ id: config.id, value: config.name })
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="is-destructive"
                              onClick={() => void remove(config)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="library-foot">
        {!activeId && (
          <input
            type="text"
            className="text-input"
            value={draftName}
            maxLength={120}
            placeholder="Name this world"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save()
            }}
          />
        )}
        <button
          type="button"
          className="library-save"
          disabled={saving || (activeId !== null && !dirty)}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : activeId ? (dirty ? 'Save changes' : 'Saved') : 'Save world'}
        </button>
        {/* An export, not a save — kept visually quieter so the two do not read
            as alternatives. */}
        <button
          type="button"
          className="library-export"
          onClick={() => downloadJson(`${slug(exportName)}.json`, configToJson(spec, exportName, settings))}
        >
          Export JSON
        </button>
      </div>
    </aside>
  )
}
