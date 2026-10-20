/**
 * Test-only shell provider that stands in for the `scoped-bash` row.
 *
 * An overlay cannot rename an existing row's module: a patch carrying both
 * `id` and `name` only checks the name and skips the patch on a mismatch.
 * Replacing a provider therefore means disabling its row and inserting another
 * row that provides the same `shell` service. This module is that replacement:
 * it extends the same native executor the product row extends and prefixes the
 * command's stdout, so a caller can tell which module actually ran.
 *
 * The class comes from the pinned dsh checkout. A bare specifier does not
 * resolve from this directory (it is not installed in the profile), and the
 * loader's runtime resolution did not answer it for an overlay module, so the
 * fixture imports the built package by its absolute path. That is the same
 * module file the profile's own `@ourfairy/dsh-spaces/bash` row extends.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const combo = JSON.parse(readFileSync(join(here, '..', '..', 'combo.json'), 'utf8'))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const { SandboxBashExecutor } = await import(
  pathToFileURL(join(dshDir, 'packages', 'shell', 'bash-sandbox', 'lib', 'index.js')).href
)

/** The row id is supplied by the overlay; the package name names this fixture. */
export const name = 'ourfairy-recording-bash-provider'

export default class RecordingBashProvider extends SandboxBashExecutor {
  /** The same service dependencies as the production provider. */
  static inject = [...SandboxBashExecutor.inject]

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
