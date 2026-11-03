/**
 * CLEAN-09 probe: what a change to one product package selects, and which
 * suites drive that package without being selected.
 *
 * Run from the repository root:
 *
 *   node work/implementation/evidence/repo-cleanup/related-selection-probe.mjs
 *
 * For every directory under `backend/` it takes one representative source path,
 * asks the gate's own `relatedTests` what that change selects, and then scans
 * every test file for the package's own HTTP route literals and tool names —
 * the surfaces a suite reaches without importing the package, so the body-name
 * signal cannot see them. The second list is a candidate list, not a verdict:
 * a tool name in a fixture string and the bootstrap every suite walks
 * (`/identity`, `/sessions`, `/chat`) are not associations.
 *
 * `SIGNALS` is the map this run used; it is written here rather than derived
 * because the routes are registered through helpers whose paths are arguments,
 * and deriving them would need to boot the backend. Adding a route means adding
 * its literal here — the probe is a reading aid, not a second authority. The
 * `'groups'` entry is the quoted tool name, so it also matches a SQLite table
 * name and an identity interface key; those are the false positives to discard
 * by reading the call site.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { relatedTests, repoRoot, testFiles } from '../../../../scripts/precommit.ts'

/** Route paths and tool names each package owns, plus the PDF tools it registers. */
const SIGNALS = {
  attachments: ['/attachments/propose', '/attachments/chunk', '/attachments/complete', '/attachments/download',
    'pdf_info', 'pdf_render_pages', 'pdf_read_pages'],
  chat: ['/chat/send', '/chat/read', '/chat/page', '/chat/observe', '/chat/stop', '/chat/checkpoint',
    '/chat/receipt', '/chat/jobs/output', '/chat/jobs/stop'],
  delivery: ['deliver_message'],
  gateway: ['/gateway/read', '/gateway/route', '/gateway/route/delete', '/gateway/asr', '/gateway/compaction',
    '/gateway/maintenance', '/gateway/selection'],
  groups: ['group_create', 'group_members', "'groups'"],
  identity: ['/identity/invite', '/identity/register', '/identity/sign-in', '/identity/sign-out', '/identity/session',
    '/identity/agents'],
  memory: ['memory_add', 'memory_search', 'memory_edit', 'memory_delete', 'memory_switch', 'impression_read',
    'impression_edit', '/impression/read', '/impression/edit'],
  search: ['conversation_search', 'conversation_read'],
  sessions: ['/sessions/create', '/sessions/list', '/sessions/primary', '/sessions/read', '/sessions/select',
    '/sessions/rename', '/sessions/archive', '/sessions/restore'],
  spaces: [],
  speech: ['/speech', '/speech/transcriptions'],
}

/** The packages under `backend/`, as directory names. */
const packages = readdirSync(join(repoRoot, 'backend'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()

/** One representative source path in a package: the first `.ts` file it has. */
function representativePath(name) {
  const dir = join(repoRoot, 'backend', name, 'src')
  if (!existsSync(dir)) return `backend/${name}/README.md`
  const file = readdirSync(dir).find(entry => entry.endsWith('.ts'))
  return file === undefined ? `backend/${name}/README.md` : `backend/${name}/src/${file}`
}

const allTests = testFiles(repoRoot)
const testBodies = new Map(allTests.map(file => [file, readFileSync(join(repoRoot, file), 'utf8')]))

for (const name of packages) {
  const path = representativePath(name)
  const selected = relatedTests([path], { root: repoRoot })
  const signals = SIGNALS[name] ?? []
  const namingFiles = signals.length === 0 ? [] : allTests.filter(file => signals.some(signal => testBodies.get(file).includes(signal)))
  const unselected = namingFiles.filter(file => !selected.includes(file))
  console.log(`\n== backend/${name}  (probe: ${path})`)
  console.log(`   selected (${selected.length}): ${selected.join(', ') || '(none)'}`)
  console.log(`   names a route/tool, not selected: ${unselected.join(', ') || '(none)'}`)
}
