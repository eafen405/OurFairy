# One-shot speech input (T16)

Fairybot's authenticated PCM WAV proxy is adapted as a Cordis product module.
Identity and Host/Origin validation are shared with the existing product routes.
The module owns temporary audio and the provider request only; it has no session
writer, database table, attachment archive, Agent or TTS dependency.

- `GET /speech`, bearer credential → `{ok:true,available,maxDurationMs,maxAudioBytes}`.
- `POST /speech/transcriptions`, bearer credential and `audio/wav` body →
  `{ok:true,text}`. The accepted recording is mono PCM16, 16kHz WAV with the
  ordinary 44-byte header produced by the Android recorder.
- Refusals use the established `{ok:false,error:{code,message}}` shape:
  `speech/unauthorized` (401), `speech/unavailable` (503), `speech/busy` (429),
  `speech/invalid-audio` (400 or 415), `speech/too-large` (413),
  `speech/no-match` (422), `speech/failed` (502), `speech/timeout` (504).

`VOICE_API_KEY` is read only on the backend, separately from DeepSeek credentials.
`backend/v1-bundle/cordis.patch.yml` maps the deployment variables
`OURFAIRY_ASR_MODEL`, `OURFAIRY_ASR_ENDPOINT`, `OURFAIRY_ASR_MAX_DURATION_MS`,
`OURFAIRY_ASR_MAX_AUDIO_BYTES`, `OURFAIRY_ASR_TIMEOUT_MS`,
`OURFAIRY_ASR_MAX_GLOBAL_IN_FLIGHT` and `OURFAIRY_ASR_MAX_USER_IN_FLIGHT`.
Current defaults are a starting deployment budget, not a permanent product
limit or proof that a SiliconFlow account accepts this recording container.

Disconnecting this one-shot HTTP exchange aborts its cloud request and releases
its concurrent-request budget. It does not stop a previously accepted chat turn.
