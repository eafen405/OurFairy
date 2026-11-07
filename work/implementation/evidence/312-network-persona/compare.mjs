/** Reproduce the real product comparison; only FAIRY_PERSONA differs between arms. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyProductRepo, repoRoot } from '../../../../tests/helpers/backend.mjs'
import { withBuildLock } from '../../../../scripts/tsc.ts'

const outputParent = resolve(process.argv[2] ?? join(repoRoot, 'work/tmp/312/comparison'))
const only = process.argv[3] ?? 'ordinary-task,route-provided,web-grounding,research-request,presence,praise,support,correction,writing-delivery,identity-capability,roleplay-boundary,persona-rewrite,cross-user-impression,tool-grounding'
const baseline = execFileSync('git', ['show', '7c69226:backend/chat/src/persona.ts'], { cwd: repoRoot, encoding: 'utf8' })
const pattern = /(export const FAIRY_PERSONA = `)([\s\S]*?)`/
const original = baseline.match(pattern)?.[2]
if (!original) throw new Error('the recorded A persona is missing')
mkdirSync(outputParent, { recursive: true })
const out = mkdtempSync(join(outputParent, 'run-'))
console.error(`Comparison reports: ${out}`)
const arms = withBuildLock(repoRoot, () => ['a', 'merged'].map(name => {
  const root = copyProductRepo(`ourfairy-312-${name}-`)
  cpSync(join(repoRoot, 'tests'), join(root, 'tests'), { recursive: true })
  const path = join(root, 'backend/chat/src/persona.ts')
  const source = readFileSync(path, 'utf8')
  if (name === 'a') writeFileSync(path, source.replace(pattern, (_match, prefix) => `${prefix}${original}\``))
  const persona = readFileSync(path, 'utf8').match(pattern)?.[2]
  if (!persona) throw new Error(`missing ${name} persona`)
  return { name, root, resolvedRoot: realpathSync(root), personaSha256: createHash('sha256').update(persona).digest('hex'), characters: [...persona].length }
}))
const results = []
try {
  for (const arm of arms) {
    const result = spawnSync(process.execPath, ['scripts/persona-acceptance.ts', '--samples', '1', '--only', only,
      '--out', join(out, `${arm.name}-real.json`)], { cwd: arm.root, env: process.env, stdio: 'inherit' })
    results.push({ ...arm, exitCode: result.status, ...(result.error ? { error: result.error.message } : {}) })
    writeFileSync(join(out, 'comparison.json'), `${JSON.stringify(results, null, 2)}\n`)
  }
} finally {
  for (const arm of arms) {
    const reportPath = join(out, `${arm.name}-real.json`)
    let report
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')) } catch { /* Retain interrupted artifacts for diagnosis. */ }
    if (typeof report?.finishedAt === 'string' && Number.isFinite(Date.parse(report.finishedAt)) &&
      !report.cleanupError && realpathSync(arm.root) === arm.resolvedRoot) rmSync(arm.root, { recursive: true })
    else console.error(`Retained comparison copy: ${arm.root}`)
  }
}
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1
