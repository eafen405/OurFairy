#!/usr/bin/env node
/**
 * Regenerate the spec sections of the evidence index.
 *
 * Every spec wave appends a "## …（规格 #N）" section to
 * `work/implementation/evidence/README.md`, so parallel spec branches all edit
 * the same anchor and every merge replays the same conflict. The sections are
 * therefore declared as data — one descriptor per spec under `evidence/index/`
 * — and this script renders them into the index.
 *
 * Two branches that each add a descriptor do not conflict: the descriptors are
 * separate files, and the index itself is regenerated. When the index does
 * conflict during a merge, taking either side and re-running this script yields
 * the same file, because rendering is a pure function of the descriptors.
 *
 * Only sections named by a descriptor are rewritten. Everything else — the
 * preamble, the hand-written tables (基线, 实施票, 最终验收, 架构收敛票,
 * 仓库环境, Triage 修复, 阶段整合与评审, 阅读顺序) — is carried through
 * byte-for-byte, in its current order.
 *
 * Usage:
 *   node scripts/evidence-index.ts [--check]
 *
 * `--check` renders and compares without writing; it exits 1 when the index is
 * stale. That mode exists for a person resolving a merge, and deliberately does
 * not run in CI: the repo does not let a test judge documentation content.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCliEntry } from './cli-guard.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')
export const evidenceDir = join(repoRoot, 'work', 'implementation', 'evidence')
export const descriptorsDir = join(evidenceDir, 'index')
export const indexPath = join(evidenceDir, 'README.md')

/** The table every generated section starts with. */
const TABLE_HEAD = ['| 目录 | 内容 |', '| --- | --- |']

/** One directory the index lists, with the note it carries. */
export type DescriptorEntry = {
  dirs: string | string[]
  note?: string
}

/** One descriptor file, as `evidence/index/` holds it. */
export type Descriptor = {
  title: string
  entries: DescriptorEntry[]
}

/** A section heading in the index. */
const HEADING = /^## /u

/**
 * The descriptor files, in the order their sections appear in the index.
 *
 * The numeric prefix is the order, not the spec number: specs land in waves and
 * the index reads in the order the work happened. A new spec adds one file and
 * gets a section at the end.
 * @param [root] - descriptor directory; defaults to the repository's.
 * @returns
 */
export function readDescriptors(root = descriptorsDir): (Descriptor & { file: string })[] {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      // The descriptor file is the authority for the section it declares.
      const descriptor = JSON.parse(readFileSync(join(root, name), 'utf8')) as Descriptor
      if (typeof descriptor.title !== 'string' || descriptor.title.trim() === '') {
        throw new Error(`${join(root, name)}: a descriptor needs a non-empty "title"`)
      }
      if (!Array.isArray(descriptor.entries) || descriptor.entries.length === 0) {
        throw new Error(`${join(root, name)}: a descriptor needs a non-empty "entries" list`)
      }
      return { file: name, title: descriptor.title.trim(), entries: descriptor.entries }
    })
}

/**
 * The first `#` heading of an evidence README, used when a descriptor entry
 * omits its note.
 * @param dir - directory name under the evidence root.
 * @returns
 */
function headingOf(dir: string): string | undefined {
  const readme = join(evidenceDir, dir, 'README.md')
  if (!existsSync(readme)) return undefined
  const line = readFileSync(readme, 'utf8').split('\n').find(entry => entry.startsWith('# '))
  return line?.slice(2).trim()
}

/**
 * One table row: the directories, then what they hold.
 *
 * Several directories can share a note — a ticket recorded per side shares one
 * summary — so the first column is a ` · ` separated list of links.
 * @param entry
 * @returns
 */
