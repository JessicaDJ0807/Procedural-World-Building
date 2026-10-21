import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { firebaseReady } from '../firebase/config'
import { useAuth } from '../firebase/authContext'
import { describeFirestoreError } from '../firebase/configs'
import { MAX_NAME, copyName, firestoreWorlds, validName, type WorldListing, type WorldsApi } from '../firebase/worlds'
import type { BuildGame } from './game'
import { WorldFormatError, deserializeWorld, serializeWorld } from './worldState'

/**
 * Saving and opening Wildform worlds, from the top of the Build sidebar.
 *
 * One line — the world's name, a dot when it has unsaved changes, Save, and a
 * Worlds menu (New world, Save as…, My worlds…) — and dialogs for the rest.
 * The state that matters lives in `useWorldSession`: which saved world this
 * is (if any), and the game's change count when it was last saved, so
 * "unsaved" means "anything changed since" — a block, a planting, a step, a
 * slider.
 *
 * Every way of throwing the current world away — opening another, New world,
 * Restart, closing the tab — asks first if there are unsaved changes.
 */

export type WorldSession = {
  id: string | null
  name: string
  dirty: boolean
  /** Ask before something destructive; resolves true to go ahead. */
  confirmDiscard: (what: string) => Promise<boolean>
}

const UNTITLED = 'Untitled world'

/**
 * Dev builds only: a stand-in store and user, so the menu can be driven in a
 * headless browser where nobody can sign in. Set `window.__wildformWorlds =
 * { uid, api }` before using the menu; a production build never reads it.
 */
function devWorlds(): { uid: string; api: WorldsApi } | null {
  if (!import.meta.env.DEV) return null
  const w = (window as unknown as { __wildformWorlds?: { uid: string; api: WorldsApi } }).__wildformWorlds
  return w ?? null
}

/** The dialog every confirmation goes through: a question, Cancel, and one button that does it. */
type Ask = { title: string; body: ReactNode; action: string; danger?: boolean; resolve: (ok: boolean) => void }

function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={`world-dialog${wide ? ' is-wide' : ''}`} onClose={onClose} onCancel={onClose} aria-label={title}>
      {open && (
        <>
          <h2>{title}</h2>
          {children}
        </>
      )}
    </dialog>
  )
}

