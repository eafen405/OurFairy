#!/usr/bin/env bash
set -euo pipefail
cd /home/eafen405/projects/rikkahub/.worktrees/13-jobs
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteJobApiTest' --tests 'me.rerere.rikkahub.data.remote.RemoteJobStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatRecoveryTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' :app:assembleDebug '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel --console=plain
