#!/bin/bash
# OurFairy ticket #26 Android build: :app:assembleDebug on the rikkahub
# ticket/03-identity worktree, with the environment this machine needs
# (measured in work/implementation/evidence/00-android-recon).
#
#   * ANDROID_HOME explicit (the SDK lives outside the repo)
#   * pnpm shim so the web module's preBuild finds corepack pnpm@11.28.5
#   * JVM proxy args: Java/Gradle ignore http_proxy/https_proxy env vars
#   * --max-workers/--parallel override the user-global gradle.properties
#
# Run detached: setsid nohup <this script> > <log> 2>&1 &
set -u
EV=/home/eafen405/projects/OurFairy/.worktrees/03-identity/work/implementation/evidence/03-identity
LOG="$EV/android-build-$1.log"

export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-recon-bin:$PATH
cd /home/eafen405/projects/rikkahub/.worktrees/03-identity || exit 1

{
  echo "=== START $(date -Is) ==="
  echo "cmd: ./gradlew :app:assembleDebug (proxy jvmargs, --max-workers=8 --parallel)"
  echo "head: $(git rev-parse HEAD)"
} >> "$LOG"

./gradlew :app:assembleDebug \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]" \
  --max-workers=8 --parallel --console=plain >> "$LOG" 2>&1
code=$?
echo "EXIT=$code END $(date -Is)" >> "$LOG"
ls -la app/build/outputs/apk/debug/ >> "$LOG" 2>&1
exit $code
