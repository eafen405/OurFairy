/**
 * Skill-package validation: the one algorithm every entry point uses.
 *
 * A skill package is a directory containing `SKILL.md` and optional files. The
 * creator validates a package when it is imported (seed today; explicit
 * creation, install and evolution in later tickets) and the runtime re-reads
 * the same package when it activates a skill. The manifest algorithm lives here
 * once, so "what was approved" and "what activates" cannot disagree.
 *
 * The frontmatter reader is deliberately a small subset of YAML rather than a
 * YAML dependency: a flat map of `key: value` lines, quoted scalars and
 * booleans. Skill packages are product-written files, and the native
 * filesystem provider parses the same frontmatter with a full YAML reader; a
 * package this reader accepts is also accepted there. Unsupported YAML
 * (nested maps/lists, block scalars, anchors, tags) is refused with a message
 * naming the line, not silently misread.
 *
 * The canonical manifest sorts entries by POSIX relative path and records each
 * file's type, SHA-256 digest and executable bit. Timestamps, owners and
 * permissions beyond the executable bit are excluded, so the same content has
 * one hash on every machine. Symlinks and non-regular files are refused rather
 * than followed.
 *
 * @module @ourfairy/dsh-skill-creator/src/package
 */
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** A skill name is lower-case kebab-case, exactly as the native registry requires. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** The native catalog's description budget, in Unicode code points. */
export const DESCRIPTION_MAX_CHARACTERS = 500

/** The core workflow body budget, in Unicode code points. */
export const CORE_BODY_MAX_CHARACTERS = 8000

/** Default package bounds; the install path may narrow the byte bound with Config. */
export const DEFAULT_MAX_PACKAGE_BYTES = 10 * 1024 * 1024
export const DEFAULT_MAX_PACKAGE_FILES = 512

/** The frontmatter keys this reader interprets; every other key is carried verbatim. */
export type FrontmatterValue = string | boolean

/** One parsed `SKILL.md`: its flat frontmatter map and its body after the closing marker. */
export interface SkillFrontmatter {
  readonly attributes: Readonly<Record<string, FrontmatterValue>>
  readonly body: string
}

/** One file in the canonical manifest. */
export interface ManifestEntry {
  readonly path: string
  readonly type: 'file'
  readonly sha256: string
  readonly executable: boolean
}

/** One validated package, as import and activation both read it. */
export interface ParsedSkillPackage {
  readonly name: string
  readonly description: string
  /** The file's own `user-invocable` choice; the runtime still forces product skills off. */
  readonly userInvocable: boolean
  readonly license: string | undefined
  /** The instruction body with the frontmatter and surrounding whitespace removed. */
  readonly body: string
  /** Unicode code-point count of {@link body}. */
  readonly coreCharacters: number
  readonly manifest: readonly ManifestEntry[]
  readonly manifestHash: string
  readonly bytes: number
}

/** A package this reader refuses, with a stable code for the row's error surface. */
export class PackageError extends Error {
  readonly code = 'skills/invalid-package'

  constructor(message: string) {
    super(message)
    this.name = 'PackageError'
  }
}

/** The JSON form one entry contributes to the canonical manifest. */
function canonicalEntry(entry: ManifestEntry): ManifestEntry {
  return { path: entry.path, type: entry.type, sha256: entry.sha256, executable: entry.executable }
}

/**
 * The canonical manifest document: entries already sorted by path, each with
 * exactly the four manifest fields in the same order. JSON of this value is the
 * pre-image of {@link manifestHash}.
 */
export function canonicalManifest(manifest: readonly ManifestEntry[]): string {
  return JSON.stringify(manifest.map(canonicalEntry))
}

/** The SHA-256 of the canonical manifest document, lower-case hex. */
export function manifestHashOf(manifest: readonly ManifestEntry[]): string {
  return createHash('sha256').update(canonicalManifest(manifest)).digest('hex')
}

/** The SHA-256 of one file's bytes, lower-case hex. */
export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Unicode code-point count, not UTF-16 units. */
export function codePoints(text: string): number {
  return [...text].length
}

/**
 * Refuse a package path that could escape the package root or name a host
 * location. Paths are POSIX relative from the manifest's point of view even on
 * a Windows host, so a backslash is refused rather than interpreted.
 */
