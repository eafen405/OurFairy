/**
 * The product's sandbox policy row: every product session runs under its own
 * private workspace root, and an unconfined mode is refused outright.
 *
 * @module @ourfairy/dsh-spaces/src/policy
 */
import { FsError } from '@deepseek-ai/dsh-fs'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxPolicyRequest } from '@deepseek-ai/dsh-sandbox-policy'

/** Native mode events and context; immutable ownership selects the file root. */
export default class OwnedSandboxPolicy extends SandboxPolicyService {
  static override inject = [...SandboxPolicyService.inject, 'ourfairySpaces']

  override resolve(request: SandboxPolicyRequest = {}) {
    const scope = this.ctx.ourfairySpaces
    scope.owner(request.session)
    const policy = super.resolve(request)
    if (policy.mode === 'danger-full-access') throw new FsError('unconfined execution is unavailable for product sessions', 'FS_PERMISSION_DENIED')
    return { ...policy, workspaceRoot: scope.privateRoot(request.session) }
  }
}
