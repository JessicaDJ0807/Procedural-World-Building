# Firebase integration

Jessica Hsiao · Assignment 2

[← back to the README](../../README.md) · [study notebook index](../README.md)

Sign-in, saved configurations and hosting for the voxel page (Topic 3). This
file tracks the integration as it is built; the survey that preceded it is
[`firebase-integration-report.md`](firebase-integration-report.md).

**Status:** Stage 2 — configuration, authentication and Firestore saved
configurations. Storage is written but not switched on (see
[Storage is off](#storage-is-off)); Hosting is not wired up yet.

## Setting it up

```bash
cp .env.example .env     # then fill the six values
npm run dev
```

The six values come from the Firebase console under **Project settings → Your
apps → SDK setup and configuration**. In the console you also need
**Authentication → Sign-in method → Google** enabled, and the origin you serve
from listed under **Authentication → Settings → Authorized domains**
(`localhost` is there by default).

### Deploying the rules

A new Firestore database starts in **locked mode** — every read and write is
denied until rules are published. The symptom in the app is "Firestore rules
rejected that" on the very first save, which is the rules working, not a bug.

The rules live in `firestore.rules` and `storage.rules`, with `firebase.json`
pointing at them:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` into **Firestore Database → Rules**
in the console and publish, which needs nothing installed.

`firebase.json` is tracked; `.firebaserc`, which names the specific project, is
gitignored for the same reason `.env` is. Create it locally, or pass
`--project <project-id>` on each deploy. Note that `firebase.json` also declares
a `storage` rules target, so a bare `firebase deploy` fails until Storage
exists — deploy with `--only` while it is off.

`.env` is gitignored. `.gitignore` previously had only `*.local`, which does not
match a plain `.env`, so the rule was added explicitly along with `.env.*` and a
negation for `.env.example`.

These values are **not secrets**. Vite inlines them into the bundle by design,
and a web API key only names the project — anyone can read it from the deployed
site. What protects the data is the Firestore and Storage rules, which pin every
document to its owner's uid. They are kept out of git because they point at a
specific billable project, not because they are confidential.

## What exists

| File | Does |
| --- | --- |
| `src/firebase/config.ts` | Reads the env vars, initialises the app, exports `auth`/`db`/`storage` |
| `src/firebase/authContext.ts` | The auth context and the `useAuth()` hook |
| `src/firebase/AuthProvider.tsx` | Subscribes to `onAuthStateChanged` |
| `src/firebase/auth.ts` | `signInWithGoogle()`, `signOutUser()`, error translation |
| `src/AuthBar.tsx` | Header UI — sign in, signed-in identity, sign out |
| `src/config/voxelConfig.ts` | The saved-document schema: what is stored, and validation on load |
| `src/firebase/configs.ts` | Firestore CRUD over `users/{uid}/configs` |
| `src/firebase/storage.ts` | JSON upload, plus the local download that works without Storage |
| `src/ConfigPanel.tsx` | Sidebar UI — name, save, list, load, delete |
| `firestore.rules`, `storage.rules` | Owner-scoped access rules, kept in the repo so they are reviewable |

## What is saved

`users/{uid}/configs/{configId}`, one document per saved stack:

| Field | Why |
| --- | --- |
| `name` | What the user typed |
| `topic`, `schemaVersion` | So a future topic and a future format can share the collection |
| `ownerUid` | Redundant with the path on purpose — it makes an exported document self-describing, and the rules require the two to agree |
| `createdAt`, `updatedAt` | `serverTimestamp()`, so the ordering does not depend on a client clock |
| `storagePath` | Only when a JSON copy was uploaded |
| `settings` | `sceneName`, `nodes`, `mode`, `greedy`, `resolution`, `iso`, `spin`, `showBounds`, `palette` |

**Parameters, never geometry.** The field, the mesh, the normals and the colour
ramp are all absent, because every one of them is reproducible from `settings`
— the generator is deterministic end to end. This is not only tidiness: a 96³
field is 3.4 MB of `Float32Array` and the Firestore document limit is 1 MB, so
storing the sampled world would not fit. A measured document for the default
scene is **1,192 bytes**.

## Not yet verified

Everything below the sign-in button is **unexercised against a real account**.
A Google popup cannot be driven in headless Chrome, so the save, list, load and
delete paths have been checked only as far as the Firestore rules: an
unauthenticated client is rejected with `permission-denied`, which the panel
shows translated. That the database exists and is in locked mode is the one
thing that round trip does confirm.

What *has* been verified is the part that does not need an account: the
serialization round trip for all five stock scenes, 15 malformed documents, and
the node-id collision the counter used to produce — see the Notes below. There
is no figure of the signed-in panel for the same reason; a stubbed screenshot
would be a mock-up rather than a capture, and this notebook's figures come from
the running app.

**To finish the check:** sign in, save a stack, reload the page, load it back,
and confirm the shape list and every slider match. Then delete it and confirm
it leaves the list.

## Storage is off

Firebase Storage needs a billing account attached before the bucket can be
created, and this project does not have one. `src/firebase/storage.ts` is
written and the rules are in `storage.rules`, so turning it on is a console
step rather than a code change, but nothing has exercised that path yet.

Two things follow:

- The **Upload JSON copy** checkbox is off by default. With it on, the Firestore
  save happens first and an upload failure is reported as a partial success —
  the configuration is still saved, and `storagePath` is simply absent.
- **Download** produces the identical bytes locally, through the same
  `configToJson`, so the export path is demonstrable today.

The obvious alternative — uploading a screenshot of the result — does not work
here. None of the WebGL renderers set `preserveDrawingBuffer`, so `toDataURL()`
returns a blank image, and enabling it costs a frame copy on every draw for a
feature used once per save.

## Notes

**A missing `.env` must not break Topics 1 and 2.** They have nothing to do with
Firebase, and a fresh clone has no `.env` at all. `initializeApp` does not throw
on undefined values — it fails later, at sign-in, with an opaque
`auth/api-key-not-valid`. So `config.ts` checks the six names up front, skips
initialisation entirely when any is missing, and exports `firebaseReady` plus
the *names* of what is absent. The header then says "Firebase not configured"
and everything else runs as before. Verified in the browser with no `.env`
present: all three topics render, console clean.

![The app header reading "Firebase not configured — copy .env.example to .env", with all three topic tabs still present](../images/project-firebase-not-configured.png)

*What a fresh clone looks like with no `.env`: the header says so in place of
the sign-in button, and every topic still loads.*

**`initializeApp` is guarded by `getApps()`.** Vite re-executes the module on
hot reload, and a second `initializeApp` throws `app/duplicate-app`.

**`onAuthStateChanged` returns its unsubscribe, and the effect returns it.**
StrictMode mounts every effect twice in development; without the cleanup the
first mount's listener outlives its unmount and fires into a dead component.

**The hook is not in `AuthProvider.tsx`.** Vite's fast refresh only handles a
module whose exports are all components, and `eslint-plugin-react-refresh`
enforces that as an **error**, not a warning — `npm run lint` fails outright. So
the context and `useAuth()` live in `authContext.ts` and the provider file
exports only the component.

**Popup, not redirect.** `signInWithRedirect` unloads the page and returns to a
fresh one, which would discard the shape stack the user was editing. The cost is
that the origin has to be in the authorized-domains list.

**Errors are shown, not logged.** `describeAuthError` translates the codes a
user causes on purpose — a closed popup reads "Sign-in cancelled." rather than
looking like a fault — and anything unrecognised is shown verbatim rather than
hidden. One code was corrected against observed behaviour: a bad key produces
`auth/api-key-not-valid.-please-pass-a-valid-api-key.`, not the
`auth/invalid-api-key` the name suggests. Both are mapped.

**Cost of the SDK:** `firebase/app` + `firebase/auth` bundle to 136 kB raw,
34 kB gzipped — measured with esbuild over those imports alone. The production
bundle's 500 kB warning predates this; three.js already exceeded it.

**Focus mode hides the auth bar**, because `H` sets `display: none` on the whole
`.app-nav`. Confirmed rather than assumed: `navDisplay` is `none` and the bar's
`offsetParent` is null. Sign-in is a header action, so this is the right
behaviour, but it does mean there is no way to sign in without leaving focus
mode.

**Node ids are not stored, and no longer come from a counter.** `VoxelPage` used
a module-level `nextId` that restarted at zero on every reload, so loading a
stack whose shapes were saved as `node-0`…`node-3` guaranteed the next added
shape collided with one of them. Two changes, either of which would have been
enough: ids are stripped on save, because they are editing-session handles
rather than part of the shape, and `crypto.randomUUID()` replaced the counter.
Checked with 2,000 generated ids against a loaded stack — no collisions.

**Overwriting a configuration used `setDoc` and deleted its `createdAt`.**
`setDoc` replaces the document, and the payload only carries `createdAt` on a
first save — so every overwrite silently dropped the date the configuration was
first stored. The comment above it claimed the opposite, which is how it
survived review. `updateDoc` on the existing-id path fixes it: untouched fields
stay, and `settings` is still replaced wholesale, which is what an overwrite has
to mean when a shape was removed.

**Everything read back from Firestore is treated as untrusted.** A document can
be hand-edited in the console or written by an older build, so `parseSettings`
clamps every number, checks every enum against the live list, rebuilds each
shape's parameters from that shape's own definition, and falls back to a default
rather than throwing. It also returns a list of what it had to repair, which the
panel shows — a silently different world would be worse than a visible warning.
Exercised against 15 malformed documents (null, a bare string, an array,
`resolution: 100000`, `NaN` isolevel, `Infinity` spin, unknown shapes, ops,
palettes and meshers): none threw, and every result was in range.

**Two defects were visible only in the browser.** The name field overflowed the
sidebar by 18px: there is no global `box-sizing` reset, and unlike `<select>` an
`<input>` is `content-box` by default, so `width: 100%` plus padding was too
wide. And a failed list fetch left "Loading saved configurations…" on screen
permanently, because the loading flag is derived from whether the account has
been fetched and the error path never marked it settled. Both found by
screenshotting the panel, neither by reading the diff.

**The list is derived per account, not cleared by an effect.** Signing out must
not leave the previous account's configurations on screen. Clearing them in an
effect is the obvious move and is what `react-hooks/set-state-in-effect` rejects
— it is a cascading render for something that can be a comparison. The list is
stored with the uid that produced it and read back only when that uid still
matches.
