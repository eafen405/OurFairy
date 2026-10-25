# UI-215 / #215 — 聊天面板留白

Android worktree `215-chat-padding`, branch `ticket/215-chat-padding`, based on
`integration/ui-215-218` at `c39c83d8c185c5b941c1cc1fbb91695d226778bc`.
Commits: test `c7e3b0fef5`, spacing `d3421dd61f`, evidence (this commit). No database or wire change.

## 改了什么

Only spacing, in two files:

- `RemoteChatPanel.kt`: root `Column` horizontal padding `12.dp` → `20.dp`.
- `FairyDialogPanel.kt`: a new `FairyMessagePaddingH = 14.dp` for the chat transcript's Fairy panel.
  `FairyDialogPaddingH` stays at `6.dp`, so the `查看全文` dialog keeps its existing inset.
  `FairyDialogPaddingV`, `FairyDialogShape`, `fairyDialogPanel` drawing, colors, typography and the
  user bubble's shape/background/border are untouched.

Composed insets at 360dp width:

| body | before | after |
| --- | --- | --- |
| Fairy body (screen edge → text) | 12 + 6 = 18dp | 20 + 14 = **34dp** each side |
| user body (text → right edge) | 12 + 12 = 24dp | 20 + 12 = **32dp** |

The user text inset differs from the Fairy body because the user bubble keeps its existing 12dp
inner padding; 32dp still clears the 30dp requirement. I targeted roughly 32–36dp (the issue itself
gives no number), symmetric for the Fairy body; both values land inside that band without changing
the panel or bubble geometry. The root padding also insets the header/composer, which is part of the
same chat body; nothing outside `RemoteChatPanel` moved.

Review follow-up: the first cut raised `FairyDialogPaddingH` itself, which also widened the
`查看全文` dialog; the final code splits the constant so only the transcript body changes.

## 测试

The new test is in `android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt`:
`chat body keeps an even horizontal margin from the screen edge`, with a method-level
`@Config(qualifiers = "zh-rCN-w360dp-h800dp")`. It reuses that class's existing fake
`SessionBackend`/`RemoteChatBackend`/`ChatSyncStore` conversation harness instead of rendering a bare
`RemoteTranscript`, because the screen-edge 12dp/20dp layer lives in `RemoteChatPanel`; a
transcript-only composition could not measure the inset from the screen edge.

It renders one long Fairy message (role 2) and one long user message (role 1) that wrap, then
measures the unmerged text nodes with `getBoundsInRoot()`/`boundsInRoot` and asserts, at 360dp:
Fairy left ≥ 30dp, Fairy right ≥ 30dp, user right ≥ 30dp, and `|Fairy left − Fairy right| ≤ 1dp`.
These are requirement assertions, not the chosen constants: 30dp is the floor that makes the margin
obvious; the measured 34/32dp are the current design values. The 34/32 numbers are recorded by the
red/green runs below, not asserted exactly.

Red run before the change, on commit `c7e3b0fef5`:

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest" --console=plain
```

`FairyPagesTest > chat body keeps an even horizontal margin from the screen edge FAILED` with
`java.lang.AssertionError: Fairy 正文左侧留白 18.0 dp，应不小于 30 dp`; 7 tests, 1 failed (the six
pre-existing page tests passed).

Green run after the change, and again after merging `integration/ui-215-218` (`Already up to date`),
forced with `--rerun` so the post-merge execution was real:

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest" \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest" --rerun --console=plain
```

`BUILD SUCCESSFUL in 32s`; FairyPagesTest **7 tests, 0 failures, 0 errors, 0 skipped**;
RemoteTranscriptViewportTest **2 tests, 0 failures, 0 errors, 0 skipped**.

The pre-commit hook ran the full repo gate on both commits: `npm test` **285 pass / 0 fail** and
`npm run combo:verify` ok. The first attempt at the spacing commit hit an unrelated speech timing
flake (`speech proxy … cancel releases this one-shot ASR budget`: 429 !== 200). That file passed in
isolation (`node --test tests/speech.test.mjs`: 2/2) and the retried full gate passed 285/285; no
product code was changed for it. Its cause is not established.

A temporary, non-committed instrumentation of the same test measured
`fairyLeft=34.0 fairyRight=34.0 userRight=32.0 rootWidthDp=360.0` at the fixed commit.

## 截图

[screens/conversation-padding-360dp.png](screens/conversation-padding-360dp.png) — Robolectric
`captureToImage()` of the conversation page at `zh-rCN-w360dp-h800dp`, written through the existing
`FAIRY_UI_SCREENSHOTS` hook:

```
FAIRY_UI_SCREENSHOTS=.../work/implementation/evidence/ui-215/screens \
  (same gradle command as above, before `--rerun` was added)
```

It is a JVM/Robolectric rendering, not a real-device frame; other screenshots from that env-guarded
run were noise and were removed.

## 未执行

- 真机验收（issue 验收项第 1 条）未执行：没有连接设备或模拟器，无法给出真实观感结论。
- 横屏与其他屏宽未测：新用例只覆盖 360dp 竖屏；同文件原有页面用例在 `zh-rCN-w411dp-h891dp`
  下随本次 green run 一起通过，但没有新增横屏断言。
- 未 push；本票分支未改证据索引，集成分支由 Lead 登记（见 `ui-215` 条目），未触碰主检出或其他 worktree。
