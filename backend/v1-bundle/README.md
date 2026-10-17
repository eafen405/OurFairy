# @ourfairy/dsh-v1-bundle

The OurFairy v1 backend composition: one dsh profile bundle whose
`cordis.patch.yml` lists every row the first version runs.

## Why this bundle is explicit

`@deepseek-ai/dsh-base` is **not** inherited. Base also mounts capabilities the
v1 product decision excludes (skill, goal, subagent, telemetry, web tools), and
its file, shell, and sandbox rows assume host-wide access; the v1 profile mounts
the scoped `@ourfairy/dsh-spaces` adapters in their place (T7, #30) and leaves
the unscoped rows out. A product that mounted base would silently gain those
rows, so the v1 row set is listed here and tests assert the absent rows stay
absent.

## Row set

`cordis.patch.yml` **is** the row set: it is the file the profile loads, so it is
the only list that cannot disagree with the running composition. Its section
comments group the rows — session/model/prompt core, durable session base,
process-local support services, the product's HTTP carrier and identity paths,
owned sessions and chat, the scoped file/shell adapters, and attachments/speech.

The table below is an overview, not the inventory: it names the rows whose
purpose a reader would otherwise have to guess at. Every mounted row is in
`cordis.patch.yml`.

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
| `session-query-sqlite` | `dsh-session-query-sqlite` | `sessionQuery`; explicit path and `openAt: first-search` (T10 search) |
| `jobs-local` | `dsh-jobs-local` | In-memory job registry |
| `attachment-local` | `dsh-attachment-local` | Content-addressed attachment storage under the isolated home |

## Deliberately absent rows

Which row ids must not be mounted is `FORBIDDEN_ROW_IDS` in
[`tests/baseline-boot.test.mjs`](../../tests/baseline-boot.test.mjs). That list is
the only expectation, and the boot test checks the live composition against it.
This README deliberately does not repeat it: a second copy would let the document
and the check agree with each other while both drifted from the bundle — the same
reason `backend/probe` keeps no copy of its own, recorded in its comment in
[`backend/probe/src/index.mjs`](../probe/src/index.mjs).

What the excluded rows have in common: the product decision keeps skills, goals,
subagents, telemetry, web and workflow tooling, plan mode, and MCP resources out
of v1; the remainder are the unscoped file, shell, and sandbox defaults that the
scoped adapters replace, or capabilities still waiting on their own adaptation
ticket. A capability is mounted only once that ticket lands.

## Consuming it

The launcher (`scripts/ourfairy-backend.mjs`) generates a profile under the
isolated `OURFAIRY_HOME` that declares this package through a `file:` dependency
and lists it in `dsh.profile.bundles`, then boots the real dsh CLI. This package
declares no `@deepseek-ai/dsh*` peerDependencies, so no exact-version exemption
is required.

## Two deliberate choices a reviewer will ask about

**Conversation search uses the existing disposable query index.** T10 enables
`openAt: first-search`, `snippetChars: 80`, and `literalSubstring: true` for
Chinese substring matching. The product's `@ourfairy/dsh-search` tools first
restrict native SQL results to IDs from the current owner's formal headers.
No second ownership table or search HTTP endpoint is introduced. See
[`backend/search/README.md`](../search/README.md) for interval semantics and rebuild.

**The model route is declared twice on purpose, from one source.** The
`agent-default-model` row states `deepseek-official`/`deepseek-flash` for the
entry layers that consume `agentDefaultModel` (the client gateway, ticket #28).
Those layers are not mounted in the v1 baseline, so nothing consumes the service
yet, and an Agent created directly through the agent factory would carry no model
at all. The launcher therefore reads the same pair from `combo.json`
(`backend.agentModel`) and passes it to the probe as an explicit `agentOptions`
selection. `doctor` runs a `bundle agent model` check that reads this file and
asserts both `provider:` and `model:` values match `combo.json backend.agentModel`,
so the two declarations cannot drift apart. The baseline never depends on an
implicit model default.
