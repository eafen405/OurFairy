#!/bin/bash
set -u
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-stage-review/bin:$PATH
cd /home/eafen405/projects/rikkahub/.worktrees/09-attachments || exit 1
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.*' :app:assembleDebug '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel --console=plain
code=$?
echo "CHECK_EXIT=$code"
exit "$code"
