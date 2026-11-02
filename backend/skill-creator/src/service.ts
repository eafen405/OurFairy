/**
 * The skill runtime service: selection-pool derivation, catalog winners,
 * integrity-checked loading and read-only version directories.
 *
 * The store owns identities, versions and preferences. This module owns the
 * rules that turn them into what a user may use, and nothing else: it does not
 * register providers, mount routes or import seeds at boot (the row's
 * `index.ts` composes those around it). Keeping the decision here means the
 * provider, the HTTP pools and the later `skill_manage` tool read one winner
 * rule instead of three copies.
 *
 * ## Winner rule
 *
 * For one owner, the visible identities are every common identity plus their
 * own personal ones. A name has at most one personal and one common identity.
 * A personal identity wins when it is enabled and not archived; otherwise the
 * common identity wins when it is enabled and not archived. Preferences are
 * per user; a personal identity with no preference row is enabled by default,
 * a common one is disabled by default.
 *
 * ## Pool states
 *
 * `1 in_catalog` (the winner), `2 shadowed` (a common identity with an enabled
 * personal winner of the same name), `3 disabled` (effective preference off, or
 * enabled but not the winner for any other reason), `4 archived`. Archived
 * identities stay in the pool so the client can show their state and a later
 * ticket can restore them; they never enter a catalog.
 *
 * @module @ourfairy/dsh-skill-creator/src/service
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { sep } from 'node:path'
import { readSkillFrontmatter, readSkillPackage } from './package.js'
import { importReviewedPackage } from './seed.js'
import {
  SKILL_SCOPE,
  SOURCE_TYPE,
  VERSION_STATUS,
  type PreferenceRow,
  type SkillRow,
  type SkillStore,
  type SkillVersionRow,
} from './store.js'

/** The selection pool's derived presentation state. */
export const POOL_STATE = Object.freeze({ inCatalog: 1, shadowed: 2, disabled: 3, archived: 4 })

/** Who one action affects, or 0 when this caller is not offered it. */
export const ACTION_SCOPE = Object.freeze({ none: 0, owner: 1, everyone: 2 })

/** One visible version together with the preference facts derived for the caller. */
interface Candidate {
  readonly skill: SkillRow
  readonly version: SkillVersionRow
  readonly enabled: boolean
  readonly description: string
}

/** The winners and pool rows for one owner, derived in one pass. */
interface Evaluation {
  readonly candidates: Candidate[]
  readonly winners: Map<string, Candidate>
  readonly states: Map<number, { state: number; shadowedBy?: { skillId: number; name: string } }>
  /** The identities whose current version has a pending/changes-requested revision. */
  readonly openDrafts: ReadonlySet<number>
}

/** One selection-pool item as the client reads it. */
export interface PoolItem {
  readonly skillId: number
  readonly name: string
  readonly description: string
  readonly scope: number
  readonly state: number
  readonly enabled: boolean
  readonly currentVersionId: number | null
  readonly pendingRevision: boolean
  readonly actions: { readonly toggle: number; readonly archive: number; readonly restore: number }
  readonly shadowedBy?: { readonly skillId: number; readonly name: string }
}

/** The bounded detail view; same facts as a pool item plus the current version summary. */
export interface SkillDetail extends PoolItem {
  readonly ownerShortId: number | null
  readonly currentVersion: {
    readonly versionId: number
    readonly parentVersionId: number | null
    readonly manifestHash: string
    readonly coreCharacters: number
    readonly license: string | null
    readonly sourceType: number
    readonly sourceLocation: string | null
    readonly status: number
    readonly reviewer: number | null
    readonly reviewedAt: number | null
    readonly createdAt: number
  } | null
}

/** One catalog winner the provider turns into a candidate. */
export interface CatalogSkill {
  readonly skillId: number
  readonly versionId: number
  readonly name: string
  readonly description: string
  readonly manifestHash: string
  readonly directory: string
}

/** What activation returns after it has re-checked the database and the files. */
export interface LoadedSkill {
  readonly name: string
  readonly description: string
  readonly body: string
  readonly manifestHash: string
  readonly directory: string
}

/** A route-facing refusal whose message is the detail alone. */
export class SkillError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'SkillError'
    this.status = status
    this.code = code
  }
}

/** The service's own dependencies; no Cordis context leaks into this module. */
export interface SkillServiceOptions {
  /** The skill data root; version package paths are relative to it. */
  readonly root: string
  /** The deployment's trusted bundled skills root, contributed read-only to every session. */
  readonly bundledSkillsDir: string
}

