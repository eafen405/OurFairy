# @ourfairy/dsh-baseline-probe

A test-only liveness probe for the OurFairy v1 backend composition.

It is test-only: `backend/v1-bundle/cordis.patch.yml` does not name it. Tests
mount it through `overlay.patch.yml`:

```sh
dsh --profile ourfairy --patch backend/probe/overlay.patch.yml
```

Once the launcher commits app-readiness, the probe waits for the Loader tree to
settle and then reports, as machine-readable JSON:

| Report section | Fact it asserts |
| --- | --- |
| `services` | Every promised service is live, its row is present, enabled, and its fiber is `active` |
| `rows` | The exact composed row ids/names and their fiber states — the fact callers assert exclusions against |
| `model` | One real turn's outcome: session id, event count, assistant text, flush result |
| `sessions` | The durable session logs under the isolated `DSH_HOME` (`.jsonl`, or `.jsonl.zstd` when the writer compresses) |
| `failures` | Every failure as a sentence naming the service, row, or missing configuration |

The probe reports facts. Which capabilities must be absent is the expectation of
`tests/baseline-boot.test.mjs`, asserted against `rows`.

Environment: `OURFAIRY_PROBE_REPORT` (report path), `OURFAIRY_PROBE_MODE`
(`boot` | `turn` | `hold`), `OURFAIRY_PROBE_HOLD_MS` (bounded hold in `hold` mode;
`0` holds until a signal — the launcher's `start` relies on it to keep the booted
composition alive, because the dsh CLI returns from `runProfile` as soon as
readiness commits), `OURFAIRY_PROBE_PROVIDER` / `OURFAIRY_PROBE_MODEL` (the
explicit model selection a `turn` must carry, filled by the launcher from
`combo.json`), `DSH_HOME` (isolated home). A requested turn without a model
selection fails loudly with exit code 3 and names the missing variable.
