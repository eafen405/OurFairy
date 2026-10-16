# PDF text dependency

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

`src/pdf.mjs` bounds concurrent parsers to two, each with 512 MiB address space,
5 CPU seconds, 10 wall-clock seconds, 64 file descriptors and 256 KiB stdout.
The existing upload limit is 32 MiB. Documents are limited to 500 pages; each call
reads at most five selected pages and returns at most 4,000 characters per page.
`pdf_info` reads only a 1,000-character first-page sample and the page count.
The library's own decompression limits also report `resource-limit`.

These are product demo budgets, not a promise of perfect complex-layout or OCR
extraction. Encrypted PDFs are rejected even when an empty password could open
them. No-text pages request image reading; rendering is the separate T18 ticket.
