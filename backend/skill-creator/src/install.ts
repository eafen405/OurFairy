/**
 * Address install: fetch one skill package from a remote address into the
 * isolated staging area and record what was actually fetched (#298).
 *
 * Three address shapes are supported: a GitHub repository tree/blob path
 * (`https://github.com/<owner>/<repo>/tree/<ref>/<path...>`), the
 * `github:<owner>/<repo>/<path>@<ref>` shorthand, and a direct `.tar.gz` /
 * `.tgz` archive URL. A GitHub branch or tag is resolved to a commit SHA before
 * the tarball is downloaded, and that SHA, the tarball digest and the fetch time
 * are recorded, so a later remote change cannot rewrite the candidate. A `.zip`
 * is refused rather than read by an untested extractor.
 *
 * The extractor is the security boundary: it accepts only regular files and
 * directories, rejects absolute paths, `..`, backslashes, NUL, symlinks,
 * hardlinks and devices, and bounds the compressed download, the inflated bytes
 * and the entry count. Extraction happens under `tmp/` in the skill data root,
 * which is not a native scan root; the package is then validated and staged by
 * the ordinary creation path. This module never executes package code, never
 * registers a plugin and never bypasses review.
 *
 * @module @ourfairy/dsh-skill-creator/src/install
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DEFAULT_MAX_PACKAGE_BYTES, DEFAULT_MAX_PACKAGE_FILES, readSkillFrontmatter } from './package.js'
import { SkillError } from './service.js'

/** The real GitHub endpoints; the environment may point both at a loopback stub. */
export const GITHUB_DEFAULTS = Object.freeze({
  apiBase: 'https://api.github.com',
  codeloadBase: 'https://codeload.github.com',
})

/** The most redirects one fetch follows before refusing. */
const MAX_REDIRECTS = 5

/** The default network timeout for one request. */
const DEFAULT_TIMEOUT_MS = 30_000

/** The largest GitHub commit-document this module accepts. */
const MAX_COMMIT_DOCUMENT_BYTES = 1024 * 1024

/** The largest license text recorded from a `LICENSE*` file. */
const MAX_LICENSE_CHARACTERS = 2_000

/** A GitHub repository reference parsed from an address. */
export interface GitHubAddress {
  readonly kind: 'github'
  readonly address: string
  readonly owner: string
  readonly repo: string
  readonly ref: string
  /** The skill directory inside the repository; empty for the repository root. */
  readonly path: readonly string[]
}

/** A direct archive URL parsed from an address. */
export interface ArchiveAddress {
  readonly kind: 'archive'
  readonly address: string
}

/** One supported install address. */
export type InstallAddress = GitHubAddress | ArchiveAddress

/** The fixed facts one fetched package records on its version. */
export interface InstallSource {
  readonly address: string
  /** The commit SHA for a repository, or the archive digest for a direct archive. */
  readonly resolvedVersion: string
  /** The SHA-256 of the downloaded archive bytes. */
  readonly digest: string
  readonly fetchedAt: number
  readonly etag?: string
  readonly lastModified?: string
}

/** One fetched package in its isolated staging directory. */
export interface FetchedPackage {
  /** The validated package directory under the skill data root's `tmp/`. */
  readonly packageDir: string
  readonly source: InstallSource
  /** The package's `LICENSE*` text or frontmatter license, when it carries one. */
  readonly license?: string
  /** Remove this fetch's staging directory; safe to call more than once. */
  readonly cleanup: () => void
}

/** The install bases, defaulting to the real hosts. */
export function installBasesFromEnv(env: NodeJS.ProcessEnv = process.env): {
  readonly apiBase: string
  readonly codeloadBase: string
} {
  const base = (value: string | undefined, fallback: string): string => {
    const chosen = value === undefined || value.trim() === '' ? fallback : value.trim()
    return chosen.replace(/\/+$/u, '')
  }
  return {
    apiBase: base(env.OURFAIRY_GITHUB_API_BASE, GITHUB_DEFAULTS.apiBase),
    codeloadBase: base(env.OURFAIRY_GITHUB_CODELOAD_BASE, GITHUB_DEFAULTS.codeloadBase),
  }
}

