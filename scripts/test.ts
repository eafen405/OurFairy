#!/usr/bin/env node
/** Build and test one worktree without letting another build remove its output. */
import { spawnSync } from 'node:child_process'
import { isCliEntry } from './cli-guard.ts'
import { buildProducts, repoRoot, withBuildLock } from './tsc.ts'

export const TEST_GLOB = 'tests/**/*.test.mjs'

/** Node's test flags and file paths are forwarded unchanged. */
export function runTests(root = repoRoot, args: string[] = []): number {
  return withBuildLock(root, fd => {
    const build = buildProducts(root, { fresh: true })
    if (build.output !== '') process.stdout.write(build.output)
    if (build.status !== 0) return build.status
    const result = spawnSync(process.execPath, [
      '--test', ...(args.length === 0 ? [TEST_GLOB] : args),
    ], { cwd: root, stdio: ['inherit', 'inherit', 'inherit', fd] })
    if (result.error !== undefined) process.stderr.write(`${result.error.message}\n`)
    return result.status ?? 1
  })
}

if (isCliEntry(import.meta.main)) process.exitCode = runTests(repoRoot, process.argv.slice(2))
