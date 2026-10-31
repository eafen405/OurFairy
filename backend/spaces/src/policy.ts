/**
 * The product's sandbox policy row: every product session runs under its own
 * private workspace root, and an unconfined mode is refused outright.
 *
 * @module @ourfairy/dsh-spaces/src/policy
 */
import { FsError } from '@deepseek-ai/dsh-fs'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxPolicyRequest } from '@deepseek-ai/dsh-sandbox-policy'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'

/** Native mode events and context; immutable ownership selects the file root. */
export default class OwnedSandboxPolicy extends SandboxPolicyService {
  static override inject = [...SandboxPolicyService.inject, 'ourfairySpaces']

  override resolve(request: SandboxPolicyRequest = {}) {
    const scope = this.ctx.ourfairySpaces
    // An ownerless session — the memory maintenance child by today's
    // composition — has no file tools. The native sandbox-policy prompt context
    // still resolves a policy for every session, so answer with a read-only
    // shared root instead of deriving an owner-bound private root that cannot exist.
    // A request with no session at all is not ownerless: it keeps the refusal
    // below, because only an owned session names a private root.
    if (request.session !== undefined && shortIdOf(request.session.header?.owner) === undefined) {
      return { ...super.resolve(request), mode: 'read-only' as const, workspaceRoot: scope.root }
    }
    scope.owner(request.session)
    const policy = super.resolve(request)
    if (policy.mode === 'danger-full-access') throw new FsError('unconfined execution is unavailable for product sessions', 'FS_PERMISSION_DENIED')
    return { ...policy, workspaceRoot: scope.privateRoot(request.session) }
  }
}
