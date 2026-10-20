# @ourfairy/dsh-v1-bundle

The OurFairy v1 backend composition: one dsh profile bundle whose
`cordis.patch.yml` lists every row the first version runs.

## Why this bundle is explicit

The bundle lists its rows instead of inheriting `@deepseek-ai/dsh-base`: base
mounts capabilities v1 excludes (skill, goal, subagent, telemetry, web tools) and
default file/shell/sandbox rows with host-wide access. The scoped
`@ourfairy/dsh-spaces` adapters replace those defaults.

## Row set

`cordis.patch.yml` is the row set: it is the file the profile loads. Its section
comments group the rows — session/model/prompt core, model-request recovery and
tool-result retention, durable session base, process-local support services, the
HTTP carrier and identity paths, owned sessions and chat, the scoped file/shell
adapters, and attachments/speech.

Read that file for the inventory. The row ids and their packages have one
authority, and it is the file the loader reads; a hand-kept table here listed
only some of the mounted rows and went stale while the loader mounted the rest.

## Absent rows

`FORBIDDEN_ROW_IDS` in
[`tests/baseline-boot.test.mjs`](../../tests/baseline-boot.test.mjs) is the list of
row ids the boot test asserts absent from the live composition.

v1 keeps skills, goals, subagents, telemetry, web and workflow tooling, plan mode
and MCP resources out; the remainder of that list are the unscoped file, shell
and sandbox defaults the scoped adapters replace.

## Consuming it

The launcher (`scripts/ourfairy-backend.mjs`) generates a profile under the
isolated `OURFAIRY_HOME` that declares this package through a `file:` dependency
and lists it in `dsh.profile.bundles`, then boots the real dsh CLI.

## Two choices a reviewer will ask about

**Conversation search reuses the disposable query index.** It runs with
`openAt: first-search`, `snippetChars: 80` and `literalSubstring: true` for
Chinese substring matching, and the `@ourfairy/dsh-search` tools restrict native
SQL results to ids from the caller's own session headers. See
[`backend/search/README.md`](../search/README.md) for interval semantics and rebuild.

**The model route starts from a declared pair, then belongs to Phaethon.** The
`agent-default-model` row states the combination's initial shared selection
(`minimax-cn`/`MiniMax-M3.1-Flash-Preview` at `max` thinking effort), and the
product chat runtime reads that service at every turn start — so a selection
Phaethon saves through the gateway (`/gateway/selection`) takes effect from each
conversation's next reply without editing this file. The MiniMax route reuses
dsh's installed `minimax-cn` provider: this bundle only narrows it to the model
the deployment uses, declares its 1M context, image input and adaptive thinking,
and names `MINIMAX_CN_API_KEY`. The official DeepSeek route stays mounted as a
switchable alternative and is not selected. The probe creates its own Agent outside that runtime, so the
launcher passes the same pair to it as explicit `agentOptions`. `doctor`'s
`bundle agent model` check reads this file and asserts both values match
`combo.json`; that check covers the *initial* declaration only, never the saved
runtime selection.

**Model recovery and tool-result retention are native rows.** `llm-retry` re-runs a
failed model step inside the same open turn, and each provider profile owns the
policy it executes: the `llm-pi-ai` route declares `retryPolicy: { mode: normal }`,
the native bounded default. `spill-local` writes an oversized tool result under
`dshHomePath('spill')` — inside the isolated home, beside `sessions` and `uploads` —
and `spill-policy` keeps the model's copy within `maxInlineTokens: 8000`. That
budget is measured, not copied: a 5-page PDF read costs 5 004 estimated tokens and
the shell's own 64 000-byte stream cap costs 16 004, so ordinary document results
stay inline while a large shell result spills to a file the model can read or grep.
[ticket #82's evidence](../../work/implementation/evidence/82-native-rows/README.md)
records the measurements and the observed retry/spill behaviour. The four native
capabilities this composition depends on — PDF subprocess, retry, spill and the
history seam — are recorded with their compatibility tests in the
[native capability dependency record](../../docs/decisions/native-capability-dependencies.md).
That record points at this bundle's patch for the row inventory; it does not
repeat it.

**Live configuration rows are mounted deliberately.** `config-editor` and
`settings` persist the active profile, and `llm-pi-ai` supplies the multi-provider
adapter the gateway writes into; the deployment route above is its first entry,
so the shared selection has a route before anyone opens the gateway. The gateway is their only
product caller by construction: this bundle mounts no dsh settings-UI row — and the `speech` row is
live for the same reason: its connection settings are edited through the gateway.
