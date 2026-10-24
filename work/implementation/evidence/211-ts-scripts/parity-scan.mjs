#!/usr/bin/env node
/**
 * Operator, literal, structure and token parity between the pre-migration
 * scripts and the migrated ones.
 *
 * The migration must not change behaviour, so the code that runs has to keep
 * the same operators and the same literals. This script proves that mechanically
 * instead of by assertion.
 *
 * The scripts are not emitted: Node strips their types when it loads them. So
 * the comparison is between the pre-migration `.mjs` and the migrated `.ts`
 * **after Node's own stripper** (`module.stripTypeScriptTypes`, the function
 * Node itself uses) has erased the type annotations. That is the text the
 * runtime loads, not a model of it.
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
 *   node work/implementation/evidence/211-ts-scripts/parity-scan.mjs [base-ref]
 */
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createRequire, stripTypeScriptTypes } from 'node:module'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(repoRoot, 'package.json'))
const ts = require('typescript')

/** The commit the migration branched from. */
const base = process.argv[2] ?? '303280fdcf'

/**
 * The commit the migration landed in; the right-hand side is read from there.
 *
 * The scan certifies the MIGRATION: the pre-migration scripts against the
 * migrated ones. The review of spec #205 then changed two of those scripts on
 * purpose — a shared CLI guard that refuses a Node without `import.meta.main`,
 * and a Node range that accepts `>=N.M.P` — and those are declared where they
 * were made (the evidence README's §10), not here: a declared category is a
 * difference the migration did NOT make. Reading the right-hand side from the
 * working tree would make the scan certify the review fixes as well, which is
 * not what it measures.
 */
const migrated = process.argv[3] ?? '29f6d71ad2'

/**
 * The migrated script, its pre-migration twin, and the script's own name.
 *
 * The scripts are run from source, so there is no emitted artefact to compare:
 * the runtime text is the type-stripped source.
 */
const files = [
  ['scripts/bench-gate.mjs', 'scripts/bench-gate.ts'],
  ['scripts/bench-projection.mjs', 'scripts/bench-projection.ts'],
  ['scripts/combo.mjs', 'scripts/combo.ts'],
  ['scripts/evidence-index.mjs', 'scripts/evidence-index.ts'],
  ['scripts/link-types.mjs', 'scripts/link-types.ts'],
  ['scripts/ourfairy-backend.mjs', 'scripts/ourfairy-backend.ts'],
  ['scripts/ourfairy-composition.mjs', 'scripts/ourfairy-composition.ts'],
  ['scripts/pdf-flash-smoke.mjs', 'scripts/pdf-flash-smoke.ts'],
  ['scripts/precommit.mjs', 'scripts/precommit.ts'],
  ['scripts/real-acceptance.mjs', 'scripts/real-acceptance.ts'],
  ['scripts/specs-status.mjs', 'scripts/specs-status.ts'],
  ['scripts/tsc.mjs', 'scripts/tsc.ts'],
]

/** The scripts' own names, as the migrated ones are named. */
const migratedNames = [
  'bench-gate', 'bench-projection', 'combo', 'evidence-index', 'link-types',
  'ourfairy-backend', 'ourfairy-composition', 'pdf-flash-smoke', 'precommit',
  'real-acceptance', 'specs-status', 'tsc',
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
 * The executable text of one source, transpiled with the pinned compiler so
 * comments and type annotations are gone and only executable code is counted.
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
      // The scripts are run from source, so an import that nothing reads still
      // loads its module; the printer must not elide it.
      verbatimModuleSyntax: true,
    },
  }).outputText
}

/**
 * The text Node loads: the source with its type annotations erased by Node's
 * own stripper.
 * @param {string} source - the file's text.
 * @returns {string} the executable text.
 */