function renderRow(entry: DescriptorEntry): string {
  const dirs: string[] = Array.isArray(entry.dirs) ? entry.dirs : [entry.dirs]
  for (const dir of dirs) {
    if (!existsSync(join(evidenceDir, dir, 'README.md'))) {
      throw new Error(`evidence directory "${dir}" has no README.md; the index may not list a missing directory`)
    }
  }
  const note = entry.note ?? dirs.map(dir => headingOf(dir) ?? dir).join(' · ')
  return `| ${dirs.map(dir => `[${dir}](${dir}/README.md)`).join(' · ')} | ${note} |`
}

/**
 * One whole section, as it should appear in the index.
 * @param section
 * @returns
 */
function renderSection(section: Descriptor): string {
  return [`## ${section.title}`, '', ...TABLE_HEAD, ...section.entries.map(renderRow), ''].join('\n')
}

/**
 * The index split into its preamble and its `##` sections.
 *
 * Splitting on headings is enough here: the index is a list of tables, and no
 * hand-written section embeds a `##` line in a fence.
 * @param text
 * @returns
 */
function splitSections(text: string): { preamble: string[]; sections: { title: string; text: string }[] } {
  const preamble: string[] = []
  const sections: { title: string; lines: string[] }[] = []
  let current: { title: string; lines: string[] } | undefined
  for (const line of text.split('\n')) {
    if (HEADING.test(line)) {
      current = { title: line.slice(3).trim(), lines: [line] }
      sections.push(current)
    } else if (current === undefined) {
      preamble.push(line)
    } else {
      current.lines.push(line)
    }
  }
  return {
    preamble,
    sections: sections.map(section => ({ title: section.title, text: section.lines.join('\n') })),
  }
}

/**
 * Render the index with every descriptor's section replaced or appended.
 *
 * A descriptor whose title is not in the index yet is appended after the last
 * section this run touched, so a new spec lands next to the other spec sections
 * rather than below the hand-written tail.
 * @param text - the current index.
 * @param sections - descriptors, in order.
 * @returns
 */
export function renderIndex(text: string, sections: Descriptor[]): string {
  const { preamble, sections: existing } = splitSections(text)
  const rendered = new Map(sections.map(section => [section.title, renderSection(section)]))
  const known = new Set(existing.map(section => section.title))
  const additions = sections
    .filter(section => !known.has(section.title))
    .map(section => ({ title: section.title, text: rendered.get(section.title)! }))

  const ordered: { title: string; text: string }[] = []
  let lastRendered = -1
  for (const [index, section] of existing.entries()) {
    if (!rendered.has(section.title)) {
      ordered.push(section)
      continue
    }
    ordered.push({ title: section.title, text: rendered.get(section.title)! })
    lastRendered = index
  }
  // A descriptor the index has never listed lands next to the other spec
  // sections, not below the hand-written tail.
  ordered.splice(lastRendered === -1 ? ordered.length : lastRendered + 1, 0, ...additions)

  const preambleText = preamble.join('\n').replace(/\n+$/u, '')
  const parts = [preambleText, ...ordered.map(section => section.text.replace(/\n+$/u, ''))]
    .filter(part => part !== '')
  return `${parts.join('\n\n')}\n`
}

/**
 * Render the index for the repository's current descriptors.
 * @returns
 */
export function buildIndex(): string {
  return renderIndex(readFileSync(indexPath, 'utf8'), readDescriptors())
}

/** Entry point: rewrite the index, or report that it is stale under --check. */
function main(argv: string[]): number {
  const check = argv.includes('--check')
  const next = buildIndex()
  const current = readFileSync(indexPath, 'utf8')
  if (current === next) {
    process.stdout.write(check ? 'evidence index is current\n' : 'evidence index unchanged\n')
    return 0
  }
  if (check) {
    process.stderr.write('evidence index is stale; run `npm run evidence:index`\n')
    return 1
  }
  writeFileSync(indexPath, next)
  process.stdout.write(`evidence index rewritten: ${next.split('\n').length - 1} line(s)\n`)
  return 0
}

if (isCliEntry(import.meta.main)) process.exitCode = main(process.argv.slice(2))
