// Runs tests/*.test.ts on Node's own test runner — no test framework to install.
//
// The sources import without extensions and read Vite's `import.meta.env`, so
// Node can't run them as they are: each test file is bundled first with
// rolldown (already here, under Vite), `import.meta.env` swapped for an empty
// object, into node_modules/.cache/tests, then run with `node --test`.
import { build } from 'rolldown'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const OUT = 'node_modules/.cache/tests'
mkdirSync(OUT, { recursive: true })
const only = process.argv.slice(2)
const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts') && (!only.length || only.some((o) => f.includes(o))))
const outs = []
for (const f of files) {
  const file = join(OUT, f.replace(/\.ts$/, '.mjs'))
  await build({ input: join('tests', f), platform: 'node', logLevel: 'silent', output: { file, format: 'esm' } })
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})'))
  outs.push(file)
}
const run = spawnSync(process.execPath, ['--test', ...outs], { stdio: 'inherit' })
process.exit(run.status ?? 1)
