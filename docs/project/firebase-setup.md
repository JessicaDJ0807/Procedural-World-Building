# Firebase integration

Jessica Hsiao · Assignment 2

[← back to the README](../../README.md) · [study notebook index](../README.md)

Sign-in, saved worlds and hosting. Every topic saves its own worlds. This
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

The rules name the topics a document may claim, so **they must be re-published
when a topic is added**. A save from a topic the deployed rules do not list
fails with `permission-denied`, which reads exactly like the locked-mode error
below.

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
| `src/firebase/configs.ts` | Firestore CRUD over `users/{uid}/configs` |
| `src/firebase/storage.ts` | JSON upload, plus the local download that works without Storage |
| `src/ConfigPanel.tsx` | The worlds library — the left column, on every topic |
| `src/Workspace.tsx` | The three resizable columns |
| `src/config/spec.ts` | The per-topic contract, and the validators all four share |
| `src/config/*Config.ts` | One schema per topic: defaults, validation, summary line |
| `firestore.rules`, `storage.rules` | Owner-scoped access rules, kept in the repo so they are reviewable |

## What is saved

`users/{uid}/configs/{configId}`, one document per saved world, from any topic:

| Field | Why |
| --- | --- |
| `name` | What the user typed |
| `topic`, `schemaVersion` | So a future topic and a future format can share the collection |
| `ownerUid` | Redundant with the path on purpose — it makes an exported document self-describing, and the rules require the two to agree |
| `createdAt`, `updatedAt` | `serverTimestamp()`, so the ordering does not depend on a client clock |
| `storagePath` | Only when a JSON copy was uploaded |
| `settings` | Whatever that topic's schema defines |

Each topic supplies a `ConfigSpec`: its defaults, how to validate a document,
and the one line shown under a name in the library. Everything else — the
Firestore reads and writes, the panel, the export — is written once and shared.

| Topic | Stores | Default document |
| --- | --- | --- |
| Objects | Shape, transform, material | 234 bytes |
| Noise | Layers, warp, erosion, automata, palette | 2,504 bytes |
| Voxels | Scene, shape stack, mesher, resolution | 1,192 bytes |
| Shaders | Simulation, every simulation's tuning, presets | 1,528 bytes |

One collection holds all four, filtered by `topic` **in the client** rather
than with `where('topic','==',…)`: combining an equality filter with an
`orderBy` on a different field needs a composite index, which is a console step
this project does not otherwise require. One account's worlds are a handful of
documents.

**Parameters, never geometry.** The field, the mesh, the normals and the colour
ramp are all absent, because every one of them is reproducible from `settings`
— the generator is deterministic end to end. This is not only tidiness: a 96³
field is 3.4 MB of `Float32Array` and the Firestore document limit is 1 MB, so
storing the sampled world would not fit. The largest default document, Topic 2's, is
**2,504 bytes**.

## Layout

Every topic is three columns: **library, canvas, inspector** — 220px,
flexible, 320px by default, all of it underneath the topic nav so the hierarchy
reads app → topic → world → parameter.

Within that, controls are placed by what they change, not by topic:

| Where | Answers | Example |
| --- | --- | --- |
| Right sidebar | How is this made? | Mesher, octaves, erosion, shader strategy |
| View popover | How am I looking at it? | Palette, spin, wireframe, sampling bounds |

The View button is a floating eye in the viewport's top-right, identical on all
four topics, opening a compact popover. It lives inside the canvas column
rather than the sidebar, so it stays anchored when a divider is dragged and
opening it resizes nothing — measured: the canvas is the same width open and
closed.

The test is whether changing a control leaves the generated world identical.
That is why Topic 4 moves almost nothing: relief, lighting, the height ramp,
Fresnel and haze all change appearance, but on a page about shading the
appearance *is* the subject. Only Turntable moves, flagged with `view: true` on
its `ParamSpec`. By the same reasoning Topic 2 keeps Slice (z), which chooses a
plane of the volume, and Colour by cut/fill, which is how an erosion result is
read.

Topic 2's sidebar is additionally collapsible — Geometry, Layers, Warp,
Automata, Erosion, Output — because six groups of controls do not fit on
screen and scrolling past four of them to reach erosion was the problem.

Moving a control moved only its JSX. Each one still reads and writes the state
it always did, and the saved-document schemas are untouched, so palette and
spin are still stored exactly as before.

**Both boundaries drag.** Widths are clamped so neither panel can squeeze the
canvas below 300px, double-clicking a divider resets it, and the arrow keys
move it 16px at a time (1px with Shift). Widths are remembered **per topic** in
`localStorage` — Topic 2 has far more controls than Topic 1, so one shared
width would be wrong for both. Every `localStorage` access is wrapped: it
throws in a private window and comes back empty after cleared site data, and a
width that does not survive a reload is a much smaller problem than a page that
will not load.

The divider is a 7px hit area with a 1px rule drawn inside it, negatively
margined so it costs no layout. A 1px line would be a 1px target.

Topic 1's controls were a floating widget over the canvas and Topics 2 and 4
had a sidebar but no library. Topic 3's right sidebar had been doing two jobs,
editing the current world and managing saved ones. Separating them gives each column one question: *what am
I working on*, *what does it look like*, *how do I change it*.

Behaviour that followed from the split:

- **The whole row opens a world.** A one-line Load button was a small target
  for the action taken most often.
- **Rename and delete sit behind `•••`.** A delete button on every row is
  noise for something done rarely and never by accident.
- **An unsaved marker.** The settings as stored are kept alongside the active
  world and compared against the live state, so editing a loaded world shows
  "• Unsaved" and the button becomes *Save changes*. With no edits it reads
  *Saved* and is disabled.
- **Export is not a save.** Download JSON is styled as a quiet link rather
  than a second button, so the two do not read as alternatives.
- **The Upload JSON copy checkbox is gone**, rather than offered and broken —
  Storage is off. `storage.ts` keeps the upload for when it is enabled.

**Opening a world does not re-read it.** `listConfigurations` already returns
whole documents, parsed by the same code a per-document `get` would use, so
the second read bought nothing and put a round trip in front of every click.
`loadConfiguration` was deleted rather than left as a function nothing calls —
a deviation from the original plan, which named it.

## Not yet verified

Everything below the sign-in button is **unexercised against a real account**.
A Google popup cannot be driven in headless Chrome, so the save, rename and
delete paths have never run against a real account.

The row-click, selection, unsaved marker and `•••` menu *were* exercised, under
a temporary harness that stubbed the signed-in user and supplied three
fabricated rows. That harness was reverted and is not in the source. It earned
its keep: it caught the redundant per-document read, a long name that hard-cut
with no ellipsis because `text-overflow` has no effect on a flex container's
own text node, and an inspector measuring 353px rather than 320 because
`width` and padding add up without `box-sizing`.

What *has* been verified is the part that does not need an account: the
serialization round trip for all five stock scenes, 15 malformed documents, and
the node-id collision the counter used to produce — see the Notes below. There
is no figure of the signed-in panel for the same reason; a stubbed screenshot
would be a mock-up rather than a capture, and this notebook's figures come from
the running app.

**To finish the check:** sign in, save a world, reload the page, click it in
the library, and confirm the shape list and every slider match. Then edit a
slider and watch for "• Unsaved", save again, rename it, and delete it.

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
