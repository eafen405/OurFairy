#!/usr/bin/env node
/**
 * Operator and literal parity between the pre-migration chat sources and the
 * migrated ones.
 *
 * The migration must not change behaviour, so the code that runs has to keep
 * the same operators and the same literals. This script proves that mechanically
 * instead of by assertion:
 *
 * - `source` compares the pre-migration `.mjs` with the migrated `.ts`, both
 *   transpiled with the pinned TypeScript so type annotations cannot add
 *   operators or literals.
 * - `runtime` compares the pre-migration `.mjs` with the emitted `dist/*.js`,
 *   the artefact Node actually loads.
 *
 * Comments are stripped before counting, string contents are masked so an
 * operator inside a literal never counts, and literals are read from the
 * TypeScript AST so a literal inside a longer string is not counted twice.
 *
 * Usage:
 *   node work/implementation/evidence/209-ts-chat/parity-scan.mjs [base-ref]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(repoRoot, 'package.json'))
const ts = require('typescript')

/** The commit the migration branched from. */
const base = process.argv[2] ?? 'fc782e5104'

/** The migrated file, its pre-migration twin, and the emitted artefact. */
const files = [
  ['backend/chat/src/index.mjs', 'backend/chat/src/index.ts', 'backend/chat/dist/index.js'],
  ['backend/chat/src/jobs.mjs', 'backend/chat/src/jobs.ts', 'backend/chat/dist/jobs.js'],
  ['backend/chat/src/persona.mjs', 'backend/chat/src/persona.ts', 'backend/chat/dist/persona.js'],
  ['backend/chat/src/queues.mjs', 'backend/chat/src/queues.ts', 'backend/chat/dist/queues.js'],
  ['backend/chat/src/runtime-facade.mjs', 'backend/chat/src/runtime-facade.ts', 'backend/chat/dist/runtime-facade.js'],
  ['backend/chat/src/runtime.mjs', 'backend/chat/src/runtime.ts', 'backend/chat/dist/runtime.js'],
  ['backend/chat/src/service.mjs', 'backend/chat/src/service.ts', 'backend/chat/dist/service.js'],
  ['backend/chat/src/spill-read.mjs', 'backend/chat/src/spill-read.ts', 'backend/chat/dist/spill-read.js'],
  ['backend/chat/src/units.mjs', 'backend/chat/src/units.ts', 'backend/chat/dist/units.js'],
  ['backend/chat/test-support/fail-outlets.mjs', 'backend/chat/test-support/fail-outlets.ts', null],
  ['backend/chat/test-support/frame-gap.mjs', 'backend/chat/test-support/frame-gap.ts', null],
  ['backend/chat/test-support/lost-event.mjs', 'backend/chat/test-support/lost-event.ts', null],
]

/** The operators the scan counts; longest first, so `??=` never counts as `??`. */
const operators = [
  '??=', '===', '!==', '?.', '??', '||', '&&', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '=>',
  '++', '--', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '=', '~', '&', '|', '^',
]

/**
 * One source, transpiled with the pinned compiler so comments and type
 * annotations are gone and only executable code is counted.
 * @param {string} source - the file's text.
 * @param {string} fileName - the file's name, for diagnostics.
 * @returns {string} the executable text.
 */
function executable(source, fileName) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      verbatimModuleSyntax: false,
    },
  }).outputText
}

/**
 * The text with every string and template literal's contents blanked, so an
 * operator that only appears inside a literal never counts.
 * @param {string} text - the executable text.
 * @returns {string} the masked text.
 */
function maskLiterals(text) {
  const source = ts.createSourceFile('scan.js', text, ts.ScriptTarget.ES2024, true)
  const masked = [...text]
  const blank = (from, to) => { for (let index = from; index < to; index++) masked[index] = ' ' }
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      blank(node.getStart(source), node.getEnd())
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return masked.join('')
}

/**
 * Every operator in the text, counted.
 * @param {string} text - the executable text.
 * @returns {Record<string, number>} the counts.
 */
function operatorCounts(text) {
  const counts = {}
  let rest = maskLiterals(text)
  for (const operator of operators) {
    const parts = rest.split(operator)
    counts[operator] = parts.length - 1
    rest = parts.join(' ')
  }
  return counts
}

/**
 * Every string and numeric literal in the text, read from the AST so a
 * literal inside a longer string is not counted twice.
 * @param {string} text - the executable text.
 * @returns {string[]} the literal texts, sorted.
 */
