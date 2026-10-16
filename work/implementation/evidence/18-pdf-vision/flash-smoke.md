# Official Flash PDF tool-result handoff

This ticket has **not** called the real official cloud. Tests use the selected
`deepseek-official/deepseek-flash` provider implementation with an external HTTP
model double. They verify actual Poppler pixels and official Messages image
serialization (user `tool_result`, JPEG base64 fallback), not cloud understanding.

To run at final integration against a backend configured with a real official
DeepSeek key and the selected official Flash route, sign in normally, retain its
bearer token in `OURFAIRY_TOKEN` (do not put the key/token in evidence), and run:

```sh
export OURFAIRY_URL=http://127.0.0.1:3080
node scripts/pdf-flash-smoke.mjs scan > /tmp/pdf-flash-scan.json
node scripts/pdf-flash-smoke.mjs mixed > /tmp/pdf-flash-mixed.json
node scripts/pdf-flash-smoke.mjs chart > /tmp/pdf-flash-chart.json
```

The script creates an owned session, proposes/chunks/completes a real upload,
asks for `pdf_info` then the one selected page through `pdf_render_pages`, waits
for the ordinary tool turn, and byte-compares the original downloaded through
the authenticated message selector. It never constructs or inserts model
history. An exit code of zero proves completion and unchanged original; it does
**not** automatically grade visual accuracy or prove the model obeyed tool use.

Inspect the real session tool results/provider evidence to confirm the requested
page rendered and the subsequent official request accepted its native image.
Expected answers from independent synthetic samples:

| Sample | Selected page | Visible expected content |
| --- | --- | --- |
| scan | 1 | Three red, green, blue bars, shortest to tallest in that order (1:2:3); no text layer. |
| mixed | 2 | Same three bars and `MIXED_SCAN_CAPTION`; page 1 remains unrendered. |
| chart | 1 | `T18_CHART`, red/green/blue values 10/20/30, increasing heights. |

Keep actual cloud model/API name, date, session/tool results, reply and any
refusal/error with final integration evidence. Do not claim perfect tables,
unread-page understanding, OCR, audio/video, device behavior or locked server
model weights from this smoke test.
