/**
 * The CLI guard every script in this directory shares.
 *
 * `import.meta.main` landed in Node 22.18.0, and on the 24.x line in 24.2.0. A
 * Node older than that leaves the field `undefined` — not `false` — so a guard
 * that reads it as a boolean turns "I cannot tell" into "I am not the entry
 * point". The CLI then exits 0 having done nothing, and `npm run build` and
 * `npm run combo:verify` become silent no-ops: the gate passes without
 * building anything.
 *
 * The repository's Node floor is therefore `^22.19.0 || >=24.2.0` (the same
 * range `package.json` and `combo.json` declare), and this module is what makes
 * a Node below that floor fail loudly instead of quietly doing nothing.
 *
 * The flag is passed in because `import.meta` is per-module: a helper cannot
 * read its caller's `import.meta.main`.
 */

/** The Node versions this repository supports; the same range `combo.json` declares. */
export const REQUIRED_NODE_RANGE = '^22.19.0 || >=24.2.0'

/**
 * Whether this module is the process entry point.
 *
 * A Node that does not provide `import.meta.main` cannot answer the question,
 * and a CLI that cannot answer it must not pretend the answer is "no": it must
 * fail with a message that names the Node it needs.
 * @param isMain - the caller's `import.meta.main`.
 * @returns whether the caller is the entry point.
 * @throws when the Node does not provide `import.meta.main` at all.
 */
export function isCliEntry(isMain: boolean | undefined): boolean {
  if (isMain === undefined) {
    throw new Error(`import.meta.main is undefined: this Node does not provide it, so the CLI cannot tell whether it is the entry point.`
      + ` Node ${REQUIRED_NODE_RANGE} is required (import.meta.main landed in Node 22.18.0, and in 24.2.0 on the 24.x line).`)
  }
  return isMain
}
