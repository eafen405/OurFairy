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
comments group the rows — session/model/prompt core, durable session base,
process-local support services, the HTTP carrier and identity paths, owned
sessions and chat, the scoped file/shell adapters, and attachments/speech.

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

**The model route is declared twice from one source.** The `agent-default-model`
row states `deepseek-official`/`deepseek-flash` for the entry layers that consume
`agentDefaultModel`; those layers are not mounted in v1, and an Agent created
directly through the agent factory would otherwise carry no model. The launcher
therefore reads the same pair from `combo.json` (`backend.agentModel`) and passes
it to the probe as explicit `agentOptions`. `doctor`'s `bundle agent model` check
reads this file and asserts both values match `combo.json`.
