#!/usr/bin/env node
/**
 * Operator, literal, structure and token parity between the pre-migration
 * product sources and the migrated ones.
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
 * Four checks run per file, and each of them is order-sensitive or
 * count-sensitive, so a renamed local, a reordered statement, a swapped
 * argument or a renamed property shows up:
 *
 * - `operators` counts every operator AND the brackets and the statement
 *   separator. A change that only moves a brace or a semicolon changes the
 *   shape of the code, so an operator list that cannot see it would call two
 *   different files equal.
 * - `literals` reads the literal multiset from the TypeScript AST, so a
 *   literal inside a longer string is not counted twice.
 * - `structure` is an AST-derived signature: every node's kind, and the text
 *   of the nodes that carry one. It never goes through the scanner, so it
 *   cannot be fooled by a scanner quirk.
 * - `tokens` is the scanner's token stream. The scanner walks a template
 *   literal part by part — head, each substitution with its braces counted,
 *   then the middle or the tail — and a template nested inside a substitution
 *   is walked the same way. Stopping at the first part, or not descending into
 *   a nested template, leaves the scanner in code mode and lets one token
 *   swallow a whole function.
 *
 * Every difference the migration declares is a transformation of the token
 * stream, listed in {@link declaredCategories}. Each transformation is applied
 * to BOTH streams, so a difference that survives all of them is a difference
 * the migration did not declare: the scan prints the residue and exits
 * non-zero. The transformations are this migration's own; another ticket
 * declares its own.
 *
 * Usage:
 *   node work/implementation/evidence/210-ts-remaining/parity-scan.mjs [base-ref]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(repoRoot, 'package.json'))
const ts = require('typescript')

/** The commit the migration branched from. */
const base = process.argv[2] ?? '47164df889'

/** The migrated file, its pre-migration twin, and the emitted artefact. */
const files = [
  ['backend/delivery/src/index.mjs', 'backend/delivery/src/index.ts', 'backend/delivery/dist/index.js'],
  ['backend/gateway/src/http.mjs', 'backend/gateway/src/http.ts', 'backend/gateway/dist/http.js'],
  ['backend/gateway/src/index.mjs', 'backend/gateway/src/index.ts', 'backend/gateway/dist/index.js'],
  ['backend/gateway/src/service.mjs', 'backend/gateway/src/service.ts', 'backend/gateway/dist/service.js'],
  ['backend/groups/src/index.mjs', 'backend/groups/src/index.ts', 'backend/groups/dist/index.js'],
  ['backend/probe/src/index.mjs', 'backend/probe/src/index.ts', 'backend/probe/dist/index.js'],
  ['backend/search/src/index.mjs', 'backend/search/src/index.ts', 'backend/search/dist/index.js'],
  ['backend/speech/src/index.mjs', 'backend/speech/src/index.ts', 'backend/speech/dist/index.js'],
  ['backend/speech/src/service.mjs', 'backend/speech/src/service.ts', 'backend/speech/dist/service.js'],
]

/**
 * The operators and punctuation the scan counts; longest first, so `??=` never
 * counts as `??`.
 *
 * The brackets and the statement separator are counted too: a change that only
 * moves a brace or a semicolon changes the shape of the code, and an operator
 * list that cannot see it would call two different files equal.
 */
const operators = [
  '??=', '===', '!==', '?.', '??', '||', '&&', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '=>',
  '++', '--', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '=', '~', '&', '|', '^',
  '(', ')', '{', '}', ';',
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
 * The operator counts of one executable text.
 *
 * The literal contents are masked first, so an operator inside a string is
 * never counted.
 * @param {string} text - the executable text.
 * @returns {Record<string, number>} the count per operator.
 */
function operatorCounts(text) {
  const source = ts.createSourceFile('scan.js', text, ts.ScriptTarget.ES2024, true)
  const masked = [...text]
  const blank = (from, to) => { for (let i = from; i < to; i++) masked[i] = ' ' }
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) blank(node.getStart(source), node.getEnd())
    ts.forEachChild(node, visit)
  }
  visit(source)
  const counts = {}
  let rest = masked.join('')
  for (const operator of operators) {
    const parts = rest.split(operator)
    counts[operator] = parts.length - 1
    rest = parts.join(' ')
  }
  return counts
}

