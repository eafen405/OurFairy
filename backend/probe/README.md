# @ourfairy/dsh-baseline-probe

A test-only liveness probe for the OurFairy v1 backend composition.

It is **not** part of the product composition: `backend/v1-bundle/cordis.patch.yml`
does not name it. Tests mount it through `overlay.patch.yml` with the real dsh
launcher:

```sh
dsh --profile ourfairy --patch backend/probe/overlay.patch.yml
```

Once the launcher commits app-readiness, the probe waits for the Loader tree to
settle and then reports, as machine-readable JSON:

| Report section | Fact it asserts |
| --- | --- |
| `services` | Every promised service is live, its row is present, enabled, and its fiber is `active` |
| `rows` | The exact composed row ids/names and their fiber states |
| `excluded` | The unadapted file/shell/sandbox rows and the v1-excluded capabilities are **not** mounted |
| `tools` | What the tool registry exposes to introspection (marked `not-enumerable` rather than claiming an empty catalog) |
| `model` | One real turn's outcome: session id, event count, assistant text, flush result |
| `sessions` | The durable `.jsonl` files under the isolated `DSH_HOME` |
| `failures` | Every failure as a sentence naming the service, row, or missing configuration |

Environment: `OURFAIRY_PROBE_REPORT` (report path), `OURFAIRY_PROBE_MODE`
(`boot` | `turn`), `DSH_HOME` (isolated home). A requested turn without
`DEEPSEEK_API_KEY` fails loudly with exit code 3 and names the missing variable.
