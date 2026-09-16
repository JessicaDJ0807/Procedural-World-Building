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

- **Each topic has its own write-up**: `docs/topic-N-<name>.md`. The root
  `README.md` is a map — per-topic summaries with links, Keyboard, Getting
  started, Project structure, Conventions, Built with. Keep it short.
- **Docs ship with the change, unprompted.** A feature is not done until the
  README or its topic's file describes it.
- **A decision goes next to the feature it explains** — in that topic's
  `## Notes` section. Only genuinely cross-cutting notes belong in the root
  README's Conventions.
- When you change a default or a behaviour, grep the docs for claims about the
  old one. Stale numbers are the usual failure here.

## Adding a topic

One page component in `src/pages/`, one entry in the `PAGES` array in
`App.tsx` (the shell opens on the last entry), and one `docs/topic-N-*.md`.
Don't modify or fold away earlier topics.

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