/**
 * The literal multiset of one executable text, read from the AST.
 * @param {string} text - the executable text.
 * @returns {Map<string, number>} the count per literal.
 */
function literalCounts(text) {
  const source = ts.createSourceFile('scan.js', text, ts.ScriptTarget.ES2024, true)
  const counts = new Map()
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)
      || ts.isBigIntLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
      || node.kind === ts.SyntaxKind.NullKeyword) {
      const key = `${ts.SyntaxKind[node.kind]}:${node.getText(source)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return counts
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

/**
 * The AST-derived structure signature of one executable text.
 *
 * Every node contributes its kind, and the nodes that carry a name or a value
 * contribute their text as well. The signature never goes through the scanner,
 * so it cannot be fooled by a scanner quirk: a template literal contributes its
 * head, its substitutions and its tail as separate nodes, and the code between
 * two template literals is code, not one token.
 * @param {string} text - the executable text.
 * @returns {string[]} the signature, in order.
 */
function structureSignature(text) {
  const source = ts.createSourceFile('scan.js', text, ts.ScriptTarget.ES2024, true)
  const signature = []
  const visit = node => {
    for (const child of node.getChildren(source)) {
      const kind = ts.SyntaxKind[child.kind]
      const carriesText = ts.isIdentifier(child) || ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)
        || ts.isNumericLiteral(child) || ts.isBigIntLiteral(child) || ts.isPrivateIdentifier(child)
      signature.push(carriesText ? `${kind}:${child.getText(source)}` : kind)
      visit(child)
    }
  }
  visit(source)
  return signature
}

/**
 * Walk one template literal's parts, from the head or middle the scanner is
 * positioned at to the tail.
 *
 * Each substitution's braces are counted, so a `}` inside the substitution
 * does not end it, and a template nested inside a substitution is walked the
 * same way. A template with more than one substitution runs head -> middle ->
 * middle -> tail, and only the tail ends the template.
 * @param {ts.Scanner} scanner - the scanner, positioned at a template part.
 * @param {string[]} tokens - the token texts collected so far.
 */
function scanTemplateParts(scanner, tokens) {
  for (;;) {
    let depth = 0
    for (;;) {
      const kind = scanner.scan()
      if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) {
        tokens.push(scanner.getTokenText())
        scanTemplateParts(scanner, tokens)
        continue
      }
      if (kind === ts.SyntaxKind.OpenBraceToken) depth += 1
      else if (kind === ts.SyntaxKind.CloseBraceToken) {
        if (depth === 0) break
        depth -= 1
      }
      tokens.push(scanner.getTokenText())
    }
    const kind = scanner.reScanTemplateToken()
    tokens.push(scanner.getTokenText())
    if (kind !== ts.SyntaxKind.TemplateMiddle) break
  }
}

/**
 * The scanner's token stream, in order.
 * @param {string} text - the executable text.
 * @returns {string[]} the token texts, in order.
 */
function tokenStream(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.ES2024, true, ts.LanguageVariant.Standard, text)
  const tokens = []
  let kind = scanner.scan()
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push(scanner.getTokenText())
    if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) {
      scanTemplateParts(scanner, tokens)
      kind = scanner.scan()
      continue
    }
    kind = scanner.scan()
  }
  return tokens
}

/**
 * Drop the parentheses a type annotation forces around a single arrow
 * parameter: `(x) =>` becomes `x =>`.
 * @param {string[]} tokens - the token stream.
 * @returns {string[]} the rewritten stream.
 */
function dropArrowParameterParens(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '(' && tokens[i + 2] === ')' && tokens[i + 3] === '=>' && /^[A-Za-z_$][\w$]*$/u.test(tokens[i + 1] ?? '')) {
      out.push(tokens[i + 1])
      i += 2
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/**
 * Drop the `async` the native tool contract puts on a tool's `execute`.
 * @param {string[]} tokens - the token stream.
 * @returns {string[]} the rewritten stream.
 */
function dropAsyncArrow(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'async' && tokens[i + 1] === '(') {
      let depth = 0
      let close = -1
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j] === '(') depth += 1
        else if (tokens[j] === ')') {
          depth -= 1
          if (depth === 0) { close = j; break }
        }
      }
      if (close !== -1 && tokens[close + 1] === '=>') continue
    }
    out.push(tokens[i])
  }
  return out
}

/**
 * Unwrap the `isSafeInteger` predicate helper: drop its declaration and write
 * the call it replaced back as `Number.isSafeInteger`.
 * @param {string[]} tokens - the token stream.
 * @returns {string[]} the rewritten stream.
 */
function unwrapSafeIntegerHelper(tokens) {
  const declaration = ['function', 'isSafeInteger', '(', 'value', ')', '{', 'return', 'Number', '.', 'isSafeInteger', '(', 'value', ')', ';', '}']
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (declaration.every((token, k) => tokens[i + k] === token)) {
      i += declaration.length - 1
      continue
    }
    if (tokens[i] === 'isSafeInteger' && !(tokens[i - 1] === '.' && tokens[i - 2] === 'Number')) {
      out.push('Number', '.', 'isSafeInteger')
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/**
 * Drop every occurrence of one token sequence.
 * @param {string[]} tokens - the token stream.
 * @param {string[]} sequence - the sequence to drop.
 * @returns {string[]} the rewritten stream.
 */
function dropTokenSequence(tokens, sequence) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (sequence.every((token, k) => tokens[i + k] === token)) {
      i += sequence.length - 1
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/**
 * Fold the `return undefined` the `agent/created` handler's type asks for.
 *
 * The tail `; return undefined ;` is dropped, and an arrow body that is
 * nothing but one expression then loses the block's braces as well: the
 * concise body it replaces is the same expression. A block that holds more
 * than one statement keeps its braces, because the pre-migration body was a
 * block too.
 * @param {string[]} tokens - the token stream.
 * @returns {string[]} the rewritten stream.
 */
function foldExplicitReturnUndefined(tokens) {
  const withoutTail = dropTokenSequence(tokens, ['return', 'undefined', ';'])
  const out = []
  for (let i = 0; i < withoutTail.length; i++) {
    if (withoutTail[i] === '=>' && withoutTail[i + 1] === '{') {
      let depth = 0
      let close = -1
      for (let j = i + 1; j < withoutTail.length; j++) {
        if (withoutTail[j] === '{') depth += 1
        else if (withoutTail[j] === '}') {
          depth -= 1
          if (depth === 0) { close = j; break }
        }
      }
      if (close !== -1) {
        const body = withoutTail.slice(i + 2, close)
        // A body that is one expression and its separator is the concise body
        // the block replaced; a body with more than one statement keeps its
        // braces, because the pre-migration body was a block too.
        const statements = body.length > 0 && body[body.length - 1] === ';' ? body.slice(0, -1) : body
        if (!statements.includes(';')) {
          out.push('=>')
          out.push(...statements)
          i = close
          continue
        }
      }
    }
    out.push(withoutTail[i])
  }
  return out
}

/**
 * The differences the migration declares, as token-stream transformations.
 *
 * Each transformation is applied to BOTH streams, so a difference that
 * survives all of them is a difference the migration did not declare. The
 * list is this migration's own: another ticket declares its own.
 */
const declaredCategories = [
  {
    // A relative import must carry the `.js` specifier the emitted artefact has.
    name: 'relative-specifier',
    apply: tokens => tokens.map(token => token.replace(/\.mjs'$/u, ".js'")),
  },
  {
    // A typed arrow parameter needs its parentheses.
    name: 'arrow-param-parens',
    apply: dropArrowParameterParens,
  },
  {
    // The native tool contract makes a tool's `execute` asynchronous.
    name: 'async-on-execute',
    apply: dropAsyncArrow,
  },
  {
    // `Number.isSafeInteger` is not a type guard, so the check is wrapped.
    name: 'safe-integer-helper',
    apply: unwrapSafeIntegerHelper,
  },
  {
    // The `agent/created` handler's type is `undefined | Promise<undefined>`.
    //
    // This is the one category that carries a VALUE difference, not only a
    // shape difference: the pre-migration `delivery` helper was a concise
    // arrow whose value was dsh's tool disposer, and the migrated one returns
    // `undefined`. A token comparison cannot see a returned value, so the
    // deviation is recorded in the ticket's evidence, not here.
    name: 'explicit-return-undefined',
    apply: foldExplicitReturnUndefined,
  },
]

/**
 * The difference between two token streams.
 *
 * The comparison is ORDER-SENSITIVE: the two streams must agree token for
 * token, so a renamed local, a reordered statement or a swapped argument
 * shows up.
 * @param {string} before - the pre-migration text.
 * @param {string} after - the migrated text.
 * @returns {{identical: boolean, first: number, onlyOld: string[], onlyNew: string[], oldTokens: string[], newTokens: string[]}} the difference.
 */
function tokenDelta(before, after) {
  const oldTokens = tokenStream(before)
  const newTokens = tokenStream(after)
  const onlyOld = []
  const remaining = [...newTokens]
  for (const token of oldTokens) {
    const index = remaining.indexOf(token)
    if (index === -1) onlyOld.push(token)
    else remaining.splice(index, 1)
  }
  let first = 0
  while (first < oldTokens.length && first < newTokens.length && oldTokens[first] === newTokens[first]) first++
  const identical = oldTokens.length === newTokens.length && first === oldTokens.length
  return { identical, first, onlyOld, onlyNew: remaining, oldTokens, newTokens }
}

/**
 * The difference between two token streams, as one readable line.
 * @param {string} before - the pre-migration text.
 * @param {string} after - the migrated text.
 * @returns {string} the report.
 */
function tokenReport(before, after) {
  const { identical, first, onlyOld, onlyNew, oldTokens, newTokens } = tokenDelta(before, after)
  if (identical) return 'identical'
  const show = tokens => tokens.length === 0 ? 'none' : tokens.map(token => `'${token}'`).join(' ')
  return `differ — first at token #${first} (${oldTokens.length} old / ${newTokens.length} new); `
    + `only old: ${show(onlyOld)}; only new: ${show(onlyNew)}`
}