export function assertPackagePath(path: string): void {
  if (path === '') throw new PackageError('a package path must not be empty')
  if (path.includes('\0')) throw new PackageError(`a package path must not contain NUL: ${JSON.stringify(path)}`)
  if (path.includes('\\')) throw new PackageError(`a package path must use "/" separators: ${JSON.stringify(path)}`)
  if (path.startsWith('/')) throw new PackageError(`a package path must be relative: ${JSON.stringify(path)}`)
  if (/^[A-Za-z]:/u.test(path)) throw new PackageError(`a package path must not name a drive: ${JSON.stringify(path)}`)
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new PackageError(`a package path must not contain an empty, "." or ".." segment: ${JSON.stringify(path)}`)
    }
    // Control characters make a path unreadable in logs and in an error message;
    // a package written by the product never needs one.
    if (/[\u0000-\u001f]/u.test(segment)) {
      throw new PackageError(`a package path must not contain control characters: ${JSON.stringify(path)}`)
    }
  }
}

/** Split `SKILL.md` into frontmatter attributes and body, or refuse the shape. */
export function parseSkillMarkdown(text: string): SkillFrontmatter {
  const lines = text.split(/\r?\n/u)
  if ((lines[0] ?? '').trim() !== '---') {
    throw new PackageError('SKILL.md must start with a "---" frontmatter line')
  }
  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === '---') { closing = index; break }
  }
  if (closing < 0) throw new PackageError('SKILL.md frontmatter is not closed by a "---" line')

  const attributes: Record<string, FrontmatterValue> = {}
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    if (/^\s/u.test(line)) {
      throw new PackageError(`SKILL.md frontmatter supports only single-line "key: value" entries; line ${index + 1} is indented`)
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/u.exec(line)
    if (match === null) {
      throw new PackageError(`SKILL.md frontmatter line ${index + 1} is not a "key: value" entry`)
    }
    const key = match[1] as string
    const raw = (match[2] ?? '').trim()
    if (Object.hasOwn(attributes, key)) throw new PackageError(`SKILL.md frontmatter repeats the key "${key}"`)
    attributes[key] = parseFrontmatterValue(key, raw, index + 1)
  }
  const body = lines.slice(closing + 1).join('\n').trim()
  return { attributes, body }
}

