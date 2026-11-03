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
 * The extractor is the security boundary on the bytes: it accepts only regular
 * files and directories, rejects absolute paths, `..`, backslashes, NUL,
 * symlinks, hardlinks and devices, and bounds the compressed download, the
 * inflated bytes and the entry count. Extraction happens under `tmp/` in the
 * skill data root, which is not a native scan root; the package is then
 * validated and staged by the ordinary creation path. This module never
 * executes package code, never registers a plugin and never bypasses review.
 *
 * The fetcher is the security boundary on the network. Every hop (the initial
 * address and each redirect) must be http(s), an https-to-http downgrade is
 * refused, and every resolved host address must be a public unicast address:
 * loopback, RFC 1918, link-local, unique-local, multicast, unspecified and
 * carrier-grade NAT targets are refused. Cloud metadata endpoints stay refused
 * even when the private-network switch is on. The switch exists for tests and
 * for a deployment that deliberately points the install bases at an internal
 * host (`OURFAIRY_SKILL_INSTALL_ALLOW_PRIVATE_NETWORKS=1`); it is off by
 * default.
 *
 * @module @ourfairy/dsh-skill-creator/src/install
 */
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
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

/**
 * The network policy one install fetch applies.
 *
 * `allowPrivateNetworks` is the explicit escape hatch for tests and for a
 * deployment that deliberately installs from an internal registry. It never
 * permits a cloud metadata address.
 */
export interface InstallNetworkPolicy {
  readonly allowPrivateNetworks: boolean
}

/**
 * Read the explicit private-network switch from the environment.
 *
 * The default (unset, `0`, any other value) refuses private targets. This is
 * read once by {@link SkillInstall}, next to the install bases it qualifies.
 */
export function installNetworkPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): InstallNetworkPolicy {
  const value = env.OURFAIRY_SKILL_INSTALL_ALLOW_PRIVATE_NETWORKS
  return { allowPrivateNetworks: value === '1' || value === 'true' }
}

/**
 * Cloud metadata endpoints an install must never reach, even when private
 * networks are allowed: the IPv4 link-local address shared by the large cloud
 * providers, its AWS IPv6 sibling, and the Alibaba Cloud metadata address.
 */
const CLOUD_METADATA_ADDRESSES: ReadonlySet<string> = new Set([
  '169.254.169.254',
  'fd00:ec2::254',
  '100.100.100.200',
])

/** The bare host of one URL: no IPv6 brackets, lower-case. */
function hostOf(url: URL): string {
  const host = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  return host.toLowerCase()
}

/** The four octets of an IPv4 literal, or undefined. */
function ipv4Octets(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined
  return address.split('.').map(Number)
}

