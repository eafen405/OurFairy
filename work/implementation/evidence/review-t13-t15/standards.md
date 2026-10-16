# Standards review

Reviewed committed three-dot ranges (all refs resolved and all diffs nonempty):

- OurFairy `ecd345327225100e252d665039e9ad668ea4c3bb...bc984e9a49aa155fc8f8a79dff30768a17921a56`.
- dsh `173e155a85305db378dd92b1fa057ac6e6dea86e...fc5c7ac0220cf48c404cda34d1584901387eea06` (one commit).
- Android `b0911d34bdbe6ee8f559167ede41da95a9f082f8...3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6` (10 commits including two merges).

Read OurFairy AGENTS/CODING_STANDARDS/CONVENTIONS, dsh root/packages AGENTS plus architecture and defensive patterns, and Android root AGENTS. Inspected committed code with `git show`, excluding dsh's existing working-tree changes. Reviewed the supplied behavioral/build/integration evidence; did not rerun full suites. Device/cloud limitations are disclosed accurately.

## Documented violation

1. **P3 — Keep new opaque identities branded across the native service and Session interfaces.** dsh `AGENTS.md:141` requires “Opaque cross-boundary ids are branded … never bare string.” `packages/jobs/jobs/src/index.ts:88` introduces `readonly generation: string = randomUUID()`, then `packages/jobs/tool-jobs/src/index.ts:26,34,49` exposes that registry identity as bare strings in message-source and persisted-event declarations. The same event declares `messageId?: string` at line 52, although `@deepseek-ai/dsh-llm` already owns `MessageId`. These fields identify registries/messages rather than arbitrary text. Reuse `MessageId`; add one small generation brand beside the existing jobs brand and carry it through the declarations. This is a documented static type-safety deviation; no runtime failure is claimed.

## Smell baseline (judgment)

No additional useful smell finding. The shared native report fold, current registry enrichment, account receiver ownership, and existing sync-record reuse fit the documented minimal-change rules; no extra framework or defensive state is warranted by this review.

Total: **1 documented violation (P3), 0 smell suggestions; no confirmed runtime correctness finding.**
