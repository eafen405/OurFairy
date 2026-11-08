/**
 * The stored skill package path vocabulary.
 *
 * A version's `package_path` is a POSIX path relative to the skill data root:
 * `candidates/<uuid>` while the row is a draft, `versions/<skillId>/<uuid>` once
 * it is approved (README, "The data root"). This module is the one place that
 * knows those names and the validation they share. It also owns the crash
 * re-home a candidate needs when a process dies between the approval's rename
 * into `versions/` and its database transaction, so the read path and the boot
 * reconciliation run one algorithm instead of two.
 *
 * It is deliberately pure: `node:fs`/`node:path` only, no store, service or
 * transaction. Publish and seed keep their own transaction + rename + rollback
 * order and only borrow the names and directories from here; this module never
 * decides when a package moves.
 *
 * @module @ourfairy/dsh-skill-creator/src/paths
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'

/** The data root's area names; the only place the candidate/version vocabulary is written. */
export const SKILL_DIR = Object.freeze({
  candidates: 'candidates',
  versions: 'versions',
  tmp: 'tmp',
  verify: 'verify',
} as const)

/** One validated relative package path, as its segments. */
export interface PackagePath {
  readonly segments: readonly string[]
}

/** A NUL, a newline or any other control character has no place in a stored path. */
const CONTROL_CHARACTER = /\p{Cc}/u

/** A bare drive letter is a platform-specific anchor, never a data-root area. */
const DRIVE_LETTER = /^[A-Za-z]:$/u

/**
 * Validate one stored package path against the data-root rules.
 *
 * A path is safe when it is relative, uses `/` only, names at least one package
 * directory below an area (`candidates/<uuid>` is the shallowest legal shape)
 * and never contains an empty, `.` or `..` segment. Backslashes, control
 * characters and a drive-letter first segment are refused too: they are legal
 * bytes in an SQLite text column but change meaning at the OS boundary, and
 * every row this product writes comes from {@link candidatePackagePath} or
 * {@link versionPackagePath}, so no stored row can be refused by the stricter
 * rule. The area shape (`candidates/...` for a draft) stays with the caller.
 *
 * @param relative - the path as the row stores it.
 * @returns the validated segments, or `undefined` when the path is not safe.
 */
export function checkPackagePath(relative: string): PackagePath | undefined {
  if (relative === '' || relative.startsWith('/')) return undefined
  if (relative.includes('\\') || CONTROL_CHARACTER.test(relative)) return undefined
  const segments = relative.split('/')
  // The shallowest legal package path is `area/package`; a single segment names
  // the area itself, not a package.
  if (segments.length < 2) return undefined
  const area = segments[0]
  if (area === undefined || DRIVE_LETTER.test(area)) return undefined
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return undefined
  return { segments }
}

/** Whether one absolute path is `root` or under it. */
export function insideRoot(root: string, absolute: string): boolean {
  return absolute === root || absolute.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Resolve one validated path's directory under the data root. */
export function packageDirectory(root: string, segments: readonly string[]): string {
  return join(root, ...segments)
}

/** The row value of one candidate package: always under `candidates/`. */
export function candidatePackagePath(candidateId: string): string {
  return `${SKILL_DIR.candidates}/${candidateId}`
}

/** The row value of one approved version package: `versions/<skillId>/<packageId>`. */
export function versionPackagePath(skillId: number, packageId: string): string {
  return `${SKILL_DIR.versions}/${String(skillId)}/${packageId}`
}

/** What one candidate directory check found. */
export type CandidatePackageState = 'present' | 'rehomed' | 'missing'

/** One recorded candidate and the identity whose `versions/` area may hold it. */
export interface RehomeCandidatePackageInput {
  readonly root: string
  /** The row's `package_path`; validated here so no caller joins an unchecked path. */
  readonly packagePath: string
  readonly skillId: number
}

/**
 * Find a candidate directory, moving it back from `versions/` when a crash
 * displaced it.
 *
 * An approval renames `candidates/<uuid>/` into `versions/<skillId>/<uuid>/`
 * before opening its transaction. A process killed in that window leaves a
 * pending row still pointing at `candidates/<uuid>/` while the bytes sit under
 * `versions/<skillId>/<uuid>/`; moving them back makes the candidate
 * inspectable again instead of a permanent integrity failure. The read path and
 * the boot reconciliation share this one rule.
 *
 * @returns `present` when the recorded directory already holds the bytes,
 * `rehomed` when it was moved back, `missing` when neither location has them
 * (an unsafe stored path is `missing`: it can never be re-homed).
 */
export function rehomeCandidatePackage(input: RehomeCandidatePackageInput): CandidatePackageState {
  const checked = checkPackagePath(input.packagePath)
  if (checked === undefined) return 'missing'
  const directory = packageDirectory(input.root, checked.segments)
  // The recorded path is the row's fact: whatever shape it has, an existing
  // directory means there is nothing to repair. Only a candidate row is moved.
  if (existsSync(directory)) return 'present'
  const [area, packageId] = checked.segments
  if (checked.segments.length !== 2 || area !== SKILL_DIR.candidates || packageId === undefined) return 'missing'
  const displaced = packageDirectory(input.root, [SKILL_DIR.versions, String(input.skillId), packageId])
  if (!existsSync(displaced)) return 'missing'
  mkdirSync(packageDirectory(input.root, [SKILL_DIR.candidates]), { recursive: true })
  try {
    renameSync(displaced, directory)
  } catch {
    // A concurrent reader may have re-homed the same candidate between the
    // check and the rename; a candidate directory that now exists is usable.
    return existsSync(directory) ? 'present' : 'missing'
  }
  return 'rehomed'
}