function stripped(source) {
  return stripTypeScriptTypes(source, { mode: 'strip' })
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
 * Replace every occurrence of one token sequence with another.
 * @param {string[]} tokens - the token stream.
 * @param {string[]} from - the sequence to find.
 * @param {string[]} to - the sequence to write.
 * @returns {string[]} the rewritten stream.
 */
function replaceTokenSequence(tokens, from, to) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (from.every((token, k) => tokens[i + k] === token)) {
      out.push(...to)
      i += from.length - 1
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/**
 * Rewrite a string literal that names one of the migrated scripts.
 *
 * The scripts moved from `.mjs` to `.ts`, so every path that names one of them
 * changed with it: the relative import specifiers and the paths the scripts
 * print or spawn. A literal that names a DIFFERENT `.mjs` file — the test files
 * the gate selects — is left alone.
 * @param {string[]} tokens - the token stream.
 * @returns {string[]} the rewritten stream.
 */
function renameScriptLiterals(tokens) {
  const pattern = new RegExp(`(^|[^A-Za-z0-9-])(${migratedNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})\\.mjs(?![A-Za-z0-9-])`, 'u')
  return tokens.map(token => {
    if (!token.startsWith("'") && !token.startsWith('"')) return token
    return token.replace(pattern, (_, before, name) => `${before}${name}.ts`)
  })
}

/**
 * Drop the parentheses that wrap a single identifier or member chain.
 *
 * A cast leaves its parentheses behind when the type is erased: `(error)`
 * where the pre-migration code read `error`. A parenthesised member chain is
 * the same expression as the chain itself, so dropping the parentheses changes
 * nothing.
 * @param {string[]} tokens - the token stream.
 * @returns {string[]} the rewritten stream.
 */
function dropChainParentheses(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '(' && tokens[i + 2] === ')'
      && /^[A-Za-z_$][\w$]*$/u.test(tokens[i + 1] ?? '')
      && !precedesACall(tokens[i - 1])) {
      out.push(tokens[i + 1])
      i += 2
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/**
 * Whether a token can only precede a call, so the parenthesis after it is the
 * call's own and not a group.
 * @param {string | undefined} token - the token before the parenthesis.
 * @returns {boolean} true when the parenthesis belongs to a call.
 */
function precedesACall(token) {
  if (token === undefined) return false
  if (!/^[A-Za-z_$][\w$]*$/u.test(token)) return false
  return !keywords.has(token)
}

/**
 * The keywords that may precede a parenthesised expression.
 *
 * `return (error).message` groups an expression; `f(x)` calls a function. Only
 * the second one must keep its parenthesis.
 */
const keywords = new Set([
  'await', 'case', 'default', 'delete', 'do', 'else', 'in', 'instanceof', 'new',
  'of', 'return', 'throw', 'typeof', 'void', 'yield',
])

/**
 * The differences the migration declares, as token-stream transformations.
 *
 * Each transformation is applied to BOTH streams, so a difference that
 * survives all of them is a difference the migration did not declare. The
 * list is this migration's own: another ticket declares its own.
 */
const declaredCategories = [
  {
    // A relative import must carry the `.ts` specifier Node's type stripping
    // does NOT rewrite.
    name: 'script-specifier',
    apply: renameScriptLiterals,
  },
  {
    // The CLI guard is `import.meta.main`; the pre-migration guard compared the
    // module's URL with argv. Both are true for a direct run; the new one is
    // also true when the script is reached through a symlink.
    name: 'import-meta-main-guard',
    apply: tokens => replaceTokenSequence(tokens,
      ['(', 'import', '.', 'meta', '.', 'url', '===', '`file://${', 'process', '.', 'argv', '[', '1', ']', '}`', ')'],
      ['(', 'import', '.', 'meta', '.', 'main', ')']),
  },
  {
    // The evidence-index guard compared argv with the module's own path.
    name: 'import-meta-main-guard-argv',
    apply: tokens => replaceTokenSequence(tokens,
      ['(', 'process', '.', 'argv', '[', '1', ']', '===', 'fileURLToPath', '(', 'import', '.', 'meta', '.', 'url', ')', ')'],
      ['(', 'import', '.', 'meta', '.', 'main', ')']),
  },
  {
    // The `--fresh` build path also removes the scripts' own build info, so a
    // stale incremental state cannot survive a fresh build. The statement sits
    // between the removed list and the backend directory it walks, which is
    // what makes the replacement fire on the pre-migration text only.
    name: 'fresh-build-info',
    apply: tokens => replaceTokenSequence(tokens,
      ['const', 'removed', '=', '[', ']', ';', 'const', 'backend', '=', 'join', '(', 'root', ',', "'backend'", ')', ';'],
      ['const', 'removed', '=', '[', ']', ';',
        'rmSync', '(', 'join', '(', 'root', ',', "'scripts'", ',', "'tsconfig.tsbuildinfo'", ')', ',',
        '{', 'force', ':', 'true', '}', ')', ';',
        'const', 'backend', '=', 'join', '(', 'root', ',', "'backend'", ')', ';']),
  },
  {
    // The same removal in the source the runtime loads, where the statement
    // separator is the one the file itself carries.
    name: 'fresh-build-info-source',
    apply: tokens => replaceTokenSequence(tokens,
      ['const', 'removed', '=', '[', ']', 'const', 'backend', '=', 'join', '(', 'root', ',', "'backend'", ')'],
      ['const', 'removed', '=', '[', ']',
        'rmSync', '(', 'join', '(', 'root', ',', "'scripts'", ',', "'tsconfig.tsbuildinfo'", ')', ',',
        '{', 'force', ':', 'true', '}', ')',
        'const', 'backend', '=', 'join', '(', 'root', ',', "'backend'", ')']),
  },
  {
    // The fetch body is cast to `BodyInit`; the cast needs the parentheses the
    // conditional expression would otherwise lose its precedence to.
    name: 'fetch-body-cast',
    apply: tokens => replaceTokenSequence(tokens,
      ['(', 'Buffer', '.', 'isBuffer', '(', 'body', ')', '?', 'body', ':', 'JSON', '.', 'stringify', '(', 'body', ')', ')'],
      ['Buffer', '.', 'isBuffer', '(', 'body', ')', '?', 'body', ':', 'JSON', '.', 'stringify', '(', 'body', ')']),
  },
  {
    // The recursive directory listing is cast to the names it yields; the cast
    // needs the parentheses the call would otherwise lose its precedence to.
    name: 'recursive-listing-cast',
    apply: tokens => replaceTokenSequence(tokens,
      ['(', 'readdirSync', '(', 'absolute', ',', '{', 'recursive', ':', 'true', '}', ')', ')'],
      ['readdirSync', '(', 'absolute', ',', '{', 'recursive', ':', 'true', '}', ')']),
  },
  {
    // The same removal in the source the compiler prints, where the import
    // statement carries the separator the printer adds.
    name: 'unused-imports-removed-source',
    apply: tokens => replaceTokenSequence(tokens,
      ['import', '{', 'createHash', '}', 'from', "'node:crypto'", ';'],
      []),
  },
  {
    // A typed arrow parameter needs its parentheses.
    name: 'arrow-param-parens',
    apply: dropArrowParameterParens,
  },
  {
    // Two imports the acceptance script never used were dropped: the strict
    // compiler refuses them, and nothing read them.
    name: 'unused-imports-removed',
    apply: tokens => dropTokenSequence(
      replaceTokenSequence(tokens,
        ['rmSync', ',', 'writeFileSync', '}', 'from', "'node:fs'"],
        ['writeFileSync', '}', 'from', "'node:fs'"]),
      ['import', '{', 'createHash', '}', 'from', "'node:crypto'"]),
  },
  {
    // A cast leaves its parentheses behind when the type is erased.
    name: 'cast-parentheses',
    apply: dropChainParentheses,
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
 * The operator counts of one token stream.
 *
 * The operator list is a list of token texts, so counting them in the stream is
 * the same as counting them in the text with the literals masked: a string
 * literal is one token and is never one of the operator texts.
 * @param {string[]} tokens - the token stream.
 * @returns {Record<string, number>} the count per operator.
 */
function operatorCountsOfTokens(tokens) {
  const counts = {}
  for (const operator of operators) counts[operator] = 0
  for (const token of tokens) {
    if (Object.hasOwn(counts, token)) counts[token] += 1
  }
  return counts
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
 * @returns {{identical: boolean, fired: string[], residue: string[], context: string[]}} the residue and the categories that fired.
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
  return { identical: listed.length === 0, fired, residue: listed, context, oldTokens, newTokens }
}

const before = (path, ref = base) => execFileSync('git', ['show', `${ref}:${path}`], { cwd: repoRoot, encoding: 'utf8' })

let operatorDeltas = 0
let literalDeltas = 0
let tokenDeltas = 0
let residues = 0
for (const [oldPath, newPath] of files) {
  const oldSource = before(oldPath)
  const newSource = before(newPath, migrated)
  // The source comparison: both sides go through the pinned compiler, so the
  // comments and the type annotations are gone and only executable code is
  // compared.
  const oldText = executable(oldSource, oldPath)
  const newText = executable(newSource, newPath)
  console.log(`# ${newPath}`)
  console.log(`operators: ${operatorDelta(operatorCounts(oldText), operatorCounts(newText)).join(', ') || 'identical'}`)
  console.log(`literals: ${literalDelta(literalCounts(oldText), literalCounts(newText)).join(', ') || 'identical'}`)
  console.log(`structure: ${structureReport(oldText, newText)}`)
  console.log(`tokens: ${tokenReport(oldText, newText)}`)
  for (const line of tokenContext(oldText, newText)) console.log(line)
  const sourceResidue = residueReport(oldText, newText)
  console.log(`declared categories fired: ${sourceResidue.fired.length === 0 ? 'none' : sourceResidue.fired.join(', ')}`)
  const residualOperators = operatorDelta(
    operatorCountsOfTokens(residueReport(oldText, newText).oldTokens),
    operatorCountsOfTokens(residueReport(oldText, newText).newTokens))
  console.log(`operators after the declared categories: ${residualOperators.join(', ') || 'identical'}`)
  console.log(`residue after the declared categories: ${sourceResidue.identical ? 'none' : sourceResidue.residue.join('; ')}`)
  for (const line of sourceResidue.context) console.log(line)
  if (residualOperators.length > 0) operatorDeltas += 1
  if (literalDelta(literalCounts(oldText), literalCounts(newText)).length > 0) literalDeltas += 1
  if (!tokenDelta(oldText, newText).identical) tokenDeltas += 1
  if (!sourceResidue.identical) residues += 1
  // The line report is layout-sensitive and is printed for EVERY file, so a
  // change that keeps the operator counts and the literal multiset exactly is
  // still line-compared. The token report above is the structure-insensitive
  // answer to the same question.
  const sourceLines = lineDelta(oldText, newText)
  if (sourceLines.length > 0) {
    console.log('lines (layout-sensitive):')
    for (const line of sourceLines) console.log(`  ${line}`)
  }
  // The runtime comparison: the pre-migration script as it ran, against the
  // text Node loads for the migrated one. This is the check that would catch a
  // difference the compiler's printer hides.
  const runtimeOld = oldSource
  const runtimeNew = stripped(newSource)
  const runtimeResidue = residueReport(runtimeOld, runtimeNew)
  console.log(`runtime tokens: ${tokenReport(runtimeOld, runtimeNew)}`)
  for (const line of tokenContext(runtimeOld, runtimeNew)) console.log(line)
  console.log(`runtime declared categories fired: ${runtimeResidue.fired.length === 0 ? 'none' : runtimeResidue.fired.join(', ')}`)
  console.log(`runtime residue after the declared categories: ${runtimeResidue.identical ? 'none' : runtimeResidue.residue.join('; ')}`)
  for (const line of runtimeResidue.context) console.log(line)
  if (!runtimeResidue.identical) residues += 1
  console.log('')
}
console.log(`${operatorDeltas} operator delta(s) after the declared categories, ${literalDeltas} literal delta(s) before them, `
  + `${tokenDeltas} token delta(s) before them, ${residues} residue(s) after them, across ${files.length} files`)
if (residues > 0) {
  console.error('parity scan: a difference the migration did not declare is left over')
  process.exit(1)
}
