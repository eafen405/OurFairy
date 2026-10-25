# UI-218 / #218 — 消息一键复制（含流式进行中的行）

Android worktree `218-copy-message`, branch `ticket/218-copy-message`, based on
`integration/ui-215-218`. Commits: test `8a45bdaede`, behavior (this commit). No database or wire change.

## 改了什么

`android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteTranscript.kt`:

- Long-pressing any transcript row now opens the existing long-press interaction as a small
  `DropdownMenu` instead of jumping straight to the full-text dialog. `查看全文` remains the same
  `AlertDialog`, with the same body and `关闭` action.
- The menu offers `复制` only when the row has body text; a settled message also offers `查看全文`.
  The streaming row (`message == null`) gets `复制` only, so the line that previously had no
  long-press entry now has one. A streaming row that has not produced text yet has no long-press
  menu at all, instead of copying an empty string and reporting success.
- Copy source is the row body: raw `message.text` for settled messages and the current
  `attemptText` for the streaming row. The click reads a `rememberUpdatedState(rows)` value, so if
  text arrives while the menu is open, `复制` takes what has arrived by the moment it is tapped.
- Feedback is a `Toast` with `已复制`, shown after the clipboard write completes (same coroutine);
  the write follows the repo pattern (`LocalClipboard` + `ClipEntry(ClipData.newPlainText(...))`).
- No panel, bubble, color, font, or layout art changed. The long-press accessibility label follows
  the row: `查看全文或复制` for settled messages, `复制` for a streaming row with text.

## 测试

New Robolectric Compose test:
`android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteTranscriptCopyTest.kt`.

It renders `RemoteTranscript` directly, long-presses a row with `performTouchInput { longClick() }`,
reads the system `ClipboardManager` primary clip and `ShadowToast.getTextOfLatestToast()`. Six
cases:

1. settled Fairy message copies its raw body and shows `已复制`;
2. user message copies its raw body and shows `已复制`;
3. streaming row exposes `复制` (and no `查看全文`) and copies the arrived text;
4. with the streaming menu already open, text that arrives before the tap is the text copied;
5. a streaming row with no text yet offers no `复制`;
6. settled `查看全文` still opens the existing dialog and `关闭` dismisses it.

Red before the behavior change, green after. Final run (also covering the adjacent classes):

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest" \
  --tests "me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest" \
  --tests "me.rerere.rikkahub.ui.identity.RemoteTranscriptCopyTest" --console=plain
```

`BUILD SUCCESSFUL`; JUnit XML: `RemoteTranscriptCopyTest` 6 tests, 0 failures/errors/skips;
`RemoteTranscriptViewportTest` 2 tests, 0 failures/errors/skips; `FairyPagesTest` 7 tests, 0
failures/errors/skips.

`RemoteTranscriptToolCallTest` was named in the ticket handoff but does not exist on this base
(`c39c83d8c1`); it lives on the unmerged `ticket/213-tool-calls` branch, so it could not be run here.

## 未执行

- 真机验收：没有连接设备或模拟器，未在设备上确认长按菜单、Toast 与剪贴板行为。
- 未 push；本票分支未改证据索引，集成分支由 Lead 登记（见 `ui-218` 条目），未触碰主检出或其他 worktree。
