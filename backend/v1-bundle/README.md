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

The table below names the rows whose purpose a reader would otherwise have to
guess at; every mounted row is in `cordis.patch.yml`.

| Row id | Package | Why it is here |
| --- | --- | --- |
| `agent` | `dsh-agent` | Agent/session registry (`agents`) |
| `session` | `dsh-session` | Durable session model (`sessions`) |
| `llm` | `dsh-llm` | Model interface (`llm`) |
| `system-prompt` | `dsh-system-prompt` | Prompt assembly (`systemPrompt`); empty persona in the baseline |
| `session-projection` | `dsh-session-projection` | Projection registry (`sessionProjections`) |
| `tools` | `dsh-tools` | Tool registry (`tools`) |
| `tool-todo` | `dsh-tool-todo` | The one model-facing tool the baseline registers |
| `agent-loop` | `dsh-agent-loop` | Loop mechanism; `agents: []` starts no Agent at boot |
| `agent-default-model` | `dsh-agent-default-model` | Explicit `deepseek-official` / `deepseek-flash` default |
| `llm-deepseek-api-key` | `dsh-llm-deepseek-api-key` | Official route; credential resolved per request |
| `session-persistence-jsonl` | `dsh-session-persistence-jsonl` | Durable JSONL sessions under the isolated `DSH_HOME` |
| `session-checkpoint-policy` | `dsh-session-checkpoint-policy` | Durability barrier before model/tool side effects |
| `session-query-sqlite` | `dsh-session-query-sqlite` | `sessionQuery`; explicit path and `openAt: first-search` |
| `jobs-local` | `dsh-jobs-local` | In-memory job registry |
| `attachment-local` | `dsh-attachment-local` | Content-addressed attachment storage under the isolated home |

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