function literalCounts(text) {
  const source = ts.createSourceFile('scan.js', text, ts.ScriptTarget.ES2024, true)
  const literals = []
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(`s:${node.text}`)
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literals.push(`t:${node.text}`)
    else if (ts.isNumericLiteral(node)) literals.push(`n:${node.text}`)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return literals.sort()
}

/**
 * The difference between two count maps, keeping only the entries that differ.
 * @param {Record<string, number>} before - the pre-migration counts.
 * @param {Record<string, number>} after - the migrated counts.
 * @returns {string[]} the differing entries, as `operator before -> after`.
 */
function operatorDelta(before, after) {
  const delta = []
  for (const operator of operators) {
    if (before[operator] !== after[operator]) delta.push(`${operator} ${before[operator]} -> ${after[operator]}`)
  }
  return delta
}

/**
 * The literals that only one side has, as a multiset difference.
 * @param {string[]} before - the pre-migration literals.
 * @param {string[]} after - the migrated literals.
 * @returns {string[]} the difference.
 */
function literalDelta(before, after) {
  const counts = new Map()
  for (const literal of before) counts.set(literal, (counts.get(literal) ?? 0) + 1)
  for (const literal of after) counts.set(literal, (counts.get(literal) ?? 0) - 1)
  return [...counts.entries()].filter(([, count]) => count !== 0).map(([literal, count]) => `${literal} ${count > 0 ? '+' : ''}${count}`)
}

/**
 * The lines that only one side has, after whitespace normalisation. Both sides
 * went through the same printer, so the difference is the migration's own.
 * @param {string} before - the pre-migration text.
 * @param {string} after - the migrated text.
 * @returns {string[]} the differing lines, as `- old` and `+ new`.
 */
function lineDelta(before, after) {
  const normalise = text => text.split('\n').map(line => line.trim().replace(/\s+/gu, ' ')).filter(line => line !== '')
  const oldLines = normalise(before)
  const newLines = normalise(after)
  const difference = []
  const remaining = [...newLines]
  for (const line of oldLines) {
    const index = remaining.indexOf(line)
    if (index === -1) difference.push(`- ${line}`)
    else remaining.splice(index, 1)
  }
  for (const line of remaining) difference.push(`+ ${line}`)
  return difference
}

const before = path => execFileSync('git', ['show', `${base}:${path}`], { cwd: repoRoot, encoding: 'utf8' })

let operatorDeltas = 0
let literalDeltas = 0
for (const [oldPath, newPath, distPath] of files) {
  const oldText = executable(before(oldPath), oldPath)
  const newText = executable(readFileSync(join(repoRoot, newPath), 'utf8'), newPath)
  const sourceOperators = operatorDelta(operatorCounts(oldText), operatorCounts(newText))
  const sourceLiterals = literalDelta(literalCounts(oldText), literalCounts(newText))
  console.log(`# ${newPath}`)
  console.log(`source operators: ${sourceOperators.length === 0 ? 'identical' : sourceOperators.join(', ')}`)
  console.log(`source literals: ${sourceLiterals.length === 0 ? 'identical' : sourceLiterals.join(', ')}`)
  if (sourceOperators.length > 0) operatorDeltas += 1
  if (sourceLiterals.length > 0) literalDeltas += 1
  if (distPath !== null) {
    const runtimeText = executable(readFileSync(join(repoRoot, distPath), 'utf8'), distPath)
    const runtimeOperators = operatorDelta(operatorCounts(oldText), operatorCounts(runtimeText))
    const runtimeLiterals = literalDelta(literalCounts(oldText), literalCounts(runtimeText))
    console.log(`runtime operators: ${runtimeOperators.length === 0 ? 'identical' : runtimeOperators.join(', ')}`)
    console.log(`runtime literals: ${runtimeLiterals.length === 0 ? 'identical' : runtimeLiterals.join(', ')}`)
    if (runtimeOperators.length > 0) operatorDeltas += 1
    if (runtimeLiterals.length > 0) literalDeltas += 1
  }
  if (sourceOperators.length > 0 || sourceLiterals.length > 0) {
    console.log('lines:')
    for (const line of lineDelta(oldText, newText)) console.log(`  ${line}`)
  }
  if (distPath !== null) {
    const runtimeText = executable(readFileSync(join(repoRoot, distPath), 'utf8'), distPath)
    const runtimeLines = lineDelta(oldText, runtimeText)
    if (runtimeLines.length > 0) {
      console.log('runtime lines:')
      for (const line of runtimeLines) console.log(`  ${line}`)
    }
  }
  console.log('')
}
console.log(`${operatorDeltas} operator delta(s), ${literalDeltas} literal delta(s) across ${files.length} files`)
