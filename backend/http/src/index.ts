/**
 * The product HTTP transport envelope as a dsh plugin row.
 *
 * The row mounts nothing and injects nothing: it exists so the bundle declares
 * and mounts this package, which is what puts the transport in the composed
 * profile and in `doctor`'s package checks. The code that matters is the
 * `./http` subpath, imported by the product routes.
 *
 * @module @ourfairy/dsh-http
 */

export const name = 'ourfairy-http'
export const inject: string[] = []

export function apply(): void {}
