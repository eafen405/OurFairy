/**
 * Temporary compatibility exit for `@ourfairy/dsh-identity/http` (ticket #138).
 *
 * The transport envelope now lives in `@ourfairy/dsh-http/http`; this module
 * re-exports it so the product packages that still import the identity subpath
 * keep working until their own tickets (#139, #140) move them. The closeout
 * ticket removes this file and the `./http` export.
 *
 * @module @ourfairy/dsh-identity/src/http
 */
export { bearerToken, postHandler, sendJson } from '@ourfairy/dsh-http/http'