const ago = (d: Date | null) => {
  if (!d) return 'just now'
  const s = (Date.now() - d.getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

type Props = {
  game: BuildGame
  /** The game's change count now (from the report). */
  changes: number
  /** After a world is opened or a new one started: stop growth, refresh the scene and the controls. */
  onReplaced: () => void
  /** Hands the session up, for Restart's confirmation. */
  onSession: (s: WorldSession) => void
}

export function WorldMenu({ game, changes, onReplaced, onSession }: Props) {
  const auth = useAuth()
  const dev = devWorlds()
  const api: WorldsApi = dev?.api ?? firestoreWorlds
  const user = dev ? { uid: dev.uid } : auth.user
  const loading = dev ? false : auth.loading
  const [id, setId] = useState<string | null>(null)
  const [name, setName] = useState(UNTITLED)
  const [savedAt, setSavedAt] = useState(() => game.changes)
  const [menu, setMenu] = useState(false)
  const [saveAs, setSaveAs] = useState<null | { initial: string; asNew: boolean }>(null)
  const [browse, setBrowse] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = changes !== savedAt

  const confirm = useCallback(
    (title: string, body: ReactNode, action: string, danger = false) => new Promise<boolean>((resolve) => setAsk({ title, body, action, danger, resolve })),
    [],
  )
  const confirmDiscard = useCallback(
    async (what: string) => !dirty || confirm('Unsaved changes', <p>“{name}” has changes that aren’t saved. {what} anyway, and lose them?</p>, `${what} anyway`, true),
    [dirty, name, confirm],
  )
  useEffect(() => {
    onSession({ id, name, dirty, confirmDiscard })
  }, [id, name, dirty, confirmDiscard, onSession])

  // Closing or reloading the tab with unsaved changes: the browser's own prompt.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // A status line clears itself after a while, unless it is an error.
  useEffect(() => {
    if (!status || status.error) return
    const t = window.setTimeout(() => setStatus(null), 4000)
    return () => window.clearTimeout(t)
  }, [status])

  /** Why saving isn't possible right now, or null. */
  const blocked = dev ? null : !firebaseReady ? 'Saving needs Firebase, which isn’t configured in this build.' : loading ? 'Checking sign-in…' : !user ? 'Sign in (top right) to save worlds.' : null

  const doSave = async (worldName: string, asNew: boolean) => {
    if (!user) return
    setBusy(true)
    setStatus({ text: 'Saving…' })
    try {
      const at = game.changes
      const { head, body } = serializeWorld(game)
      const newId = await api.saveWorld(user.uid, worldName, head, body, asNew ? undefined : (id ?? undefined))
      setId(newId)
      setName(worldName.trim())
      setSavedAt(at)
      setStatus({ text: `Saved “${worldName.trim()}”` })
      setSaveAs(null)
    } catch (e) {
      // The world is still here, unsaved: nothing is lost by a failed save.
      setStatus({ text: `Couldn’t save: ${describeFirestoreError(e)}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    setMenu(false)
    if (blocked) return setStatus({ text: blocked, error: true })
    if (id) void doSave(name, false)
    else setSaveAs({ initial: name === UNTITLED ? '' : name, asNew: true })
  }

  const newWorld = async () => {
    setMenu(false)
    if (!(await confirmDiscard('Start a new world'))) return
    game.newWorld(Math.floor(Math.random() * 2 ** 31))
    setId(null)
    setName(UNTITLED)
    setSavedAt(game.changes)
    onReplaced()
    setStatus({ text: 'A new world, on a fresh lawn' })
  }

  const open = async (w: WorldListing) => {
    if (!user) return
    if (!(await confirmDiscard('Open another world'))) return
    setBusy(true)
    setStatus({ text: `Opening “${w.name}”…` })
    try {
      const { raw, body } = await api.readWorld(user.uid, w.id)
      const state = deserializeWorld(raw, body)
      game.load(state)
      setId(w.id)
      setName(w.name)
      setSavedAt(game.changes)
      setBrowse(false)
      onReplaced()
      setStatus({ text: `Opened “${w.name}” — paused at step ${game.sim.step.toLocaleString()}` })
    } catch (e) {
      // Read and checked before the game is touched: a world that can't be read leaves the current one as it was.
      setStatus({ text: `Couldn’t open “${w.name}”: ${e instanceof WorldFormatError ? e.message : describeFirestoreError(e)}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const dot = dirty ? <span className="world-dirty" title="Unsaved changes" aria-label="Unsaved changes" /> : null

  return (
    <div className="world-bar">
      <div className="world-line">
        <span className="world-name" title={name}>
          {name}
          {dot}
        </span>
        <button type="button" className="world-button is-primary" onClick={save} disabled={busy}>
          Save
        </button>
        <div className="world-menu-wrap">
          <button type="button" className="world-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={busy}>
            Worlds ▾
          </button>
          {menu && (
            <div className="world-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button type="button" role="menuitem" onClick={newWorld}>
                New world
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  if (blocked) return setStatus({ text: blocked, error: true })
                  setSaveAs({ initial: id ? copyName(name) : name === UNTITLED ? '' : name, asNew: true })
                }}
              >
                Save as…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  if (blocked) return setStatus({ text: blocked, error: true })
                  setBrowse(true)
                }}
              >
                My worlds…
              </button>
            </div>
          )}
        </div>
      </div>
      {status && (
        <p className={`world-status${status.error ? ' is-error' : ''}`} role={status.error ? 'alert' : 'status'}>
          {status.text}
          {status.error && (
            <button type="button" aria-label="Dismiss" onClick={() => setStatus(null)}>
              ×
            </button>
          )}
        </p>
      )}

      <Dialog open={!!saveAs} onClose={() => !busy && setSaveAs(null)} title={id && saveAs?.asNew && name !== UNTITLED ? 'Save as a new world' : 'Save world'}>
        {saveAs && <NameForm initial={saveAs.initial} action="Save" busy={busy} onCancel={() => setSaveAs(null)} onSubmit={(n) => doSave(n, saveAs.asNew)} />}
      </Dialog>

      <Dialog open={browse} onClose={() => !busy && setBrowse(false)} title="My worlds" wide>
        {browse && user && <WorldList api={api} uid={user.uid} currentId={id} busy={busy} onOpen={open} confirm={confirm} onClose={() => setBrowse(false)} onRenamed={(wid, n) => wid === id && setName(n)} onDeleted={(wid) => wid === id && (setId(null), setSavedAt(-1))} />}
      </Dialog>

      <Dialog open={!!ask} onClose={() => (ask?.resolve(false), setAsk(null))} title={ask?.title ?? ''}>
        {ask && (
          <>
            <div className="world-ask">{ask.body}</div>
            <div className="world-actions">
              <button type="button" className="world-button" onClick={() => (ask.resolve(false), setAsk(null))}>
                Cancel
              </button>
              <button type="button" className={`world-button ${ask.danger ? 'is-danger' : 'is-primary'}`} onClick={() => (ask.resolve(true), setAsk(null))}>
                {ask.action}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  )
}

/** A name field with its validation: non-empty, at most MAX_NAME characters. */
function NameForm({ initial, action, busy, onCancel, onSubmit }: { initial: string; action: string; busy: boolean; onCancel: () => void; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  const [touched, setTouched] = useState(false)
  const problem = validName(value)
  return (
    <form
      className="world-form"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!problem) onSubmit(value)
      }}
    >
      <label>
        <span>World name</span>
        <input autoFocus value={value} maxLength={MAX_NAME + 20} placeholder="Hanging Garden 01" onChange={(e) => setValue(e.target.value)} onBlur={() => setTouched(true)} />
      </label>
      <p className={`world-hint${touched && problem ? ' is-error' : ''}`}>{touched && problem ? problem : `${value.trim().length} / ${MAX_NAME}`}</p>
      <div className="world-actions">
        <button type="button" className="world-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="world-button is-primary" disabled={busy}>
          {busy ? 'Saving…' : action}
        </button>
      </div>
    </form>
  )
}

function WorldList({
  api,
  uid,
  currentId,
  busy,
  onOpen,
  confirm,
  onClose,
  onRenamed,
  onDeleted,
}: {
  api: WorldsApi
  uid: string
  currentId: string | null
  busy: boolean
  onOpen: (w: WorldListing) => void
  confirm: (title: string, body: ReactNode, action: string, danger?: boolean) => Promise<boolean>
  onClose: () => void
  onRenamed: (id: string, name: string) => void
  onDeleted: (id: string) => void
}) {
  const [worlds, setWorlds] = useState<WorldListing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api.listWorlds(uid).then(
        (list) => setWorlds(list),
        (e) => setError(`Couldn’t load your worlds: ${describeFirestoreError(e)}`),
      ),
    [api, uid],
  )
  useEffect(() => {
    void load()
  }, [load])

  const act = async (wid: string, what: () => Promise<void>, failed: string) => {
    setWorking(wid)
    setError(null)
    try {
      await what()
      await load()
    } catch (e) {
      setError(`${failed}: ${describeFirestoreError(e)}`)
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="world-list">
      {error && (
        <p className="world-status is-error" role="alert">
          {error}
        </p>
      )}
      {!worlds && !error && <p className="world-hint">Loading…</p>}
      {worlds && worlds.length === 0 && <p className="world-hint">No saved worlds yet. Build something, then Save.</p>}
      {worlds && worlds.length > 0 && (
        <ul>
          {worlds.map((w) => (
            <li key={w.id} className={w.id === currentId ? 'is-current' : ''}>
              {renaming === w.id ? (
                <NameForm
                  initial={w.name}
                  action="Rename"
                  busy={working === w.id}
                  onCancel={() => setRenaming(null)}
                  onSubmit={(n) =>
                    act(
                      w.id,
                      async () => {
                        await api.renameWorld(uid, w.id, n)
                        onRenamed(w.id, n.trim())
                        setRenaming(null)
                      },
                      'Couldn’t rename it',
                    )
                  }
                />
              ) : (
                <>
                  <div className="world-row-text">
                    <strong>
                      {w.name}
                      {w.id === currentId && <span className="world-tag">open</span>}
                    </strong>
                    <span>
                      {w.problem
                        ? w.problem
                        : `${w.head?.scenario ?? 'lawn'} · ${w.summary?.blocks ?? 0} blocks · step ${(w.summary?.step ?? 0).toLocaleString()} · ${w.summary?.living ?? 0} living · ${ago(w.updatedAt)}`}
                    </span>
                  </div>
                  <div className="world-row-actions">
                    <button type="button" className="world-button is-primary" disabled={busy || !!working || !!w.problem} onClick={() => onOpen(w)}>
                      Open
                    </button>
                    <button type="button" className="world-button" disabled={busy || !!working} onClick={() => setRenaming(w.id)}>
                      Rename
                    </button>
                    <button type="button" className="world-button" disabled={busy || !!working || !!w.problem} onClick={() => act(w.id, async () => void (await api.duplicateWorld(uid, w.id, copyName(w.name))), 'Couldn’t duplicate it')}>
                      {working === w.id ? '…' : 'Duplicate'}
                    </button>
                    <button
                      type="button"
                      className="world-button is-danger"
                      disabled={busy || !!working}
                      onClick={async () => {
                        if (!(await confirm('Delete world', <p>Delete “{w.name}”? This can’t be undone.</p>, 'Delete', true))) return
                        void act(
                          w.id,
                          async () => {
                            await api.deleteWorld(uid, w.id)
                            onDeleted(w.id)
                          },
                          'Couldn’t delete it',
                        )
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="world-actions">
        <button type="button" className="world-button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