/** Whether one path segment is safe as a repository/path component. */
function safeSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..'
    && !segment.includes('\\') && !segment.includes('\0') && !/[\u0000-\u001f]/u.test(segment)
}

/** Split and validate one repository-relative path. */
function checkedPath(value: string, address: string): string[] {
  const trimmed = value.replace(/^\/+|\/+$/gu, '')
  if (trimmed === '') return []
  const segments = trimmed.split('/')
  for (const segment of segments) {
    if (!safeSegment(segment)) {
      throw new SkillError(400, 'skills/invalid-address', `install address ${address} names an unsafe path component ${JSON.stringify(segment)}`)
    }
  }
  return segments
}

/** Decode one URL path segment, refusing malformed escapes. */
function decodeSegment(segment: string, address: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new SkillError(400, 'skills/invalid-address', `install address ${address} has a malformed escape`)
  }
}

/** Parse a `github:` shorthand. */
function parseShorthand(address: string): GitHubAddress {
  const body = address.slice('github:'.length)
  const at = body.lastIndexOf('@')
  if (at <= 0 || at === body.length - 1) {
    throw new SkillError(400, 'skills/invalid-address', 'the github: shorthand needs <owner>/<repo>/<path>@<ref>')
  }
  const ref = body.slice(at + 1)
  const parts = body.slice(0, at).split('/')
  const [owner, repo, ...rest] = parts
  if (owner === undefined || repo === undefined || parts.length < 2) {
    throw new SkillError(400, 'skills/invalid-address', 'the github: shorthand needs <owner>/<repo>/<path>@<ref>')
  }
  if (!safeSegment(owner) || !safeSegment(repo) || !safeSegment(ref)) {
    throw new SkillError(400, 'skills/invalid-address', `install address ${address} has an unsafe owner, repository or ref`)
  }
  return { kind: 'github', address, owner, repo, ref, path: checkedPath(rest.join('/'), address) }
}

/** Parse one `https://github.com/...` tree or blob URL. */
function parseGitHubUrl(url: URL, address: string): GitHubAddress {
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new SkillError(400, 'skills/invalid-address', `install address ${address} is not a GitHub repository path`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new SkillError(400, 'skills/invalid-address', 'install addresses must not carry credentials')
  }
  const segments = url.pathname.split('/').filter(segment => segment !== '')
  if (segments.length < 4) {
    throw new SkillError(400, 'skills/invalid-address', `install address ${address} needs /<owner>/<repo>/tree/<ref>/<path>`)
  }
  const [owner, repo, mode] = segments
  if (owner === undefined || repo === undefined || mode === undefined
    || !safeSegment(owner) || !safeSegment(repo) || (mode !== 'tree' && mode !== 'blob')) {
    throw new SkillError(400, 'skills/invalid-address', `install address ${address} needs /<owner>/<repo>/tree/<ref>/<path>`)
  }
  const ref = decodeSegment(segments[3] as string, address)
  if (!safeSegment(ref)) {
    throw new SkillError(400, 'skills/invalid-address', `install address ${address} has an unsafe ref`)
  }
  const rest = segments.slice(4).map(segment => decodeSegment(segment, address))
  if (mode === 'blob') {
    const last = rest.at(-1)
    if (last !== 'SKILL.md') {
      throw new SkillError(400, 'skills/invalid-address',
        `a GitHub blob install address must end in SKILL.md; got ${JSON.stringify(last ?? '')}`)
    }
    rest.pop()
  }
  return { kind: 'github', address, owner, repo, ref, path: checkedPath(rest.join('/'), address) }
}

/**
 * Parse one install address into the shape the fetcher needs.
 *
 * @throws {SkillError} `skills/invalid-address` for an unsupported shape,
 *   `skills/unsupported-archive` for a `.zip` or another archive extension.
 */
