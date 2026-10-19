# @ourfairy/dsh-v1-bundle

The OurFairy v1 backend composition: one dsh profile bundle whose
`cordis.patch.yml` lists every row the first version runs.

## Why this bundle is explicit

The bundle lists its rows instead of inheriting `@deepseek-ai/dsh-base`: base
mounts capabilities v1 excludes (skill, goal, subagent, telemetry, web tools) and
default file/shell/sandbox rows with host-wide access. The scoped
`@ourfairy/dsh-spaces` adapters replace those defaults.

## Row set and package set

`cordis.patch.yml` is the row set: it is the file the profile loads. Its section
comments group the rows — session/model/prompt core, durable session base,
process-local support services, the HTTP carrier and identity paths, owned
sessions and chat, the scoped file/shell adapters, and attachments/speech.

Read that file for the inventory. The row ids and their packages have one
authority, and it is the file the loader reads; a hand-kept table here listed
only some of the mounted rows and went stale while the loader mounted the rest.

The product package set is this manifest's `dependencies`: every `@ourfairy/*`
module a row mounts is declared here as a `file:` dependency on its directory in
this repository. Read `package.json` for the list — it is not repeated in this
README. The launcher derives the generated profile's product dependencies from
that field (plus the test-only probe that combo.json names), and `doctor`'s
`bundle packages` check compares the composed rows, this manifest, and the
installed profile, naming the package and row id when they disagree. Adding a
product package therefore means adding its directory, declaring it here, and
mounting it in the patch; no launcher file changes.

The published `files` list is the installed copy's contents: the patch, this
README, and `locale/*.json` — dsh reads `locale/<language>.json` for a bundle's
display metadata. A boot reads nothing from this checkout that the manifest does
not publish.

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
and lists it in `dsh.profile.bundles`, then boots the real dsh CLI. pnpm installs
this package's own `file:` dependencies from this checkout, so the profile
receives one copy of every declared product package without the launcher naming
any of them.

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

**Live configuration rows are mounted deliberately.** `config-editor` and
`settings` persist the active profile, and `llm-pi-ai` supplies the multi-provider
adapter the gateway writes into; the deployment route above is its first entry,
so the shared selection has a route before anyone opens the gateway. The gateway is their only
product caller by construction: this bundle mounts no dsh settings-UI row — and the `speech` row is
live for the same reason: its connection settings are edited through the gateway.
