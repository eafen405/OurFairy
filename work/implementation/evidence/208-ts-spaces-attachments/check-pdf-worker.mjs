#!/usr/bin/env node
/**
 * The PDF worker must be reachable from the built module and must ship.
 *
 * `backend/attachments/src/pdf.mjs` resolved the worker relative to its own
 * directory. After the TypeScript migration the module lives in `dist/`, so the
 * worker moved to the package-root `assets/` directory and the resolution goes
 * one level up. This script asserts both halves of that contract:
 *
 * 1. the package is built (`dist/pdf.js` exists) and its manifest points at it;
 * 2. the path the built module resolves for the worker exists on disk;
 * 3. the package's `files` publishes that worker, so an installed profile has it.
 *
 * Run from the repository root:
 *   node work/implementation/evidence/208-ts-spaces-attachments/check-pdf-worker.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
const packageDir = join(repoRoot, 'backend', 'attachments')
const builtModule = join(packageDir, 'dist', 'pdf.js')
const manifestPath = join(packageDir, 'package.json')

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}

if (!existsSync(builtModule)) {
  check(false, `the package is built: ${builtModule} exists (run "npm run build")`)
} else {
  check(true, `the package is built: ${builtModule} exists`)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
check(manifest.main === './dist/index.js' && manifest.types === './dist/index.d.ts',
  `the manifest points at the build output: main=${manifest.main} types=${manifest.types}`)

// The built module sits in `dist/`; the worker sits in the package-root
// `assets/` directory, one level up — the same shape the wheel already uses.
const worker = join(dirname(builtModule), '..', 'assets', 'pdf-worker.py')
check(existsSync(worker), `the built module resolves the worker to an existing file: ${worker}`)

const published = (manifest.files ?? []).filter(entry => entry === 'assets/pdf-worker.py'
  || (entry.endsWith('/**') && worker.startsWith(join(packageDir, entry.slice(0, -3)))))
check(published.length > 0,
  `the manifest publishes the worker: files=${JSON.stringify(manifest.files)}`)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
