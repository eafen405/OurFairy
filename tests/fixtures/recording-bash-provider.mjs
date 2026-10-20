/**
 * Test-only replacement for the `scoped-bash` row.
 *
 * An overlay cannot rename an existing row's module: a patch carrying both
 * `id` and `name` only checks the name and skips the patch on a mismatch.
 * Replacing a provider therefore means disabling its row and inserting another
 * row that provides the same `shell` service. This module is that replacement:
 * it extends the product's own ScopedBash class and prefixes the command's
 * stdout, so a caller can tell which module actually ran while the replacement
 * keeps the product's scope validation and confined execution.
 *
 * The loader loads this fixture from the checkout, where neither the product
 * package nor dsh's packages resolve. The product module is therefore resolved
 * from the profile the launcher just installed: its installed copy carries the
 * hoisted dsh dependencies next to it, so its bare imports resolve. The fixture
 * reads `DSH_HOME` (set by the launcher) and the profile name from combo.json;
 * the module it imports is the same installed copy the replaced row uses.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const combo = JSON.parse(readFileSync(join(here, '..', '..', 'combo.json'), 'utf8'))
const dshHome = process.env.DSH_HOME
if (dshHome === undefined || dshHome === '') {
  throw new Error('recording-bash-provider needs DSH_HOME to resolve the installed product provider')
}
const profileDir = join(dshHome, 'profiles', combo.backend.profileName)
const installedRequire = createRequire(join(profileDir, 'package.json'))
const { default: ScopedBash } = await import(
  pathToFileURL(installedRequire.resolve('@ourfairy/dsh-spaces/bash')).href
)

/** The row id is supplied by the overlay; the package name names this fixture. */
export const name = 'ourfairy-recording-bash-provider'

export default class RecordingBashProvider extends ScopedBash {
  /** The same service dependencies as the production provider. */
  static inject = [...ScopedBash.inject]

  async execute(spec) {
    const execution = await super.execute(spec)
    const base = execution.result.bind(execution)
    let decorated
    execution.result = () => (decorated ??= base().then(result => ({
      ...result,
      stdout: { ...result.stdout, text: `[fixture] ${result.stdout.text}` },
    })))
    return execution
  }
}
