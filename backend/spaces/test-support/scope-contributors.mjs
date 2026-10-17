// Test-only profile row: two independent contributors register on the space
// scope and are torn down one at a time. No HTTP route and no model turn.
import { writeFileSync } from 'node:fs'

export const name = 'ourfairy-scope-contributor-fixtures'
export const inject = ['ourfairySpaces']

/** One contributor plugin: its own extra root and read-only file, released by its own ctx.effect. */
const contributor = ({ root, file }) => ({
  name: 'ourfairy-scope-contributor-fixture',
  inject: ['ourfairySpaces'],
  apply(ctx) {
    ctx.effect(() => ctx.ourfairySpaces.contributeExtraRoots(() => [root]), 'fixture extra root')
    ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(() => [file]), 'fixture read-only file')
  },
})

/**
 * Register two contributors, unload them one at a time, and record the roots
 * each step observes. Roots derive from `SessionHeader.owner` alone, so the
 * fixture uses a header-shaped session instead of a durable one.
 */
export async function apply(ctx, config) {
  const scope = ctx.ourfairySpaces
  const session = { id: 'scope-contributor-fixture', header: { owner: `user:${config.shortId}` } }
  const report = { steps: [] }
  const record = label => report.steps.push({
    label, writeRoots: scope.writeRoots(session), readRoots: scope.readRoots(session),
  })
  try {
    const first = ctx.plugin(contributor({ root: config.firstRoot, file: config.firstFile }))
    const second = ctx.plugin(contributor({ root: config.secondRoot, file: config.secondFile }))
    await Promise.all([first, second])
    record('both')
    await first.dispose()
    record('after-first-disposed')
    await second.dispose()
    record('after-second-disposed')
  } catch (error) {
    report.error = error.stack ?? String(error)
  }
  writeFileSync(config.reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
}
