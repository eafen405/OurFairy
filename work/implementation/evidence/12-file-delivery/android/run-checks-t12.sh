#!/bin/bash
set -u
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-stage-review/bin:$PATH
cd /home/eafen405/projects/rikkahub/.worktrees/12-file-delivery || exit 1
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentApiTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel --console=plain
code=$?
echo "CHECK_EXIT=$code"
exit "$code"
