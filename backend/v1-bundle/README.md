# @ourfairy/dsh-v1-bundle

The OurFairy v1 backend composition: one dsh profile bundle whose
`cordis.patch.yml` lists every row the first version runs.

## Why this bundle is explicit

`@deepseek-ai/dsh-base` is **not** inherited. Base also mounts capabilities the
v1 product decision excludes (skill, goal, subagent, telemetry, web tools) and
file/shell/sandbox defaults whose permission adaptation has not landed. A
product that mounted base would silently gain those rows, so the v1 row set is
listed here and tests assert the absent rows stay absent.

## Row set

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
| `session-query-sqlite` | `dsh-session-query-sqlite` | `sessionQuery`; explicit path and `openAt: never` (search opt-in) |
| `jobs-local` | `dsh-jobs-local` | In-memory job registry |
| `attachment-local` | `dsh-attachment-local` | Content-addressed attachment storage under the isolated home |

## Deliberately absent rows

`tool-fs`, `tool-fs-search`, `fs-sandbox`, `fs-observation-policy`,
`working-directory`, `tool-working-directory`, `tool-bash`, `bash-sandbox`,
`pwsh-sandbox`, `tool-pwsh`, `sandbox`, `sandbox-policy`, `approval`,
`permission`, `shell-env`, `subprocess`, `skill*`, `goal*`, `subagent*`,
`otel`/`session-telemetry-otel`, `web*`, `mcp-resources`, `plan-mode`,
`workflow-ptc`/`tool-workflow`/`ptc-runtime`.

Each absent group is waiting on its own adaptation ticket; a test asserts none of
these ids is mounted so a later accidental widening is caught.

## Consuming it

The launcher (`scripts/ourfairy-backend.mjs`) generates a profile under the
isolated `OURFAIRY_HOME` that declares this package through a `file:` dependency
and lists it in `dsh.profile.bundles`, then boots the real dsh CLI. This package
declares no `@deepseek-ai/dsh*` peerDependencies, so no exact-version exemption
is required.

## Two deliberate choices a reviewer will ask about

**`session-query-sqlite` is mounted with `openAt: never` on purpose.** The
readiness research records that `never` is the *base bundle's* patch value, not
the plugin's own default (the plugin's own default is `startup`). Because this
bundle does not inherit `@deepseek-ai/dsh-base`, that inherited value is not in
play: the `never` written here is an explicit choice, so the v1 baseline mounts
the query plugin (its exact reads and titles stay available) while content
search stays off. Ticket #33 enables search by turning this into
`startup`/`first-search` against the same isolated home; it is not a missing
configuration, and it must not be flipped silently by an unrelated profile
change.

**The model route is declared twice on purpose, from one source.** The
`agent-default-model` row states `deepseek-official`/`deepseek-flash` for the
entry layers that consume `agentDefaultModel` (the client gateway, ticket #28).
Those layers are not mounted in the v1 baseline, so nothing consumes the service
yet, and an Agent created directly through the agent factory would carry no model
at all. The launcher therefore reads the same pair from `combo.json`
(`backend.agentModel`) and passes it to the probe as an explicit `agentOptions`
selection; `doctor` compares the two declarations so they cannot drift apart.
The baseline never depends on an implicit model default.
