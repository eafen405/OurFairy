# One-shot speech input

Fairybot's authenticated PCM WAV proxy, adapted as a Cordis product module.
Identity and Host/Origin validation come from the shared product routes. The
module owns temporary audio and the provider request only.

- `GET /speech`, bearer credential → `{ok:true,available,maxDurationMs,maxAudioBytes}`.
- `POST /speech/transcriptions`, bearer credential and `audio/wav` body →
  `{ok:true,text}`. The accepted recording is mono PCM16, 16kHz WAV with the
  ordinary 44-byte header produced by the Android recorder.
- Refusals use the established `{ok:false,error:{code,message}}` shape:
  `speech/unauthorized` (401), `speech/unavailable` (503), `speech/busy` (429),
  `speech/invalid-audio` (400 or 415), `speech/too-large` (413),
  `speech/no-match` (422), `speech/failed` (502), `speech/timeout` (504).

The credential reference (`apiKeyEnv`, default `VOICE_API_KEY`) is resolved on the
backend only, through the native credential seam, separately from DeepSeek
credentials. The connection settings live in the `speech` profile row and are
edited through the administrator gateway (`/gateway/asr`); the recording routes
re-read the row per request and expose only availability and the recording
budget.
`backend/v1-bundle/cordis.patch.yml` maps the deployment variables
`OURFAIRY_ASR_MODEL`, `OURFAIRY_ASR_ENDPOINT`, `OURFAIRY_ASR_MAX_DURATION_MS`,
`OURFAIRY_ASR_MAX_AUDIO_BYTES`, `OURFAIRY_ASR_TIMEOUT_MS`,
`OURFAIRY_ASR_MAX_GLOBAL_IN_FLIGHT` and `OURFAIRY_ASR_MAX_USER_IN_FLIGHT`.
Disconnecting the exchange aborts its cloud request and releases its
concurrent-request budget.
