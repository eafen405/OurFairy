# Original Spec review

Reviewer dba8d91f-0c64-4243-a11e-15f98b56e06e: **1 actionable P2**, no scope creep or other confirmed missing/wrong requirements.

Android status-query refusal wrongly terminates unknown operation and discards recovery identity. `RemoteChatState.kt:849` invokes same failure handler as execute; `889–903` classifies HTTP<500 as rejection, clears persisted pendingCommand, sets rejected=true; `retrySessionCommand:854–858` then allocates new UUID. Trigger: /clear accepted but execute response lost; credential expires before recovery query; legitimate status401 (expiry supported identity/src/store.ts:789–799) establishes no original command outcome. After reauth/restart client cannot restore original identity and retry can blindly clear again.

Spec `docs/specs/session-commands.md:144`: “结果不明时先恢复原操作结果，不以新的身份盲目重置”。Protocol `work/tickets/342/protocol.md:11`: “明确终态失败后用户显式重试可新建身份”。Preserve pending identity on status failures, distinguish query failure from definite execute refusal. Reauth/restart must query original ID before execution; no new ID without terminal fact or proven no admission.