/** Whether one absolute path is `root` or under it. */
function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** The default enablement: an unconfigured personal skill is on, a common one is off. */
function defaultEnabled(scope: number): boolean {
  return scope === SKILL_SCOPE.personal
}

/** The action scopes one identity offers this caller; a common lifecycle action is Phaethon's. */
function actionScopes(scope: number, isAdmin: boolean): PoolItem['actions'] {
  return {
    toggle: ACTION_SCOPE.owner,
    archive: scope === SKILL_SCOPE.personal ? ACTION_SCOPE.owner : isAdmin ? ACTION_SCOPE.everyone : ACTION_SCOPE.none,
    restore: scope === SKILL_SCOPE.personal ? ACTION_SCOPE.owner : isAdmin ? ACTION_SCOPE.everyone : ACTION_SCOPE.none,
  }
}

export class SkillService {
  readonly #store: SkillStore
  readonly #root: string
  readonly #bundledSkillsDir: string

  constructor(store: SkillStore, options: SkillServiceOptions) {
    this.#store = store
    this.#root = options.root
    this.#bundledSkillsDir = options.bundledSkillsDir
  }

  /** The durable data root; the row owns it and no other module reads it. */
  get root(): string {
    return this.#root
  }

  /** The trusted bundled skills root; the background creation prompt reads the Skill Creator from it. */
  get bundledSkillsDir(): string {
    return this.#bundledSkillsDir
  }

