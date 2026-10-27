/**
 * One failure the memory row reports to the model.
 *
 * A tool has no HTTP status of its own, so the code is also the start of the
 * message: the model reads `memory/not-queried: ...` and the class keeps the
 * status the same decision would answer with on a request path.
 *
 * @module @ourfairy/dsh-memory/src/errors
 */
export class MemoryError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'MemoryError'
    this.status = status
    this.code = code
  }
}
