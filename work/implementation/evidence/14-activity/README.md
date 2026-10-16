# T14 — one derived activity projection

Scope: #37 / `work/tickets/ourfairy-v1/14-activity.md`, parent stories 49–51. OurFairy `ticket/14-activity` starts from published T13 integration `69d7eaaeb1d27bbad62b89b11591337a149adb80`. No dsh changes, database/table, activity journal, owner copy or notification policy.

## Design and source

`backend/chat/src/activity.mjs` folds native Session events and existing inbox state. `jobs.mjs` provides the same report interpreter to both activity and task presentation. Current actual Agent execution and native job availability reconcile that history. Episode ids come from the original session id and starting native seq; latest closed/delivery summaries are valid only for the stated native `throughSeq`, and enclosing transport generation replacement requires fresh synchronization. See the owning chat README for numeric fields, sources and replacement rules.

A settled job and its actual reporter decision remain in one episode; no report/quiet context/cancellation/failure settle honestly. Accepted consecutive human turns remain in one scheduled execution episode; canceled preserved input stays parked. Quiet delivery is a closed output episode without inference, active delivery joins existing work, and lost process-local work stays unknown without swallowing later genuine completed episodes. Notification consumption and unread state remain outside this backend.

## Actual checks

```sh
node --test --test-name-pattern='actual confined job survives' tests/jobs.test.mjs
node --test --test-name-pattern='old task identities' tests/jobs.test.mjs
node --test --test-name-pattern='accepted consecutive turns' tests/jobs.test.mjs
node --test tests/jobs.test.mjs tests/text-delivery.test.mjs
```

TDD logs preserve initial missing activity, post-restart summary loss, and consecutive-turn episode failures before their fixes. Final affected public-profile suite **15/15 passed** (`real-profile-15.log.gz`). It uses real native Agent/Session JSONL, confined shell children, durable delivery, authenticated HTTP/SSE, and a deterministic local external-model double. Cases cover continuous job/report handoff observed over SSE, independent sessions, terminal jobs, waited/no-report, failed/canceled reports, quiet configured context, ordinary/active delivery, abrupt Host loss and new work after restart. Logs are losslessly gzip-compressed for Git whitespace hygiene.

Actual backend JSON: `actual-backend-activity.json`. Android owner `fa83e9ce` decoded the actual payload with compiled production serializers; its **57/57** JVM checks and debug APK evidence are under `android/`, including the bounded mcode handoff. Builds and serializer checks do not establish APK connected to backend, emulator/phone or cloud-model behavior.

The final normal commit hooks run the required full `npm test` and `npm run combo:verify`; their result will be appended to this evidence after completion. Runtime checks use the current published native production artifacts, not the pre-T13 stale build. No official cloud API, device, performance or final whole-product acceptance is claimed.