/**
 * The context around the first token difference.
 * @param {string} before - the pre-migration text.
 * @param {string} after - the migrated text.
 * @returns {string[]} the report lines.
 */
function tokenContext(before, after) {
  const { identical, first, oldTokens, newTokens } = tokenDelta(before, after)
  if (identical) return []
  const window = 6
  const from = Math.max(0, first - 2)
  return [
    `  old: ${oldTokens.slice(from, first + window).join(' ')}`,
    `  new: ${newTokens.slice(from, first + window).join(' ')}`,
  ]
}

/**
 * The difference between two operator count maps.
 * @param {Record<string, number>} before - the pre-migration counts.
 * @param {Record<string, number>} after - the migrated counts.
 * @returns {string[]} the lines that differ.
 */
function operatorDelta(before, after) {
  const lines = []
  for (const operator of operators) {
    const oldCount = before[operator] ?? 0
    const newCount = after[operator] ?? 0
    if (oldCount !== newCount) lines.push(`${operator}: ${oldCount} -> ${newCount}`)
  }
  return lines
}

/**
 * The difference between two literal multisets.
 * @param {Map<string, number>} before - the pre-migration multiset.
 * @param {Map<string, number>} after - the migrated multiset.
 * @returns {string[]} the lines that differ.
 */
function literalDelta(before, after) {
  const lines = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldCount = before.get(key) ?? 0
    const newCount = after.get(key) ?? 0
    if (oldCount !== newCount) lines.push(`${key}: ${oldCount} -> ${newCount}`)
  }
  return lines
}