export function parseInstallAddress(address: string): InstallAddress {
  if (typeof address !== 'string' || address.trim() === '') {
    throw new SkillError(400, 'skills/invalid-address', 'install needs a non-empty address')
  }
  const trimmed = address.trim()
  if (trimmed.startsWith('github:')) return parseShorthand(trimmed)
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new SkillError(400, 'skills/invalid-address', `install address ${trimmed} is not a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SkillError(400, 'skills/invalid-address', 'install addresses must use http or https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SkillError(400, 'skills/invalid-address', 'install addresses must not carry credentials')
  }
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') return parseGitHubUrl(url, trimmed)
  const pathname = url.pathname.toLowerCase()
  if (pathname.endsWith('.tar.gz') || pathname.endsWith('.tgz')) return { kind: 'archive', address: trimmed }
  if (pathname.endsWith('.zip')) {
    throw new SkillError(400, 'skills/unsupported-archive',
      'zip archives are not supported; publish the skill as .tar.gz or .tgz')
  }
  throw new SkillError(400, 'skills/unsupported-archive',
    'unsupported archive format; install accepts a GitHub repository path or a .tar.gz/.tgz archive URL')
}

/** One response's bytes and the headers that identify it. */
interface FetchedBytes {
  readonly bytes: Buffer
  readonly headers: Headers
}

/** Whether one status is a redirect this fetcher follows. */
function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Fetch one URL with a bounded redirect count, timeout and response size.
 *
 * The size check happens before and while the body is read, so an oversized
 * response is refused instead of buffered in full first.
 */
async function fetchBytes(url: string, { maxBytes, timeoutMs, accept }: {
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly accept: string
}): Promise<FetchedBytes> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    let current = url
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      let response: Response
      try {
        response = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept, 'user-agent': 'ourfairy-skill-install' },
        })
      } catch (error) {
        throw new SkillError(502, 'skills/install-fetch-failed',
          `could not fetch ${current}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
        if (location === null) {
          throw new SkillError(502, 'skills/install-fetch-failed', `${current} answered a redirect without a location`)
        }
        if (redirects === MAX_REDIRECTS) {
          throw new SkillError(502, 'skills/install-fetch-failed', `${url} redirected more than ${MAX_REDIRECTS} times`)
        }
        current = new URL(location, current).toString()
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new SkillError(502, 'skills/install-fetch-failed', `${current} answered HTTP ${response.status}`)
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw new SkillError(413, 'skills/install-too-large', `${current} is ${declared} bytes; the install limit is ${maxBytes}`)
      }
      const chunks: Buffer[] = []
      let total = 0
      const reader = response.body?.getReader()
      if (reader !== undefined) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined)
            throw new SkillError(413, 'skills/install-too-large', `${current} exceeds the install limit of ${maxBytes} bytes`)
          }
          chunks.push(Buffer.from(value))
        }
      }
      return { bytes: Buffer.concat(chunks), headers: response.headers }
    }
    throw new SkillError(502, 'skills/install-fetch-failed', `${url} redirected too many times`)
  } finally {
    clearTimeout(timer)
  }
}

/** One tar header's parsed fields. */
interface TarHeader {
  readonly path: string
  readonly type: string
  readonly size: number
  readonly mode: number
}

/** Read one NUL-terminated field from a tar header. */
function textField(block: Buffer, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8')
}

/** Whether a tar name field carries non-NUL bytes after its terminator. */
function fieldHasHiddenBytes(block: Buffer, offset: number, length: number): boolean {
  const field = block.subarray(offset, offset + length)
  const end = field.indexOf(0)
  if (end < 0) return false
  for (const byte of field.subarray(end)) if (byte !== 0) return true
  return false
}

/** Read one octal tar field. */
function octalField(block: Buffer, offset: number, length: number, label: string): number {
  const text = textField(block, offset, length).trim()
  if (text === '') return 0
  if (!/^[0-7]+$/u.test(text)) {
    throw new SkillError(400, 'skills/invalid-archive', `archive header has a non-octal ${label}`)
  }
  return Number.parseInt(text, 8)
}

/** Verify one header's checksum. */
function checksumOf(block: Buffer): number {
  let sum = 0
  for (let index = 0; index < block.byteLength; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (block[index] as number)
  }
  return sum
}

