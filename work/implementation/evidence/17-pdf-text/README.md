# T17 / #40: qualified PDF page text

Scope: OurFairy only, branch `ticket/17-pdf-text`, based on integration commit
`7687485c58f8db607d1ad2c4fbde982b92305bd0`. No dsh or Android changes, database
schema changes, derived store, or cache. The existing attachment manifest remains
the qualification authority and the original remains byte-preserving.

The real product profile registers `pdf_info` (page count and bounded page-one
sample) and `pdf_read_pages` (1–5 selected pages, 4,000 characters/page), with
page numbers, truncation and empty-page/image hints. Parsing uses the maintained
pypdf 6.21.0 wheel in a private temporary read-only bwrap mount, reusing the
spaces module's existing carrier. Numeric status is 1 success, 2 partial page
failure, 3 failure. Errors distinguish encrypted, damaged, invalid pages, page
limit and resource limit. The original upload/download protocol is unchanged.

## Executed checks

- `git merge 7687485`: fast-forwarded the existing ticket worktree without
  discarding its uncommitted implementation. Git metadata needed normal elevated
  execution because the sandbox marks the shared `.git` directory read-only.
- `node --test tests/pdf.test.mjs`: final run **3/3 passed**, raw log
  `10-pdf-green.log`. This boots the shipped profile and authenticates actual
  users; only the external model is a loopback substitute. Real fixture bytes go
  through upload, qualified tools, model-visible page references and original
  download. It checks same-user other-session and cross-user path rejection,
  selected-page isolation, encrypted/damaged/empty/partial/page-limit cases,
  truncation and a compressed input reaching the real worker resource budget.
- Red evidence is retained in `01-red.log`, `03-red-missing-tool.log` and
  `09-pdf-final.log`. The resumed resource check exposed pypdf's explicit
  `LimitReachedError` being mislabeled as an unreadable page; the worker now
  reports library and operating-system budget exhaustion as `resource-limit`.
  `08-resume-check.log` is an environment failure (sandbox forbids loopback
  listening), not a product failure.
- `curl --fail --silent --show-error https://pypi.org/pypi/pypdf/6.21.0/json
  -o /tmp/t17-pypdf-6.21.0.json`, followed by local Python zip metadata and hash
  inspection: the vendored wheel SHA256 equals the published PyPI SHA256.
  `dependency-check.log` records version, BSD-3-Clause license, source URL,
  runtime versions, and byte-identical fixture hashes after running
  `/usr/bin/python3 tests/fixtures/pdf/generate.py` twice. Dependency reproduction
  and all parser budgets are documented in `backend/attachments/pdf/README.md`.
- `npm test`: **105/105 passed**, complete real-profile suite, raw log
  `11-npm-test.log`.
- `npm run combo:verify`: **passed**, raw log `12-combo-verify.log`.
- `git diff --check`: passed.

## Boundaries

The fixtures are reproducible synthetic valid PDF files with independent literal
page text; they are not mocks of the parser. See `tests/fixtures/pdf/README.md`.
The optional model double echoes the tool result, demonstrating that page labels
reach the conversation; no official DeepSeek inference, external account, Android
device or vivo acceptance is claimed. Scanned pages report `needsImage`; rendering
and the visual provider path belong to dependent T18 and were not implemented.

No unconfined parser fallback is provided. The runtime currently requires Linux,
Python >=3.9, bwrap and prlimit, as already required by the product's restricted
script carrier. Missing runtime tools make the worker unavailable explicitly.

A bounded dependency-documentation task was offered to mcode but automatic
approval rejected exporting repository context to its external model service.
That delegation did not execute; dependency verification was completed locally.
