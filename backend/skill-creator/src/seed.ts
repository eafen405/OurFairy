/**
 * Import one already-reviewed skill package into the store and the immutable
 * version area.
 *
 * This is the narrow `./seed` subpath: it depends on the store and the package
 * reader only, never on a Cordis context. The deployment seed imports through
 * it at boot, and tests use it to create a personal or common reviewed skill
 * before a boot — both go through the same validation, the same canonical
 * manifest and the same `versions/<skillId>/<uuid>/` layout, so a fixture
 * cannot approve content the runtime would reject.
 *
 * The write is staged in `tmp/` and moved into `versions/` inside the store's
 * import transaction. A failure removes the staged or moved directory, so a
 * crash cannot leave a half-imported package in the readable version area.
 *
 * @module @ourfairy/dsh-skill-creator/src/seed
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { PackageError, canonicalManifest, copySkillPackage, readSkillPackage } from './package.js'
import { SKILL_DIR, packageDirectory, versionPackagePath } from './paths.js'
import type { ImportedVersion, SkillStore } from './store.js'

/** What one seed import produced. */
export interface SeededSkill extends ImportedVersion {
  readonly name: string
  readonly manifestHash: string
}

/** The seed import's arguments; every caller names the same facts. */
export interface ImportReviewedPackageOptions {
  /** The skill data root: `versions/`, `tmp/` and the database live under it. */
  readonly root: string
  readonly store: SkillStore
  /** The source package directory to validate and copy. */
  readonly packageDir: string
  /** 1 personal, 2 common. */
  readonly scope: number
  /** Required for a personal skill; omitted for a common one. */
  readonly ownerShortId?: number
  readonly createdBy: number
  readonly sourceType: number
  readonly sourceLocation?: string
  /** Insert (or replace) one user's enable preference for the imported skill. */
  readonly preference?: { readonly shortId: number; readonly enabled: boolean }
  readonly proposedBy?: number
}

/**
 * Validate, stage, move and record one reviewed package.
 *
 * @throws {PackageError} when the package itself is invalid.
 * @throws {SkillStoreError} when the identity is archived or the store refuses.
 */
export function importReviewedPackage(options: ImportReviewedPackageOptions): SeededSkill {
  const { root, store, packageDir, scope, ownerShortId, createdBy, sourceType, sourceLocation, preference } = options
  const parsed = readSkillPackage(packageDir)
  const tmpRoot = packageDirectory(root, [SKILL_DIR.tmp])
  const versionsRoot = packageDirectory(root, [SKILL_DIR.versions])
  mkdirSync(tmpRoot, { recursive: true })
  mkdirSync(versionsRoot, { recursive: true })
  const staging = packageDirectory(root, [SKILL_DIR.tmp, randomUUID()])
  let moved: string | undefined
  try {
    copySkillPackage(packageDir, staging)
    // Re-validate the copy: the source can change between the read above and
    // the copy, and the immutable version area must record the bytes actually
    // moved into it, not a hash of bytes that were never stored.
    const staged = readSkillPackage(staging)
    if (staged.manifestHash !== parsed.manifestHash) {
      throw new PackageError('skill package changed between validation and copy; import it again')
    }
    const imported = store.importReviewed({
      name: staged.name,
      scope,
      ...(ownerShortId === undefined ? {} : { ownerShortId }),
      createdBy,
      ...(options.proposedBy === undefined ? {} : { proposedBy: options.proposedBy }),
      manifest: canonicalManifest(staged.manifest),
      manifestHash: staged.manifestHash,
      coreCharacters: staged.coreCharacters,
      ...(staged.license === undefined ? {} : { license: staged.license }),
      sourceType,
      ...(sourceLocation === undefined ? {} : { sourceLocation }),
      reviewer: createdBy,
      reviewedAt: Date.now(),
      ...(preference === undefined ? {} : { preference }),
    }, (skillId) => {
      const packageId = basename(staging)
      const relative = versionPackagePath(skillId, packageId)
      const final = packageDirectory(root, [SKILL_DIR.versions, String(skillId), packageId])
      mkdirSync(packageDirectory(root, [SKILL_DIR.versions, String(skillId)]), { recursive: true })
      renameSync(staging, final)
      moved = final
      return relative
    })
    return { ...imported, name: staged.name, manifestHash: staged.manifestHash }
  } catch (error) {
    // `renameSync` runs inside the store's transaction; a rollback leaves the
    // moved directory orphaned, so the import removes it here.
    rmSync(staging, { recursive: true, force: true })
    if (moved !== undefined) rmSync(moved, { recursive: true, force: true })
    throw error
  }
}