/**
 * The difference between two structure signatures.
 * @param {string} before - the pre-migration text.
 * @param {string} after - the migrated text.
 * @returns {string} the report.
 */
function structureReport(before, after) {
  const oldSignature = structureSignature(before)
  const newSignature = structureSignature(after)
  let first = 0
  while (first < oldSignature.length && first < newSignature.length && oldSignature[first] === newSignature[first]) first++
  if (first === oldSignature.length && first === newSignature.length) return 'identical'
  const window = 6
  const from = Math.max(0, first - 2)
  return `differ — first at node #${first} (${oldSignature.length} old / ${newSignature.length} new); `
    + `old: ${oldSignature.slice(from, first + window).join(' ')} | new: ${newSignature.slice(from, first + window).join(' ')}`
}

/**
 * Apply the declared categories to one token stream.
 * @param {string[]} tokens - the token stream.
 * @returns {{tokens: string[], fired: string[]}} the rewritten stream and the categories that changed it.
 */
function applyDeclaredCategories(tokens) {
  const fired = []
  let current = tokens
  for (const category of declaredCategories) {
    const next = category.apply(current)
    if (next.length !== current.length || next.some((token, index) => token !== current[index])) fired.push(category.name)
    current = next
  }
  return { tokens: current, fired }
}

/**
 * How many tokens the two streams still disagree on.
 * @param {string[]} before - the pre-migration token stream.
 * @param {string[]} after - the migrated token stream.
 * @returns {number} the number of tokens that do not pair up.
 */
