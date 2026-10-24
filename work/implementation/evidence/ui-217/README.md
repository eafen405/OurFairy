# UI-217 / #217 — 启动图标替换为 Fairy 徽记

Android worktree `217-fairy-icon`, branch `ticket/217-fairy-icon`, based on
`integration/ui-215-218` at `c39c83d8c1`. No database or wire change; resources only.

## 改了什么

Replaced all 20 launcher PNGs in `android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/`:

| layer | sizes | what it contains |
| --- | --- | --- |
| `ic_launcher.png` | 48 / 72 / 96 / 144 / 192 | legacy full-bleed: navy radial background + emblem |
| `ic_launcher_background.png` | 108 / 162 / 216 / 324 / 432 | radial gradient `#0D2257` center → `#050A18` edge |
| `ic_launcher_foreground.png` | 108 / 162 / 216 / 324 / 432 | transparent field, Fairy emblem centered at 66/108 of the canvas (outer ring on the 66dp safe zone) |
| `ic_launcher_monochrome.png` | 108 / 162 / 216 / 324 / 432 | neutral alpha silhouette for themed icons: outer ring, disc-with-bumps, eye-ring cut-out, pupil, tail-dot glint cut-out |

The geometry is the emblem in `android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyEmblem.kt`
(`drawFairyEmblem`/`discPath`): white outer ring (r 22.3/48, stroke 3.4/48), blue vertical gradient
ring (`#3D8AE6` top → `#1A35D6` bottom, centerline 18.1/48, stroke 5/48), black disc (r 15.6/48) with
four compass bumps (tip 19/48, half-base 3.2/48), white eye ring (centerline 10.3/48, stroke 4.4/48),
pupil gradient `#0A1830` → `#000`, and the white tail dot (r 3.4/48 at 6.1/48 on the lower-right 45°
diagonal). `mipmap-anydpi-v26/ic_launcher.xml` and `AndroidManifest.xml` are unchanged: the adaptive
icon keeps referencing the same four resource names.

Note on the disc outline: `discPath` closes the rim with a `270 − 2β` sweep whose end does not meet
the start, so the literal path relies on its fill to close across the disc. The icon uses the
symmetric `90 − 2β` completion that the same code comment describes (four right-angled compass tips).
The in-app drawing was not changed — this ticket covers launcher resources only.

## 生成与校验

Sources are in this directory: `generate_icons.py` (writes the four SVGs and screenshots every size
with headless Chromium), `verify_icons.py` (stdlib PNG checks), and the four 108-unit SVGs.

```
python3 work/implementation/evidence/ui-217/generate_icons.py \
  --res /home/eafen405/.cache/ourfairy-icons/stage
python3 work/implementation/evidence/ui-217/verify_icons.py \
  --res /home/eafen405/.cache/ourfairy-icons/stage
```

Chromium needs `--headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1
--virtual-time-budget=10000 --window-size=W,H`, plus `--default-background-color=00000000` for the
transparent layers. A dedicated `--user-data-dir` made 108px captures paint blank in Chromium 155, so
the generator runs without a profile. Each size is screenshotted at its target resolution; nothing is
resampled afterwards.

`verify_icons.py` checks all 20 files: exact size, opaque legacy/background, transparent corners and
field for foreground/monochrome, navy gradient center/edge, white outer ring, blue ring, black disc,
neutral monochrome channels, and the eye-ring/tail-dot cut-outs. Result: **all icon checks passed**
(20/20). Pixel samplers use the diagonals because the four compass bumps cover the 0/90/180/270°
radii. The 48px legacy icon and the 432px foreground were also viewed directly and remain legible.

Build and package check:

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:assembleDebug --console=plain
```

`BUILD SUCCESSFUL in 50s`. The debug APK (`app/build/outputs/apk/debug/app-*-debug.apk`) contains
`res/mipmap-{m,h,xh,xxh,xxxh}dpi-v4/ic_launcher{,_background,_foreground,_monochrome}.png` for all
five densities; the extracted xxxhdpi `ic_launcher.png` sha256 equals the source file's
(`f23de7e246a2bcaa…`).

Debug builds overlay a `DEBUG` badge from `android/app/src/debug/res/…` (pre-existing snapshot
behaviour). It layers on top of `@mipmap/ic_launcher_foreground`, so it does not hide the new art,
but a debug installation's desktop icon is not a clean view of the release icon; release has no such
override.

## 未执行

- Real-device launcher desktop and recents were not checked: no device or emulator is connected.
- The release APK was not rebuilt in this ticket; resource packaging was verified on the debug APK.
- Themed/monochrome appearance was verified only by alpha/colour checks and direct PNG review, not on
  a device with themed icons enabled.
- Not pushed; evidence index untouched; main checkout and other worktrees untouched.
