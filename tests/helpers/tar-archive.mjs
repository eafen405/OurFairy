/**
 * A tiny tar.gz writer for install tests.
 *
 * The install path must reject hostile archives, so the tests have to be able
 * to *make* hostile archives: a `..` path, an absolute name, a symlink, a hard
 * link or a package larger than the configured bound. This writer emits the
 * POSIX ustar subset the product reader accepts (name/prefix, regular files,
 * directories, links) and nothing else. It is a test fixture, not a product
 * implementation.
 *
 * @module tests/helpers/tar-archive
 */
import { gzipSync } from 'node:zlib'

const BLOCK = 512

/** One entry the writer emits; `type` defaults to a regular file. */
export const TAR_TYPE = Object.freeze({
  file: '0',
  hardlink: '1',
  symlink: '2',
  directory: '5',
})

/** Map a friendly type name onto the ustar type flag. */
const TYPE_FLAG = Object.freeze({
  file: TAR_TYPE.file,
  dir: TAR_TYPE.directory,
  directory: TAR_TYPE.directory,
  hardlink: TAR_TYPE.hardlink,
  symlink: TAR_TYPE.symlink,
  [TAR_TYPE.file]: TAR_TYPE.file,
  [TAR_TYPE.hardlink]: TAR_TYPE.hardlink,
  [TAR_TYPE.symlink]: TAR_TYPE.symlink,
  [TAR_TYPE.directory]: TAR_TYPE.directory,
})

/** Write one NUL-padded field. */
function field(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength > length) throw new Error(`tar field at ${offset} is too long: ${value}`)
  bytes.copy(header, offset)
}

/** Write one octal numeric field, with the trailing NUL ustar uses. */
function octal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0')
  field(header, offset, length - 1, text)
  header[offset + length - 1] = 0
}

/** Split a path into the ustar name/prefix fields. */
function nameAndPrefix(path) {
  if (Buffer.byteLength(path, 'utf8') <= 100) return { name: path, prefix: '' }
  for (let index = path.length - 1; index > 0; index -= 1) {
    if (path[index] !== '/') continue
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix }
    }
  }
  throw new Error(`tar path is too long for ustar: ${path}`)
}

/** One entry's header block. */
function headerOf(entry) {
  const header = Buffer.alloc(BLOCK)
  const { name, prefix } = nameAndPrefix(entry.path)
  const content = entry.content === undefined ? Buffer.alloc(0) : Buffer.from(entry.content)
  const type = TYPE_FLAG[entry.type ?? 'file'] ?? TAR_TYPE.file
  const size = type === TAR_TYPE.file ? content.byteLength : 0
  field(header, 0, 100, name)
  octal(header, 100, 8, entry.mode ?? (type === TAR_TYPE.directory ? 0o755 : 0o644))
  octal(header, 108, 8, 0)
  octal(header, 116, 8, 0)
  octal(header, 124, 12, type === TAR_TYPE.file ? content.byteLength : size)
  octal(header, 136, 12, 0)
  field(header, 148, 8, '        ')
  header[156] = Buffer.from(type, 'ascii')[0]
  if (entry.linkname !== undefined) field(header, 157, 100, entry.linkname)
  field(header, 257, 6, 'ustar\0')
  field(header, 263, 2, '00')
  field(header, 265, 32, 'root')
  field(header, 297, 32, 'root')
  field(header, 345, 155, prefix)
  let checksum = 0
  for (const byte of header) checksum += byte
  const text = checksum.toString(8).padStart(6, '0')
  field(header, 148, 6, text)
  header[154] = 0
  header[155] = 0x20
  return { header, content: type === TAR_TYPE.file ? content : Buffer.alloc(0) }
}

/**
 * Build a tar.gz archive.
 * @param {readonly {path: string, content?: string | Buffer, type?: string, linkname?: string, mode?: number}[]} entries
 * @returns {Buffer} the gzipped archive.
 */
export function tarGz(entries) {
  const blocks = []
  for (const entry of entries) {
    const { header, content } = headerOf(entry)
    blocks.push(header)
    if (content.byteLength > 0) {
      blocks.push(content)
      const remainder = content.byteLength % BLOCK
      if (remainder !== 0) blocks.push(Buffer.alloc(BLOCK - remainder))
    }
  }
  blocks.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(blocks))
}

/** One valid skill package's entries under `prefix`. */
export function skillPackageEntries(prefix, { name = 'installed-skill', description = 'Use when testing an installed skill.', body = '# Workflow\n\nDo the installed thing.', extra = {} } = {}) {
  const entries = [
    { path: `${prefix}/SKILL.md`, content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n` },
  ]
  for (const [path, content] of Object.entries(extra)) {
    entries.push({ path: `${prefix}/${path}`, content })
  }
  return entries
}