/** Read one flat frontmatter value: quoted scalar, boolean, or a plain string. */
function parseFrontmatterValue(key: string, raw: string, line: number): FrontmatterValue {
  if (raw === '') return ''
  if (raw.startsWith('"')) {
    if (!raw.endsWith('"') || raw.length < 2) {
      throw new PackageError(`SKILL.md frontmatter "${key}" on line ${line} has an unterminated double quote`)
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'string') throw new PackageError(`SKILL.md frontmatter "${key}" must be a string`)
      return parsed
    } catch (error) {
      if (error instanceof PackageError) throw error
      throw new PackageError(`SKILL.md frontmatter "${key}" on line ${line} is not a valid quoted scalar`)
    }
  }
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'") || raw.length < 2) {
      throw new PackageError(`SKILL.md frontmatter "${key}" on line ${line} has an unterminated single quote`)
    }
    return raw.slice(1, -1).replaceAll("''", "'")
  }
  // YAML block/nested/anchor syntax has no meaning in this subset; name it
  // instead of treating it as text a native YAML reader would interpret.
  if (/^[[{|>&*!%@`]/u.test(raw)) {
    throw new PackageError(`SKILL.md frontmatter "${key}" on line ${line} uses YAML syntax this reader does not support`)
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

/** An author-machine home path; a package must use relative paths or neutral examples. */
const HOST_HOME_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+/u

/** Refuse text content that embeds an author-machine absolute home path. */
function assertNoHostPaths(files: readonly { readonly path: string; readonly bytes: Buffer }[]): void {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (const file of files) {
    // A NUL byte is the product's cheap binary marker; binary resources are not
    // instruction text and cannot carry a usable host path for the reader.
    if (file.bytes.includes(0)) continue
    let text: string
    try {
      text = decoder.decode(file.bytes)
    } catch {
      continue
    }
    if (HOST_HOME_PATH.test(text)) {
      throw new PackageError(`${file.path} contains an absolute host home path; use a relative package path or a deployment-neutral example`)
    }
  }
}

/** The directory root of a package, refusing a symlink at the package itself. */
function assertPackageRoot(dir: string): void {
  const info = lstatSync(dir, { throwIfNoEntry: false })
  if (info === undefined) throw new PackageError(`skill package directory does not exist: ${dir}`)
  if (info.isSymbolicLink()) throw new PackageError(`skill package directory must not be a symlink: ${dir}`)
  if (!info.isDirectory()) throw new PackageError(`skill package path is not a directory: ${dir}`)
}

/** Read one package file's bytes, refusing a symlink at the entry. */
function readPackageFile(path: string): { bytes: Buffer; executable: boolean } {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new PackageError(`skill packages must not contain symlinks: ${path}`)
  if (!info.isFile()) throw new PackageError(`skill packages may contain only regular files: ${path}`)
  return { bytes: readFileSync(path), executable: (info.mode & 0o111) !== 0 }
}

/**
 * Walk a package and build its canonical manifest plus per-file bytes.
 *
 * The walk is recursive and deterministic: entries are visited in name order and
 * the manifest is sorted by full POSIX path afterwards. Only files are entries;
 * directories are structural and an empty directory contributes nothing.
 */
export function walkPackage(dir: string): { manifest: ManifestEntry[]; files: { path: string; bytes: Buffer; executable: boolean }[]; bytes: number } {
  assertPackageRoot(dir)
  const manifest: ManifestEntry[] = []
  const files: { path: string; bytes: Buffer; executable: boolean }[] = []
  let bytes = 0
  const visit = (absolute: string, prefix: string): void => {
    const names = readdirSync(absolute).sort()
    for (const name of names) {
      const relative = prefix === '' ? name : `${prefix}/${name}`
      assertPackagePath(relative)
      const full = join(absolute, name)
      const info = lstatSync(full)
      if (info.isSymbolicLink()) throw new PackageError(`skill packages must not contain symlinks: ${relative}`)
      if (info.isDirectory()) {
        visit(full, relative)
        continue
      }
      if (!info.isFile()) throw new PackageError(`skill packages may contain only regular files: ${relative}`)
      const file = readPackageFile(full)
      bytes += file.bytes.byteLength
      manifest.push({ path: relative, type: 'file', sha256: sha256Of(file.bytes), executable: file.executable })
      files.push({ path: relative, bytes: file.bytes, executable: file.executable })
    }
  }
  visit(dir, '')
  manifest.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return { manifest, files, bytes }
}

/** Read one `SKILL.md` without walking the rest of the package (catalog descriptions). */
export function readSkillFrontmatter(dir: string): SkillFrontmatter & { name: string; description: string } {
  const path = join(dir, 'SKILL.md')
  const { bytes } = readPackageFile(path)
  const parsed = parseSkillMarkdown(bytes.toString('utf8'))
  const name = parsed.attributes.name
  const description = parsed.attributes.description
  if (typeof name !== 'string' || name === '') throw new PackageError('SKILL.md frontmatter needs a name')
  if (typeof description !== 'string' || description.trim() === '') throw new PackageError('SKILL.md frontmatter needs a description')
  return { ...parsed, name, description }
}

/**
 * Validate one skill package and return everything the import path stores.
 *
 * Structural checks come before frontmatter checks because a missing manifest
 * file is a package-shape problem, not a metadata one. The description and body
 * budgets are Unicode code points; the executable bit is the only permission
 * fact the manifest keeps.
 *
 * @param dir - the package directory.
 * @param bounds - optional byte/file ceilings; the install path passes Config.
 */
export function readSkillPackage(dir: string, bounds: { readonly maxBytes?: number; readonly maxFiles?: number } = {}): ParsedSkillPackage {
  const maxBytes = bounds.maxBytes ?? DEFAULT_MAX_PACKAGE_BYTES
  const maxFiles = bounds.maxFiles ?? DEFAULT_MAX_PACKAGE_FILES
  const walked = walkPackage(dir)
  if (walked.files.length > maxFiles) {
    throw new PackageError(`skill package has ${walked.files.length} files; the limit is ${maxFiles}`)
  }
  if (walked.bytes > maxBytes) {
    throw new PackageError(`skill package is ${walked.bytes} bytes; the limit is ${maxBytes}`)
  }
  assertNoHostPaths(walked.files)
  const skill = walked.files.find(file => file.path === 'SKILL.md')
  if (skill === undefined) throw new PackageError('skill package needs a top-level SKILL.md')
  const parsed = parseSkillMarkdown(skill.bytes.toString('utf8'))
  const name = parsed.attributes.name
  const description = parsed.attributes.description
  if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) {
    throw new PackageError(`SKILL.md frontmatter name must be lower-case kebab-case; got ${JSON.stringify(name)}`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new PackageError(`SKILL.md frontmatter description must be a non-empty string; got ${JSON.stringify(description)}`)
  }
  const descriptionCharacters = codePoints(description.trim())
  if (descriptionCharacters > DESCRIPTION_MAX_CHARACTERS) {
    throw new PackageError(`SKILL.md description is ${descriptionCharacters} Unicode characters; the limit is ${DESCRIPTION_MAX_CHARACTERS}`)
  }
  const coreCharacters = codePoints(parsed.body)
  if (coreCharacters > CORE_BODY_MAX_CHARACTERS) {
    throw new PackageError(`SKILL.md core body is ${coreCharacters} Unicode characters; the limit is ${CORE_BODY_MAX_CHARACTERS}; split the workflow into reference files or shorten it`)
  }
  const userInvocable = parsed.attributes['user-invocable']
  if (userInvocable !== undefined && typeof userInvocable !== 'boolean') {
    throw new PackageError(`SKILL.md frontmatter "user-invocable" must be true or false; got ${JSON.stringify(userInvocable)}`)
  }
  const license = parsed.attributes.license
  if (license !== undefined && typeof license !== 'string') {
    throw new PackageError(`SKILL.md frontmatter "license" must be a string; got ${JSON.stringify(license)}`)
  }
  return {
    name,
    description: description.trim(),
    userInvocable: userInvocable !== false,
    license: license === undefined || license === '' ? undefined : license,
    body: parsed.body,
    coreCharacters,
    manifest: walked.manifest,
    manifestHash: manifestHashOf(walked.manifest),
    bytes: walked.bytes,
  }
}

/**
 * Copy a validated package to a destination directory, preserving executable
 * bits and refusing symlinks. The walk is the same one the manifest used, so a
 * file the manifest counted cannot be skipped here.
 */
export function copySkillPackage(sourceDir: string, targetDir: string): void {
  const { files } = walkPackage(sourceDir)
  for (const file of files) {
    const path = join(targetDir, ...file.path.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.bytes, { mode: file.executable ? 0o755 : 0o644 })
  }
}

/** One file the creation path writes into a staged candidate. */
export interface PackageFileInput {
  readonly path: string
  readonly content: string
  readonly executable?: boolean
}

/**
 * Write one package from model-supplied files.
 *
 * This is the only way a draft's bytes enter the tree: every path is checked
 * by {@link assertPackagePath} before anything is written, duplicate paths are
 * refused, and a path that is a prefix of another entry is refused rather than
 * leaving it ambiguous whether the shorter is a file or a directory. The
 * caller validates the written directory with {@link readSkillPackage} before
 * the candidate becomes visible.
 *
 * @param targetDir - an empty directory the caller owns; not walked as a source.
 * @param files - the complete package contents.
 */
export function writeSkillPackage(targetDir: string, files: readonly PackageFileInput[]): void {
  mkdirSync(targetDir, { recursive: true })
  const seen = new Set<string>()
  for (const file of files) {
    assertPackagePath(file.path)
    if (seen.has(file.path)) throw new PackageError(`skill package lists ${file.path} more than once`)
    if (typeof file.content !== 'string') throw new PackageError(`skill package file ${file.path} needs text content`)
    seen.add(file.path)
  }
  // A file cannot also be another entry's directory: `scripts` and
  // `scripts/run.sh` cannot both be files in one package.
  for (const path of seen) {
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index).join('/')
      if (seen.has(prefix)) throw new PackageError(`skill package path ${prefix} is both a file and a directory (${path})`)
    }
  }
  for (const file of files) {
    const full = join(targetDir, ...file.path.split('/'))
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, file.content, { mode: file.executable === true ? 0o755 : 0o644 })
  }
}
