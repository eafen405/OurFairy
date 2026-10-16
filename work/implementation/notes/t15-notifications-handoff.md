# T15 owner handoff

Read `work/implementation/evidence/15-notifications/README.md` for exact validation and limits, plus current AGENTS/CODING_STANDARDS/CONVENTIONS. Android final branch `ticket/15-notifications`, final `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6`; helper branch `ticket/15-notifications-platform` already merged. Owner Android worktree `.worktrees/15-notifications`, helper `.worktrees/15-notifications-platform`; neither cleaned by owner. OurFairy evidence worktree `.worktrees/15-notifications`. No backend/dsh changes.

Complete: per-account owned session receiver/shared selected runtime; same-owner durable notification consumption; first/missing baselines, valid backlog catch-up and episode dedup; commit-before-notify crash policy; account StateFlow + late/cold target checks; dedicated specialUse FGS, explicit setup/status and bounded mcode UI/manifest task; final affected JVM136/136 and actual debug APK. Exact evidence includes real product SSE capture→production decoder/sync test. No active task-owned builds/backend/harness remain.

Pending Lead: preintegrate exact Android tip + combo, allow owner OurFairy evidence normal commit on latest integration, merger final npm test/combo/doctor, one batch T13–T15 code-review, authorized push/close/cleanup then stop. Parent must not continue later tickets. Physical-device acceptance remains #45.
