/**
 * One package's published name, read from its own manifest.
 *
 * The manifest is the authority. The repository's package names do not follow a
 * derivable pattern — `backend/probe` publishes `@ourfairy/dsh-baseline-probe`
 * — so a name that is not read from the manifest would be an invention, and
 * an invented name names a package that does not exist.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One package's published name, read from its manifest.
 * @param manifestPath - absolute path of the package's `package.json`.
 * @returns the published name, or undefined when the manifest declares none.
 */
export function manifestName(manifestPath: string): string | undefined {
  // The manifest is the package's own file; npm declares `name` as a string.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
  return typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : undefined
}

/**
 * One package directory's published name, read from the manifest it carries.
 * @param dir - absolute package directory.
 * @returns the published name, or undefined when there is no manifest or it names none.
 */
export function packageNameOf(dir: string): string | undefined {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  return manifestName(manifestPath)
}