  /** Read one version's package directory, refusing a path that escapes the data root. */
  versionDirectory(version: SkillVersionRow): string {
    const parts = version.package_path.split('/')
    if (parts.some(part => part === '' || part === '.' || part === '..')) {
      throw new SkillError(500, 'skills/integrity', `skill version ${version.id} has an unsafe package path`)
    }
    const directory = [this.#root, ...parts].join(sep)
    if (!inside(this.#root, directory)) {
      throw new SkillError(500, 'skills/integrity', `skill version ${version.id} escapes the skill data root`)
    }
    return directory
  }

  /** The derived pool the authenticated user sees, in stable name/scope order. */
  pool(shortId: number, isAdmin = false): PoolItem[] {
    const evaluation = this.#evaluate(shortId)
    return evaluation.candidates.map(candidate => this.#poolItem(candidate, evaluation, isAdmin))
  }

  /** One visible skill's bounded detail; a skill outside the caller's scope is not found. */
  detail(shortId: number, skillId: number, isAdmin = false): SkillDetail {
    const evaluation = this.#evaluate(shortId)
    const candidate = evaluation.candidates.find(item => item.skill.id === skillId)
    if (candidate === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
    const item = this.#poolItem(candidate, evaluation, isAdmin)
    return {
      ...item,
      ownerShortId: candidate.skill.owner_short_id,
      currentVersion: {
        versionId: candidate.version.id,
        parentVersionId: candidate.version.parent_version_id,
        manifestHash: candidate.version.manifest_hash,
        coreCharacters: candidate.version.core_characters,
        license: candidate.version.license,
        sourceType: candidate.version.source_type,
        sourceLocation: candidate.version.source_location,
        status: candidate.version.status,
        reviewer: candidate.version.reviewer,
        reviewedAt: candidate.version.reviewed_at,
        createdAt: candidate.version.created_at,
      },
    }
  }

  /**
   * Persist one user's enable preference.
   *
   * The skill must be visible, not archived, and have an approved current
   * version. The scope comes from the identity, never from the request: a
   * common skill's preference is still this user's own.
   */
  setPreference(shortId: number, skillId: number, enabled: boolean, isAdmin = false): PoolItem {
    const evaluation = this.#evaluate(shortId)
    const candidate = evaluation.candidates.find(item => item.skill.id === skillId)
    if (candidate === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
    if (candidate.skill.archived_at !== null) {
      throw new SkillError(409, 'skills/archived', `skill "${candidate.skill.name}" is archived`)
    }
    this.#store.setPreference({ shortId, skillId, enabled })
    const updated = this.#evaluate(shortId)
    const item = updated.candidates.find(entry => entry.skill.id === skillId)
    if (item === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
    return this.#poolItem(item, updated, isAdmin)
  }

  /**
   * The catalog winners for one owner: every visible, enabled, non-archived
   * winner's current version, with the description from its `SKILL.md`.
   *
   * A package whose instruction file cannot be read is skipped rather than
   * advertised: a candidate without a description would fail the native
   * registry's validation and a body could not be loaded anyway. Activation
   * still re-reads and integrity-checks the package.
   */
  catalog(shortId: number): CatalogSkill[] {
    const evaluation = this.#evaluate(shortId)
    const catalog: CatalogSkill[] = []
    for (const winner of evaluation.winners.values()) {
      const description = winner.description
      if (description === '') continue
      let directory: string
      try {
        directory = this.versionDirectory(winner.version)
      } catch {
        continue
      }
      catalog.push({
        skillId: winner.skill.id,
        versionId: winner.version.id,
        name: winner.skill.name,
        description,
        manifestHash: winner.version.manifest_hash,
        directory,
      })
    }
    return catalog.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  }

  /**
   * Re-check and load one activation target.
   *
   * Every authority is consulted again: the version is still the skill's
   * approved current version, the identity is visible and not archived, the
   * caller's preference still wins the name, and the package on disk still
   * hashes to the approved manifest. A mismatch throws rather than serving the
   * changed bytes; a no-longer-available skill answers undefined.
   */
  load(shortId: number, versionId: number): LoadedSkill | undefined {
    const version = this.#store.version(versionId)
    if (version === undefined || version.status !== VERSION_STATUS.approvedCurrent) return undefined
    const skill = this.#store.identity(version.skill_id)
    if (skill === undefined || skill.current_version_id !== version.id || skill.archived_at !== null) return undefined
    if (skill.scope !== SKILL_SCOPE.common && skill.owner_short_id !== shortId) return undefined
    const evaluation = this.#evaluate(shortId)
    if (![...evaluation.winners.values()].some(winner => winner.skill.id === skill.id)) return undefined
    const directory = this.versionDirectory(version)
    // The full package read is the integrity check: it re-walks every file,
    // rejects symlinks and non-regular entries, re-reads the frontmatter and
    // recomputes the canonical manifest hash.
    const manifest = this.#readManifest(directory, skill.name, version.manifest_hash)
    return {
      name: skill.name,
      description: manifest.description,
      body: manifest.body,
      manifestHash: manifest.manifestHash,
      directory,
    }
  }

  /** Read a package for activation and enforce the approved manifest hash. */
  #readManifest(directory: string, name: string, approvedHash: string) {
    let parsed
    try {
      parsed = readSkillPackage(directory)
    } catch {
      throw new SkillError(500, 'skills/integrity', `skill package integrity check failed for ${name}`)
    }
    if (parsed.manifestHash !== approvedHash) {
      throw new SkillError(500, 'skills/integrity', `skill package integrity check failed for ${name}`)
    }
    return parsed
  }

  /**
   * The read-only directories a session may see: the trusted bundled root on
   * every session, and the current version directories of the skills that
   * actually enter this owner's catalog.
   *
   * Never the data root, `versions/` or `tmp/`: a model that guesses a sibling
   * path must not reach an unapproved version or another user's package.
   */
  readonlyVersionDirs(shortId: number | undefined): string[] {
    const directories: string[] = []
    const bundled = this.#realDirectory(this.#bundledSkillsDir)
    if (bundled !== undefined) directories.push(bundled)
    if (shortId === undefined) return directories
    const evaluation = this.#evaluate(shortId)
    for (const winner of evaluation.winners.values()) {
      const directory = this.#realDirectory(this.versionDirectory(winner.version))
      if (directory !== undefined) directories.push(directory)
    }
    return [...new Set(directories)]
  }

  /** Import each top-level package under `seedDir` as a common approved seed. */
  importSeedDirectory(seedDir: string, log: (level: 'info' | 'warn', message: string) => void): number {
    if (seedDir === '' || !existsSync(seedDir)) return 0
    let info
    try {
      info = statSync(seedDir)
    } catch {
      return 0
    }
    if (!info.isDirectory()) return 0
    let imported = 0
    for (const packageDir of seedPackageDirectories(seedDir)) {
      try {
        const { name } = readSkillFrontmatter(packageDir)
        if (this.#store.activeIdentity({ scope: SKILL_SCOPE.common, ownerShortId: undefined, name }) !== undefined) {
          log('info', `seed skill "${name}" already has an active common identity; skipped`)
          continue
        }
        importReviewedPackage({
          root: this.#root,
          store: this.#store,
          packageDir,
          scope: SKILL_SCOPE.common,
          createdBy: 0,
          sourceType: SOURCE_TYPE.seed,
        })
        imported += 1
        log('info', `imported seed skill "${name}"`)
      } catch (error) {
        log('warn', `seed skill at ${packageDir} was not imported: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return imported
  }

  /** Resolve one existing directory through realpath, or undefined. */
  #realDirectory(path: string): string | undefined {
    try {
      if (!statSync(path).isDirectory()) return undefined
      return realpathSync(path)
    } catch {
      return undefined
    }
  }

  /**
   * Derive candidates, winners and pool states for one owner in a single pass.
   *
   * A visible identity without a current approved version is not a pool item:
   * candidates and drafts live in the separate review area.
   */
  #evaluate(shortId: number): Evaluation {
    const preferences = new Map<number, PreferenceRow>(this.#store.preferences(shortId).map(row => [row.skill_id, row]))
    const openDrafts = this.#store.openDraftSkillIds(shortId)
    const candidates: Candidate[] = []
    for (const skill of this.#store.visibleIdentities(shortId)) {
      if (skill.current_version_id === null) continue
      const version = this.#store.version(skill.current_version_id)
      if (version === undefined || version.status !== VERSION_STATUS.approvedCurrent || version.skill_id !== skill.id) continue
      const preference = preferences.get(skill.id)
      const enabled = preference === undefined ? defaultEnabled(skill.scope) : preference.enabled === 1
      candidates.push({ skill, version, enabled, description: this.#description(version) })
    }
    const byName = new Map<string, Candidate[]>()
    for (const candidate of candidates) {
      const group = byName.get(candidate.skill.name) ?? []
      group.push(candidate)
      byName.set(candidate.skill.name, group)
    }
    const winners = new Map<string, Candidate>()
    for (const [name, group] of byName) {
      const personal = group.find(candidate => candidate.skill.scope === SKILL_SCOPE.personal
        && candidate.skill.archived_at === null && candidate.enabled)
      const common = group.find(candidate => candidate.skill.scope === SKILL_SCOPE.common
        && candidate.skill.archived_at === null && candidate.enabled)
      const winner = personal ?? common
      if (winner !== undefined) winners.set(name, winner)
    }
    const states = new Map<number, { state: number; shadowedBy?: { skillId: number; name: string } }>()
    for (const candidate of candidates) {
      const winner = winners.get(candidate.skill.name)
      if (candidate.skill.archived_at !== null) {
        states.set(candidate.skill.id, { state: POOL_STATE.archived })
        continue
      }
      if (winner?.skill.id === candidate.skill.id) {
        states.set(candidate.skill.id, { state: POOL_STATE.inCatalog })
        continue
      }
      if (candidate.skill.scope === SKILL_SCOPE.common && candidate.enabled) {
        const personal = candidates.find(other => other.skill.name === candidate.skill.name
          && other.skill.scope === SKILL_SCOPE.personal
          && other.skill.archived_at === null && other.enabled)
        if (personal !== undefined) {
          states.set(candidate.skill.id, {
            state: POOL_STATE.shadowed,
            shadowedBy: { skillId: personal.skill.id, name: personal.skill.name },
          })
          continue
        }
      }
      states.set(candidate.skill.id, { state: POOL_STATE.disabled })
    }
    return { candidates, winners, states, openDrafts }
  }

  /** Read one version's description for display, tolerating a missing/broken file. */
  #description(version: SkillVersionRow): string {
    try {
      return readSkillFrontmatter(this.versionDirectory(version)).description
    } catch {
      return ''
    }
  }

  /** One pool item from a candidate and the evaluation's state facts. */
  #poolItem(candidate: Candidate, evaluation: Evaluation, isAdmin: boolean): PoolItem {
    const state = evaluation.states.get(candidate.skill.id) ?? { state: POOL_STATE.disabled }
    return {
      skillId: candidate.skill.id,
      name: candidate.skill.name,
      description: candidate.description,
      scope: candidate.skill.scope,
      state: state.state,
      enabled: candidate.enabled,
      currentVersionId: candidate.skill.current_version_id,
      pendingRevision: evaluation.openDrafts.has(candidate.skill.id),
      actions: actionScopes(candidate.skill.scope, isAdmin),
      ...(state.shadowedBy === undefined ? {} : { shadowedBy: state.shadowedBy }),
    }
  }
}

/** Every top-level directory under the seed root that carries a `SKILL.md`. */
function seedPackageDirectories(seedDir: string): string[] {
  return readdirSync(seedDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(`${seedDir}/${entry.name}/SKILL.md`))
    .map(entry => `${seedDir}/${entry.name}`)
    .sort()
}
