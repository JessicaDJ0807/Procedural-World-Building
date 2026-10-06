# Procedural World Building — working agreements

Coursework for a weekly design course. React 19 · TypeScript · Vite · three.js.
Each **topic** is a page under `src/pages/`, reachable from the `PAGES` array in
`src/App.tsx`. The app accumulates: earlier topics are preserved, never replaced.

**Topics are not weeks.** The course meets weekly but not every week produces
work — some are lectures — so pages, branches and docs are numbered by topic.
Topic 3 is the third body of work, not the third week. Never renumber to match
a calendar, and never leave a gap.

## Git workflow

`main` must read as **one to three commits per topic**. Nothing else matters
about its shape.

- **Work on a branch**, named for the topic: `topic-3-voxels`. Commit as often as
  is useful there — that is your call, no need to ask.
- **Never commit, merge, or rebase onto `main` unless explicitly asked.** The
  user decides when a topic lands.
- **When asked to land**, collapse the branch into 1–3 coherent commits and put
  those on `main`. Do not merge the branch as-is: a merge replays every branch
  commit onto main, and only `git log --first-parent` would hide them.
- **Compress the reasoning, don't discard it.** A squash that throws away *why*
  something was done defeats the point — this repo is a record of the course.
  Write the collapsed commit message so the findings survive: the measurement,
  the bug and what it cost, the option rejected and why.
- **Never rewrite commits already on `origin/main`** without asking first.

`git rebase -i` is unavailable in this environment. To collapse a branch, build
the commits explicitly and move the branch onto them:

```bash
git branch backup/pre-squash main                       # safety net first
NEW=$(git commit-tree <tree>^{tree} -p <parent> -F msg.txt)
git reset --hard $NEW
git diff --stat backup/pre-squash main                  # MUST be empty
git rev-parse 'backup/pre-squash^{tree}' 'main^{tree}'  # MUST match
```

Verify the tree is byte-identical before reporting success. Keep the backup
branch until the user has pushed.

## Documentation

`docs/` is a study notebook, filed by what a document is:

```
docs/
├── README.md     index of everything below — keep it current
├── topics/       one chapter per topic: topic-N-<name>.md
├── analysis/     measurement and comparison reports
├── project/      infrastructure and setup
└── images/       screenshots, captured from the running app
```

- **Each topic has its own chapter**: `docs/topics/topic-N-<name>.md`. The root
  `README.md` is the entry point — a table of contents, per-topic summaries
  with a screenshot each, Keyboard, Getting started, Project structure,
  Conventions, Built with. Keep it short; depth belongs in `docs/`.
- **Docs ship with the change, unprompted.** A feature is not done until the
  README or its topic's chapter describes it.
- **A new document gets an index entry.** `docs/README.md` lists every file
  with a one-line description of what it covers; a document missing from it is
  a document nobody will find.
- **A decision goes next to the feature it explains** — in that topic's
  `## Notes` section. Only genuinely cross-cutting notes belong in the root
  README's Conventions.
- **A report that outgrows its chapter moves to `analysis/`** and is linked
  from both directions. Don't split a chapter into subject folders; the
  algorithm material is only legible next to what motivates it.
- **Figures are captured from the running app**, never mocked up, so a figure
  and the numbers beside it describe the same run. Drive the app in headless
  Chrome, clip to the element, and check the image before shipping it.
- **PNG for anything with UI text, JPEG for continuous tone.** A render with
  film grain or a soft gradient is the wrong content for PNG: the Topic 4
  figures were 17 MB as PNG and 6.7 MB as JPEG at quality 88, with no visible
  difference. Keep `docs/images/` in single-digit megabytes.
- When you change a default or a behaviour, grep the docs for claims about the
  old one. Stale numbers are the usual failure here.

## Adding a topic

One page component in `src/pages/`, one entry in the `PLAYGROUND` array in
`routes.ts` (the Playground opens on the last entry), one line in
`PLAYGROUND_PAGES` in `App.tsx`, one `docs/topics/topic-N-*.md`, and a row for
it in `docs/README.md` and the root `README.md`.
Don't modify or fold away earlier topics.

**Topics go in the Playground.** The app has two top-level sections — Playground
for taking a technique apart, Project for putting them back together. New
coursework is a topic in the Playground; the Project is not a topic and does not
get numbered pages. See `docs/project/app-structure.md`.

## Before you say it works

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build
```

**Visual changes need a browser, not a diff.** Start the dev server and drive
it — headless Chrome over CDP works here (`--enable-unsafe-swiftshader
--use-angle=swiftshader` for WebGL). Screenshot the result and actually look at
it. Several defects in this repo's history were invisible in the code and
obvious on screen.

## House style

- **Measure, don't assert.** This codebase's comments and docs carry real
  numbers — Hurst exponents, channel concentration, millisecond costs, step
  counts. If you state one, produce it; if you can't, don't state it. Prefer a
  short script that computes the answer over an estimate that reads well.
- **Comments explain why, not what.** Especially the non-obvious choice: the
  thing that looks like a bug until you know the reason.
- **Report honestly.** If a measurement contradicts what you expected, say so
  and correct the claim. Some of the better notes in `docs/` exist because an
  assumption turned out to be wrong and got written down.