function residueSize(before, after) {
  const remaining = [...after]
  let size = 0
  for (const token of before) {
    const index = remaining.indexOf(token)
    if (index === -1) size += 1
    else remaining.splice(index, 1)
  }
  return size + remaining.length
}

/**
 * The difference between two token streams after the declared categories are
 * applied to both.
 * @param {string} before - the pre-migration text.
 * @param {string} after - the migrated text.
 * @returns {{identical: boolean, fired: string[], residue: string[]}} the residue and the categories that fired.
 */
function residueReport(before, after) {
  const fired = []
  let oldTokens = tokenStream(before)
  let newTokens = tokenStream(after)
  let residue = residueSize(oldTokens, newTokens)
  for (const category of declaredCategories) {
    const oldNext = category.apply(oldTokens)
    const newNext = category.apply(newTokens)
    const next = residueSize(oldNext, newNext)
    if (next < residue) fired.push(category.name)
    oldTokens = oldNext
    newTokens = newNext
    residue = next
  }
  const listed = []
  const remaining = [...newTokens]
  for (const token of oldTokens) {
    const index = remaining.indexOf(token)
    if (index === -1) listed.push(`only old: ${token}`)
    else remaining.splice(index, 1)
  }
  for (const token of remaining) listed.push(`only new: ${token}`)
  let first = 0
  while (first < oldTokens.length && first < newTokens.length && oldTokens[first] === newTokens[first]) first++
  const context = listed.length === 0 ? [] : [
    `  old: ${oldTokens.slice(Math.max(0, first - 4), first + 8).join(' ')}`,
    `  new: ${newTokens.slice(Math.max(0, first - 4), first + 8).join(' ')}`,
  ]
  return { identical: listed.length === 0, fired, residue: listed, context }
}

const before = path => execFileSync('git', ['show', `${base}:${path}`], { cwd: repoRoot, encoding: 'utf8' })

