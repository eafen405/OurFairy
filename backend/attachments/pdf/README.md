# PDF parsing and rendering dependencies

The unmodified `pypdf-6.21.0-py3-none-any.whl` is vendored so backend startup does
not install Python packages or depend on a global Python environment. The worker
imports this pure Python wheel directly through `sys.path` (zipimport).

- Upstream: <https://github.com/py-pdf/pypdf>, documentation: <https://pypdf.readthedocs.io/>.
- Version: **6.21.0**, requires Python **>=3.9**.
- License: **BSD-3-Clause**. The complete copyright and license text is retained
  inside `pypdf-6.21.0.dist-info/licenses/LICENSE` in the wheel.
- PyPI metadata: <https://pypi.org/pypi/pypdf/6.21.0/json>.
- SHA256: `3aec619699dacb1b73f57e87d9adaa4424814517b2cc028de20adba5a37af4c4`.

To reproduce the dependency from the repository root:

```sh
curl --fail --location 'https://files.pythonhosted.org/packages/f4/64/5cea5792cae22892a4ddba8ed9f7424c77b4cb49fdca5016bd62145c12c6/pypdf-6.21.0-py3-none-any.whl' --output backend/attachments/pdf/pypdf-6.21.0-py3-none-any.whl
printf '%s\n' '3aec619699dacb1b73f57e87d9adaa4424814517b2cc028de20adba5a37af4c4  backend/attachments/pdf/pypdf-6.21.0-py3-none-any.whl' | sha256sum --check
```

The PDF worker currently requires Linux, `/usr/bin/python3`, `/usr/bin/prlimit`
and the existing `bwrap` carrier. The tested versions are Python 3.14.4,
bubblewrap 0.11.1 and util-linux 2.41.3. There is no unconfined fallback.
The qualified original is copied into a private temporary directory, mounted
read-only alongside this wheel and worker, and deleted after the call. No derived
database or persistent cache is created.

`src/pdf.ts` bounds concurrent parsers to two, each with 512 MiB address space,
5 CPU seconds, 10 wall-clock seconds, 64 file descriptors and 256 KiB stdout.
The existing upload limit is 32 MiB. Documents are limited to 500 pages; each call
reads at most five selected pages and returns at most 4,000 characters per page.
`pdf_info` reads only a 1,000-character first-page sample and the page count.
The library's own decompression limits also report `resource-limit`.

The worker runs under the native `ctx.subprocess` service: the module passes the
bwrap/prlimit argv, the 10-second wall deadline as the spawn `signal`, `graceMs`,
the 256 KiB stdout collect cap and a small bounded, discarded stderr collector.
The service kills the whole range; the module awaits `waitForExit()` before
removing its temporary directory, and the cancellation test asserts that no
worker survives. The module keeps only its own budgets
and the numeric result mapping: a worker the service terminates (deadline or
caller stop, reported as SIGTERM) is `resource-limit`; `bwrap` turns a killed
payload into `128+signal`, so 152 (SIGXCPU from `--cpu=5`) and 137 (SIGKILL
escalation or OOM) also map to `resource-limit`; any other nonzero exit is
`worker-unavailable`.

The service is a load-bearing dsh dependency: its row, the behavior relied on and
the tests that fail if it changes are in the
[native capability dependency record](../../../docs/decisions/native-capability-dependencies.md#pdf-worker-ctxsubprocess).

These are product demo budgets, not a promise of perfect complex-layout or OCR
extraction. Encrypted PDFs are rejected even when an empty password could open
them. No-text pages request image reading through `pdf_render_pages` when needed.

## Selected-page rendering

Rendering uses the installed `/usr/bin/pdftoppm` command from **Poppler 26.01.0**
(test environment); it adds no Python renderer or OCR service. Poppler is a
runtime system dependency, licensed GPL-2.0-or-later, available from
<https://poppler.freedesktop.org/> and the distribution's `poppler-utils` package.
Check the actual deployed version with `pdftoppm -v`; it must be present on the
backend host. `pdfinfo` is installed on the test host but is not required by this
module. Missing renderer returns `renderer-unavailable`.

Poppler also reads `/etc/fonts` as an explicit readonly runtime mount so the
existing system fonts resolve inside bwrap. No user font directory is mounted.

The same worker first applies pypdf's damaged/encrypted/500-page checks, then
invokes `pdftoppm -f N -l N -singlefile -scale-to 1600 -png` independently for each
requested page. At most **three** pages are accepted, never the whole document.
The existing per-worker 512 MiB address-space, 5 CPU-second and 64-descriptor
limits are inherited by each renderer process; pages render sequentially. The
10-second wall deadline covers the whole worker including its children. Each
rendered PNG has an 8 MiB file-size limit, bounding three temporary outputs to
24 MiB, plus one transient diagnostics file capped at 8 MiB, while the JSON metadata keeps the 256 KiB stdout limit. Both parsing and
rendering share the existing two-worker admission limit. These are per-process
limits, not a 512 MiB aggregate cgroup claim.

Rendering receives only the qualified original in a private temporary directory.
The bwrap carrier makes just that directory writable; runtime/wheel/worker mounts
stay readonly. Cancellation or deadline kills the carrier, whose PID namespace
and `--die-with-parent` also stop renderer children. Successful pages are committed
through native `saveImage` before returning real tool-result image blocks. The
same module returns numeric status 1/2/3 for success/partial/all-page failure,
with per-page `page-unreadable` or `resource-limit`; nonfatal Poppler diagnostics
return page status 2 and `renderer-warning` alongside the recoverable image, rather
than silently treating a damaged page as pristine; a worker deadline is an overall
`resource-limit`. Native image normalization and provider request budgets still
apply. Visual reading does not promise perfect tables or complex-layout recovery.

See `tests/fixtures/pdf/README.md` for deterministic scan/mixed/chart samples and
`work/implementation/evidence/18-pdf-vision/flash-smoke.md` for the official Flash
cloud handoff. Local tests use the real provider and an external HTTP model
double; no official cloud call is claimed by those tests.
