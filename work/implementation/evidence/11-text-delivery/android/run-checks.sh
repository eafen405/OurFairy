#!/bin/bash
set -u
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-stage-review/bin:$PATH
cd /home/eafen405/projects/rikkahub/.worktrees/11-text-delivery || exit 1
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatRecoveryTest' '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel --console=plain
code=$?
echo "CHECK_EXIT=$code"
exit "$code"
