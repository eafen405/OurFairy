# Original Standards review

Reviewer a203b47d-273e-4d98-9e6e-983e7ccae8a9: **1 hard P2**, no confirmed product-standard breaches or actionable Fowler smells.

Native lacks required recorded-session regression. Anchor native `packages/core/agent-loop/tests/system-prompt-admission.spec.ts:83`; production `packages/session/session-format-v3-to-v4/src/relationships.ts:124`. The increment changes user-visible cold restoration from rejection to acceptance for delivery→first human and delivery-containing prune/replacement spans. Added tests use in-process harness and JSON/catalog round trip; no recorded-session scenario in the six-file increment. Native `docs/testing.md:55` requires every non-trivial model/protocol/human-visible change to add/update a keyless recorded-session scenario in the same PR and explicitly says package/e2e/mock-only evidence does not replace assembled transcript; `AGENTS.md:158` repeats it. Add a focused existing recorded-session-harness scenario for affected restore history and run keyless replay.

Excluded from findings: four proven unchanged native documentation baseline failures; product hook deferral with final Node854/Android787/combo actually run; necessary existing-module reuse and small-project rules.