/** Parse and validate one tar header block. */
function parseTarHeader(block: Buffer, archiveOffset: number): TarHeader {
  if (fieldHasHiddenBytes(block, 0, 100) || fieldHasHiddenBytes(block, 345, 155)) {
    throw new SkillError(400, 'skills/invalid-archive', `archive entry at offset ${archiveOffset} has NUL bytes inside its path`)
  }
  const name = textField(block, 0, 100)
  const prefix = textField(block, 345, 155)
  const path = prefix === '' ? name : `${prefix}/${name}`
  const declared = octalField(block, 148, 8, 'checksum')
  if (declared !== checksumOf(block)) {
    throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} has a bad checksum`)
  }
  const type = block[156] === 0 ? '0' : String.fromCharCode(block[156] as number)
  return {
    path,
    type,
    size: octalField(block, 124, 12, 'size'),
    mode: octalField(block, 100, 8, 'mode'),
  }
}

/** Reject one archive path that is not a safe POSIX relative path. */
function assertArchivePath(path: string): string[] {
  if (path === '') throw new SkillError(400, 'skills/invalid-archive', 'archive contains an entry with an empty path')
  if (path.includes('\0')) throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} contains NUL`)
  if (path.includes('\\')) {
    throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} uses a backslash; POSIX "/" is required`)
  }
  if (path.startsWith('/')) {
    throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} is an absolute path`)
  }
  if (/^[A-Za-z]:/u.test(path)) {
    throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} names a drive`)
  }
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} contains an empty, "." or ".." segment`)
    }
    if (/[\u0000-\u001f]/u.test(segment)) {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(path)} contains control characters`)
    }
  }
  return segments
}

/** Whether a path is the target directory or inside it. */
function pathInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Map one archive entry onto its destination relative path. */
function destinationOf(path: string, githubPath: readonly string[] | undefined): string[] | undefined {
  const segments = assertArchivePath(path)
  if (githubPath === undefined) return segments
  // codeload wraps every entry in `<repo>-<sha>/`; strip that one component and
  // keep only the requested skill subtree.
  if (segments.length < 2) return undefined
  const subtree = segments.slice(1)
  if (githubPath.length === 0) return subtree
  if (subtree.length < githubPath.length) return undefined
  for (let index = 0; index < githubPath.length; index += 1) {
    if (subtree[index] !== githubPath[index]) return undefined
  }
  return subtree.slice(githubPath.length)
}

/** The single package root one extracted archive contains. */
function packageRootOf(targetDir: string, fromRepository: boolean): string {
  if (readdirSync(targetDir).includes('SKILL.md')) return targetDir
  if (fromRepository) {
    throw new SkillError(400, 'skills/invalid-archive', 'the repository path does not contain a skill package with a top-level SKILL.md')
  }
  const packages = readdirSync(targetDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(targetDir, entry.name))
    .filter(directory => readdirSync(directory).includes('SKILL.md'))
  if (packages.length !== 1) {
    throw new SkillError(400, 'skills/invalid-archive',
      `the archive must contain exactly one skill package with a top-level SKILL.md; found ${packages.length}`)
  }
  return packages[0] as string
}

/**
 * Extract one `.tar.gz` archive and answer the skill package directory.
 *
 * @param archive - the gzipped tar bytes.
 * @param options - the target directory, an optional GitHub subtree, and the
 *   byte/file bounds. For a repository tarball the first path component (the
 *   codeload `<repo>-<sha>` wrapper) is stripped and only `githubPath` is kept.
 * @throws {SkillError} `skills/invalid-archive` for an unsafe entry/shape and
 *   `skills/install-too-large` for a bounded package.
 */
export function extractSkillArchive(archive: Buffer, options: {
  readonly targetDir: string
  readonly githubPath?: readonly string[]
  readonly maxBytes?: number
  readonly maxFiles?: number
}): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PACKAGE_BYTES
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_PACKAGE_FILES
  let tar: Buffer
  try {
    tar = gunzipSync(archive, { maxOutputLength: maxBytes })
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new SkillError(413, 'skills/install-too-large', `the archive inflates beyond the install limit of ${maxBytes} bytes`)
    }
    throw new SkillError(400, 'skills/invalid-archive', 'the archive is not a valid gzip stream')
  }
  mkdirSync(options.targetDir, { recursive: true })
  const target = resolve(options.targetDir)
  let offset = 0
  let files = 0
  let bytes = 0
  while (offset + 512 <= tar.byteLength) {
    const block = tar.subarray(offset, offset + 512)
    if (block.every(byte => byte === 0)) break
    const header = parseTarHeader(block, offset)
    offset += 512
    const data = tar.subarray(offset, offset + header.size)
    if (data.byteLength !== header.size) {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(header.path)} is truncated`)
    }
    offset += Math.ceil(header.size / 512) * 512
    // Metadata records carry no package content; skipping them cannot widen
    // what this reader writes, because the next header is validated on its own.
    if (header.type === 'x' || header.type === 'g') continue
    if (header.type === '1') {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(header.path)} is a hardlink; only regular files and directories are allowed`)
    }
    if (header.type === '2') {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(header.path)} is a symlink; only regular files and directories are allowed`)
    }
    if (header.type === '3' || header.type === '4' || header.type === '6') {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(header.path)} is a device or FIFO; only regular files and directories are allowed`)
    }
    if (header.type !== '0' && header.type !== '5') {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(header.path)} has unsupported type ${JSON.stringify(header.type)}`)
    }
    const relative = destinationOf(header.path, options.githubPath)
    if (relative === undefined || relative.length === 0) continue
    const destination = resolve(target, ...relative)
    if (!pathInside(target, destination)) {
      throw new SkillError(400, 'skills/invalid-archive', `archive entry ${JSON.stringify(header.path)} escapes the extraction directory`)
    }
    if (header.type === '5') {
      mkdirSync(destination, { recursive: true })
      continue
    }
    files += 1
    bytes += header.size
    if (files > maxFiles) {
      throw new SkillError(413, 'skills/install-too-large', `the archive has more than ${maxFiles} files`)
    }
    if (bytes > maxBytes) {
      throw new SkillError(413, 'skills/install-too-large', `the archive contains more than ${maxBytes} bytes of files`)
    }
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, data, { mode: (header.mode & 0o111) !== 0 ? 0o755 : 0o644 })
  }
  if (files === 0) throw new SkillError(400, 'skills/invalid-archive', 'the archive contains no regular file')
  return packageRootOf(target, options.githubPath !== undefined)
}

