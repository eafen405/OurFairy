You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Task: create ONLY T18 PDF vision fixtures in /home/eafen405/projects/OurFairy/.worktrees/18-pdf-vision.
Read CODING_STANDARDS.md and tests/fixtures/pdf/generate.py, README.md. User authorizes mcode outside sandbox. Do not git commit or alter backend/tests/pdf.test.mjs. Other agent is editing runtime concurrently.
Allowed writes only tests/fixtures/pdf/generate-vision.py, scan.pdf, mixed.pdf, chart.pdf and tests/fixtures/pdf/README.md (append T18 section; preserve existing).
Use Python stdlib + vendored existing pypdf wheel; no installs/network libraries. Deterministic synthetic readable samples: scan.pdf one page with embedded raster visibly depicting a 3-bar chart (red,green,blue bars heights 40,80,120) with no text layer; chart.pdf one page with vector bars and Helvetica text title T18_CHART and known values 10,20,30; mixed.pdf 2 pages first ordinary text MIXED_TEXT_PAGE, second scan raster plus actual text caption MIXED_SCAN_CAPTION. Page size 400x400, readable at scale1600. Document human expected visual answers, text expectations and regenerate command. Could embed a simple zlib-compressed RGB image built as bytearray; do not rasterize using external renderer to create sample.
Run generator twice and compare hashes for determinism; validate page counts/text via existing pypdf and pdftoppm render actual samples. Report commands/results and changed files. Do not test integration or touch other files.