/** The eight hextets of an IPv6 literal, or undefined. */
function ipv6Hextets(address: string): number[] | undefined {
  const literal = address.split('%')[0] as string
  if (isIP(literal) !== 6) return undefined
  // A dotted-quad tail (`::ffff:127.0.0.1`) is legal IPv6 text; URL parsing
  // normally normalizes it, but a resolver answer is not guaranteed to.
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(literal)
  let text = literal
  if (dotted !== null) {
    const octets = (dotted[2] as string).split('.').map(Number)
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return undefined
    text = `${dotted[1]}${((octets[0] as number) * 256 + (octets[1] as number)).toString(16)}:${((octets[2] as number) * 256 + (octets[3] as number)).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const parse = (parts: string): number[] | undefined => {
    if (parts === '') return []
    const values: number[] = []
    for (const part of parts.split(':')) {
      if (!/^[0-9a-f]{1,4}$/u.test(part)) return undefined
      values.push(Number.parseInt(part, 16))
    }
    return values
  }
  const head = parse(halves[0] as string)
  const tail = parse(halves.length === 2 ? halves[1] as string : '')
  if (head === undefined || tail === undefined) return undefined
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail]
}

/** The dotted-quad text of an IPv4-mapped IPv6 address, or undefined. */
function mappedIpv4(hextets: readonly number[]): string | undefined {
  if (!hextets.slice(0, 5).every(value => value === 0) || hextets[5] !== 0xffff) return undefined
  const high = hextets[6] as number
  const low = hextets[7] as number
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/** Whether one resolved address is a cloud metadata endpoint. */
function isMetadataAddress(address: string): boolean {
  const literal = address.toLowerCase().split('%')[0] as string
  if (CLOUD_METADATA_ADDRESSES.has(literal)) return true
  const hextets = ipv6Hextets(literal)
  if (hextets === undefined) return false
  const mapped = mappedIpv4(hextets)
  return mapped !== undefined && CLOUD_METADATA_ADDRESSES.has(mapped)
}

/**
 * Whether one resolved address is loopback, private, link-local, unique-local,
 * multicast, unspecified or otherwise reserved. An address this module cannot
 * parse fails closed.
 */
function isForbiddenAddress(address: string): boolean {
  const v4 = ipv4Octets(address)
  if (v4 !== undefined) {
    const [first, second] = v4 as [number, number, number, number]
    return first === 0 // "this network" / unspecified
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127) // carrier-grade NAT
      || (first === 169 && second === 254) // link-local, includes metadata
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || first >= 224 // multicast and reserved
  }
  const v6 = ipv6Hextets(address)
  if (v6 === undefined) return true
  const mapped = mappedIpv4(v6)
  if (mapped !== undefined) return isForbiddenAddress(mapped)
  const first = v6[0] as number
  if (v6.every(value => value === 0)) return true // ::
  if (v6.slice(0, 7).every(value => value === 0) && v6[7] === 1) return true // ::1
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/** The addresses one host resolves to; an IP literal is its own single answer. */
async function resolveTargetAddresses(host: string): Promise<string[]> {
  const literal = host.split('%')[0] as string
  if (isIP(literal) !== 0) return [literal]
  try {
    return (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address)
  } catch {
    throw new SkillError(502, 'skills/install-fetch-failed', `could not resolve install host ${JSON.stringify(host)}`)
  }
}

/**
 * Check one URL before the fetcher opens it.
 *
 * The URL must be http(s), an https-to-http redirect is refused, and every
 * resolved address must be public unicast. The check runs on the initial
 * address and again on every redirect target.
 *
 * @param url - the hop about to be fetched.
 * @param policy - the private-network switch.
 * @param previous - the hop that redirected here, when this is a redirect.
 * @throws {SkillError} `skills/invalid-address` for a non-http(s) hop,
 *   `skills/insecure-redirect` for an https-to-http downgrade and
 *   `skills/install-forbidden-target` for a blocked address.
 */
export async function assertFetchTarget(url: URL, policy: InstallNetworkPolicy, previous?: URL): Promise<void> {
  if (url.username !== '' || url.password !== '') {
    throw new SkillError(400, 'skills/invalid-address', 'install addresses must not carry credentials')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SkillError(400, 'skills/invalid-address', `install target ${url.toString()} must use http or https`)
  }
  if (previous !== undefined && previous.protocol === 'https:' && url.protocol === 'http:') {
    throw new SkillError(403, 'skills/insecure-redirect',
      `refusing the https-to-http redirect from ${previous.host} to ${url.host}`)
  }
  const host = hostOf(url)
  for (const address of await resolveTargetAddresses(host)) {
    if (isMetadataAddress(address)) {
      throw new SkillError(403, 'skills/install-forbidden-target',
        `install target ${host} resolves to a cloud metadata address`)
    }
    if (!policy.allowPrivateNetworks && isForbiddenAddress(address)) {
      throw new SkillError(403, 'skills/install-forbidden-target',
        `install target ${host} resolves to a private, loopback, link-local or reserved address`)
    }
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
 * Every hop is re-checked against the network policy before it is opened, so a
 * redirect cannot move the fetch onto loopback, a private network, a cloud
 * metadata endpoint or a downgraded protocol. The size check happens before
 * and while the body is read, so an oversized response is refused instead of
 * buffered in full first.
 */
async function fetchBytes(url: string, { maxBytes, timeoutMs, accept, allowPrivateNetworks }: {
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly accept: string
  readonly allowPrivateNetworks: boolean
}): Promise<FetchedBytes> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const policy: InstallNetworkPolicy = { allowPrivateNetworks }
    let previous: URL | undefined
    let current: URL
    try {
      current = new URL(url)
    } catch {
      throw new SkillError(400, 'skills/invalid-address', `install address ${url} is not a URL`)
    }
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertFetchTarget(current, policy, previous)
      let response: Response
      try {
        response = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept, 'user-agent': 'ourfairy-skill-install' },
        })
      } catch (error) {
        throw new SkillError(502, 'skills/install-fetch-failed',
          `could not fetch ${current.toString()}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
        if (location === null) {
          throw new SkillError(502, 'skills/install-fetch-failed', `${current.toString()} answered a redirect without a location`)
        }
        if (redirects === MAX_REDIRECTS) {
          throw new SkillError(502, 'skills/install-fetch-failed', `${url} redirected more than ${MAX_REDIRECTS} times`)
        }
        previous = current
        try {
          current = new URL(location, current)
        } catch {
          throw new SkillError(502, 'skills/install-fetch-failed', `${current.toString()} answered a malformed redirect location`)
        }
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new SkillError(502, 'skills/install-fetch-failed', `${current.toString()} answered HTTP ${response.status}`)
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw new SkillError(413, 'skills/install-too-large', `${current.toString()} is ${declared} bytes; the install limit is ${maxBytes}`)
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
            throw new SkillError(413, 'skills/install-too-large', `${current.toString()} exceeds the install limit of ${maxBytes} bytes`)
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
    // A directory entry conventionally ends in "/"; that trailing separator
    // names a directory, not an empty path segment.
    const entryPath = header.type === '5' && header.path.endsWith('/') ? header.path.slice(0, -1) : header.path
    const relative = destinationOf(entryPath, options.githubPath)
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
  readonly #network: InstallNetworkPolicy

  constructor(options: {
    /** The skill data root; staging lives under its `tmp/`. */
    readonly root: string
    readonly maxBytes: number
    readonly timeoutMs?: number
    readonly apiBase?: string
    readonly codeloadBase?: string
    /** Explicitly allow private targets; defaults to the environment switch. */
    readonly allowPrivateNetworks?: boolean
  }) {
    this.#root = options.root
    this.#maxBytes = options.maxBytes
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const bases = installBasesFromEnv()
    this.#apiBase = (options.apiBase ?? bases.apiBase).replace(/\/+$/u, '')
    this.#codeloadBase = (options.codeloadBase ?? bases.codeloadBase).replace(/\/+$/u, '')
    const policy = installNetworkPolicyFromEnv()
    this.#network = { allowPrivateNetworks: options.allowPrivateNetworks ?? policy.allowPrivateNetworks }
  }

  /** Resolve one repository ref to the commit SHA the install records. */
  async #resolveCommit(address: GitHubAddress): Promise<string> {
    const url = `${this.#apiBase}/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.repo)}`
      + `/commits/${encodeURIComponent(address.ref)}`
    const fetched = await fetchBytes(url, {
      maxBytes: MAX_COMMIT_DOCUMENT_BYTES,
      timeoutMs: this.#timeoutMs,
      accept: 'application/vnd.github+json',
      allowPrivateNetworks: this.#network.allowPrivateNetworks,
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
          allowPrivateNetworks: this.#network.allowPrivateNetworks,
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
        allowPrivateNetworks: this.#network.allowPrivateNetworks,
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