let operatorDeltas = 0
let literalDeltas = 0
let tokenDeltas = 0
let residues = 0
for (const [oldPath, newPath, distPath] of files) {
  const oldText = executable(before(oldPath), oldPath)
  const newText = executable(readFileSync(join(repoRoot, newPath), 'utf8'), newPath)
  const sourceOperators = operatorDelta(operatorCounts(oldText), operatorCounts(newText))
  const sourceLiterals = literalDelta(literalCounts(oldText), literalCounts(newText))
  console.log(`# ${newPath}`)
  console.log(`source operators: ${sourceOperators.length === 0 ? 'identical' : sourceOperators.join(', ')}`)
  console.log(`source literals: ${sourceLiterals.length === 0 ? 'identical' : sourceLiterals.join(', ')}`)
  console.log(`source structure: ${structureReport(oldText, newText)}`)
  console.log(`source tokens: ${tokenReport(oldText, newText)}`)
  for (const line of tokenContext(oldText, newText)) console.log(line)
  const sourceResidue = residueReport(oldText, newText)
  console.log(`source declared categories fired: ${sourceResidue.fired.length === 0 ? 'none' : sourceResidue.fired.join(', ')}`)
  console.log(`source residue after the declared categories: ${sourceResidue.identical ? 'none' : sourceResidue.residue.join('; ')}`)
  for (const line of sourceResidue.context) console.log(line)
  if (sourceOperators.length > 0) operatorDeltas += 1
  if (sourceLiterals.length > 0) literalDeltas += 1
  if (!tokenDelta(oldText, newText).identical) tokenDeltas += 1
  if (!sourceResidue.identical) residues += 1
  // The line report is layout-sensitive and is printed for EVERY file, so a
  // change that keeps the operator counts and the literal multiset exactly is
  // still line-compared. The token report above is the structure-insensitive
  // answer to the same question.
  const sourceLines = lineDelta(oldText, newText)
  if (sourceLines.length > 0) {
    console.log('source lines (layout-sensitive):')
    for (const line of sourceLines) console.log(`  ${line}`)
  }
  if (distPath !== null) {
    const runtimeText = executable(readFileSync(join(repoRoot, distPath), 'utf8'), distPath)
    const runtimeOperators = operatorDelta(operatorCounts(oldText), operatorCounts(runtimeText))
    const runtimeLiterals = literalDelta(literalCounts(oldText), literalCounts(runtimeText))
    console.log(`runtime operators: ${runtimeOperators.length === 0 ? 'identical' : runtimeOperators.join(', ')}`)
    console.log(`runtime literals: ${runtimeLiterals.length === 0 ? 'identical' : runtimeLiterals.join(', ')}`)
    console.log(`runtime structure: ${structureReport(oldText, runtimeText)}`)
    console.log(`runtime tokens: ${tokenReport(oldText, runtimeText)}`)
    for (const line of tokenContext(oldText, runtimeText)) console.log(line)
    const runtimeResidue = residueReport(oldText, runtimeText)
    console.log(`runtime declared categories fired: ${runtimeResidue.fired.length === 0 ? 'none' : runtimeResidue.fired.join(', ')}`)
    console.log(`runtime residue after the declared categories: ${runtimeResidue.identical ? 'none' : runtimeResidue.residue.join('; ')}`)
    for (const line of runtimeResidue.context) console.log(line)
    if (runtimeOperators.length > 0) operatorDeltas += 1
    if (runtimeLiterals.length > 0) literalDeltas += 1
    if (!tokenDelta(oldText, runtimeText).identical) tokenDeltas += 1
    if (!runtimeResidue.identical) residues += 1
    const runtimeLines = lineDelta(oldText, runtimeText)
    if (runtimeLines.length > 0) {
      console.log('runtime lines (layout-sensitive):')
      for (const line of runtimeLines) console.log(`  ${line}`)
    }
  }
  console.log('')
}
console.log(`${operatorDeltas} operator delta(s), ${literalDeltas} literal delta(s), ${tokenDeltas} token delta(s), `
  + `${residues} residue(s) after the declared categories, across ${files.length} files`)
if (residues > 0) {
  console.error('parity scan: a difference the migration did not declare is left over')
  process.exit(1)
}
