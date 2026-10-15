import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { FsError } from '@deepseek-ai/dsh-fs'

/** Retain native mode events/context; only immutable ownership selects the file root. */
export default class OwnedSandboxPolicy extends SandboxPolicyService {
  static inject = [...SandboxPolicyService.inject, 'ourfairySpaces']
  resolve(request = {}) {
    const scope = this.ctx.ourfairySpaces
    scope.owner(request.session)
    const policy = super.resolve(request)
    if (policy.mode === 'danger-full-access') throw new FsError('unconfined execution is unavailable for product sessions', 'FS_PERMISSION_DENIED')
    return { ...policy, workspaceRoot: scope.privateRoot(request.session) }
  }
}
