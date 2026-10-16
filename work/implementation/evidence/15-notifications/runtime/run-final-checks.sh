#!/usr/bin/env bash
set -euo pipefail
cd /home/eafen405/projects/rikkahub/.worktrees/15-notifications
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-t15-bin:$PATH
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.*' :app:assembleDebug '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel --console=plain