/** The license text a package carries: frontmatter first, then a `LICENSE*` file. */
function licenseOf(packageDir: string): string | undefined {
  try {
    const frontmatter = readSkillFrontmatter(packageDir)
    const license = frontmatter.attributes.license
    if (typeof license === 'string' && license.trim() !== '') return license.trim().slice(0, MAX_LICENSE_CHARACTERS)
  } catch {
    // Package validation reports the real frontmatter error; the license scan
    // must not turn a missing file into a second failure.
  }
  let names: string[]
  try {
    names = readdirSync(packageDir).filter(name => /^LICENSE(?:[.-][A-Za-z0-9._-]+)?$/iu.test(name)).sort()
  } catch {
    return undefined
  }
  const name = names[0]
  if (name === undefined) return undefined
  try {
    const text = readFileSync(join(packageDir, name), 'utf8').trim()
    return text === '' ? undefined : text.slice(0, MAX_LICENSE_CHARACTERS)
  } catch {
    return undefined
  }
}

/** The one install fetcher the row owns. */
export class SkillInstall {
  readonly #root: string
  readonly #maxBytes: number
  readonly #timeoutMs: number
  readonly #apiBase: string
  readonly #codeloadBase: string

  constructor(options: {
    /** The skill data root; staging lives under its `tmp/`. */
    readonly root: string
    readonly maxBytes: number
    readonly timeoutMs?: number
    readonly apiBase?: string
    readonly codeloadBase?: string
  }) {
    this.#root = options.root
    this.#maxBytes = options.maxBytes
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const bases = installBasesFromEnv()
    this.#apiBase = (options.apiBase ?? bases.apiBase).replace(/\/+$/u, '')
    this.#codeloadBase = (options.codeloadBase ?? bases.codeloadBase).replace(/\/+$/u, '')
  }

