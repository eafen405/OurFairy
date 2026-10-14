#!/bin/bash
# OurFairy Android recon build (ticket #26 prerequisite investigation).
#
# Runs :app:assembleDebug against the rikkahub checkout with the isolated
# environment this machine needs:
#   * ANDROID_HOME explicit (SDK lives outside the repo)
#   * pnpm shim so the web module's preBuild finds corepack pnpm@11.28.5
#   * JVM proxy args: Java/Gradle ignore http_proxy/https_proxy env vars, and
#     direct repository access measured 3-5x slower than the local proxy.
#   * --max-workers/--parallel override the user-global gradle.properties, which
#     pins workers.max=1 and parallel=false.
set -u
EV=/home/eafen405/projects/OurFairy/work/implementation/evidence/00-android-recon
LOG="$EV/build-02-assembleDebug.log"

export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-recon-bin:$PATH
cd /home/eafen405/projects/rikkahub || exit 1

{
  echo "=== START $(date -Is) ==="
  echo "cmd: ./gradlew :app:assembleDebug -Dorg.gradle.jvmargs=...proxy... --max-workers=8 --parallel"
} >> "$LOG"

/usr/bin/time -v ./gradlew :app:assembleDebug \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]" \
  --max-workers=8 --parallel --console=plain >> "$LOG" 2>&1
code=$?
echo "EXIT=$code END $(date -Is)" >> "$LOG"
exit $code
