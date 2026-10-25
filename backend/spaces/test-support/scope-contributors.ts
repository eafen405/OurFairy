// Test-only profile row: two independent contributors register on the space
// scope and are torn down one at a time. No HTTP route and no model turn.
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionOwnerId } from '@deepseek-ai/dsh-session'
// The product's own seam: the space scope this fixture contributes to.
import type {} from '@ourfairy/dsh-spaces'

export const name = 'ourfairy-scope-contributor-fixtures'
export const inject = ['ourfairySpaces']

/** One contributor plugin: its own extra root and read-only file, released by its own ctx.effect. */
const contributor = ({ root, file }: { readonly root: string; readonly file: string }) => ({
  name: 'ourfairy-scope-contributor-fixture',
  inject: ['ourfairySpaces'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.ourfairySpaces.contributeExtraRoots(() => [root]), 'fixture extra root')
    ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(() => [file]), 'fixture read-only file')
  },
})

/** The fixture's own configuration: the short id it stands in for and the paths it contributes. */
export interface ScopeContributorConfig {
  readonly shortId: number
  readonly reportPath: string
  readonly firstRoot: string
  readonly firstFile: string
  readonly secondRoot: string
  readonly secondFile: string
}

/** One recorded step of the fixture: the roots the scope held at that moment. */
interface ScopeStep {
  label: string
  writeRoots: string[]
  readRoots: string[]
}

/**
 * Register two contributors, unload them one at a time, and record the roots
 * each step observes. Roots derive from `SessionHeader.owner` alone, so the
 * fixture uses a header-shaped session instead of a durable one.
 */
export async function apply(ctx: Context, config: ScopeContributorConfig): Promise<void> {
  const scope = ctx.ourfairySpaces
  // The fixture stands in a header-shaped session: the scope's authority is the
  // immutable owner header, so the branded id and owner are written here.
  const session = {
    id: 'scope-contributor-fixture' as SessionId,
    header: { owner: `user:${config.shortId}` as SessionOwnerId },
  }
  const report: { steps: ScopeStep[]; error?: string } = { steps: [] }
  const record = (label: string) => report.steps.push({
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
    // The caught value's shape is unknown: read its optional `stack` defensively, stringify the rest.
    report.error = (error as { stack?: string }).stack ?? String(error)
  }
  writeFileSync(config.reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
}