  /** Resolve one repository ref to the commit SHA the install records. */
  async #resolveCommit(address: GitHubAddress): Promise<string> {
    const url = `${this.#apiBase}/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.repo)}`
      + `/commits/${encodeURIComponent(address.ref)}`
    const fetched = await fetchBytes(url, {
      maxBytes: MAX_COMMIT_DOCUMENT_BYTES,
      timeoutMs: this.#timeoutMs,
      accept: 'application/vnd.github+json',
    })
    let parsed: unknown
    try {
      parsed = JSON.parse(fetched.bytes.toString('utf8'))
    } catch {
      throw new SkillError(502, 'skills/install-fetch-failed', `the GitHub commit response for ${address.owner}/${address.repo}@${address.ref} is not JSON`)
    }
    const sha = parsed !== null && typeof parsed === 'object' ? (parsed as { sha?: unknown }).sha : undefined
    if (typeof sha !== 'string' || !/^[0-9a-fA-F]{7,64}$/u.test(sha)) {
      throw new SkillError(502, 'skills/install-fetch-failed', `the GitHub commit response for ${address.owner}/${address.repo}@${address.ref} has no commit SHA`)
    }
    return sha.toLowerCase()
  }

  /**
   * Fetch one address into `tmp/install-<uuid>/`.
   *
   * The caller owns the returned staging directory and must call `cleanup()`
   * after the candidate has been staged; the package directory is only valid
   * until then.
   */
  async fetch(address: string): Promise<FetchedPackage> {
    const parsed = parseInstallAddress(address)
    const staging = join(this.#root, 'tmp', `install-${randomUUID()}`)
    mkdirSync(staging, { recursive: true })
    const cleanup = () => rmSync(staging, { recursive: true, force: true })
    try {
      if (parsed.kind === 'github') {
        const commit = await this.#resolveCommit(parsed)
        const url = `${this.#codeloadBase}/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
          + `/tar.gz/${commit}`
        const downloaded = await fetchBytes(url, {
          maxBytes: this.#maxBytes,
          timeoutMs: this.#timeoutMs,
          accept: 'application/gzip, application/octet-stream, */*',
        })
        const packageDir = extractSkillArchive(downloaded.bytes, {
          targetDir: join(staging, 'package'),
          githubPath: parsed.path,
          maxBytes: this.#maxBytes,
        })
        const license = licenseOf(packageDir)
        return {
          packageDir,
          source: {
            address: parsed.address,
            resolvedVersion: commit,
            digest: createHash('sha256').update(downloaded.bytes).digest('hex'),
            fetchedAt: Date.now(),
          },
          ...(license === undefined ? {} : { license }),
          cleanup,
        }
      }
      const downloaded = await fetchBytes(parsed.address, {
        maxBytes: this.#maxBytes,
        timeoutMs: this.#timeoutMs,
        accept: 'application/gzip, application/octet-stream, */*',
      })
      const digest = createHash('sha256').update(downloaded.bytes).digest('hex')
      const packageDir = extractSkillArchive(downloaded.bytes, {
        targetDir: join(staging, 'package'),
        maxBytes: this.#maxBytes,
      })
      const etag = downloaded.headers.get('etag')
      const lastModified = downloaded.headers.get('last-modified')
      const license = licenseOf(packageDir)
      return {
        packageDir,
        source: {
          address: parsed.address,
          resolvedVersion: digest,
          digest,
          fetchedAt: Date.now(),
          ...(etag === null ? {} : { etag }),
          ...(lastModified === null ? {} : { lastModified }),
        },
        ...(license === undefined ? {} : { license }),
        cleanup,
      }
    } catch (error) {
      cleanup()
      throw error
    }
  }
}
