#!/usr/bin/env bash
set -euo pipefail
cd /home/eafen405/projects/rikkahub/.worktrees/15-notifications
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-t15-bin:$PATH
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteNotificationStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteReceiveStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteActivityStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatRecoveryTest' '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel --console=plain
