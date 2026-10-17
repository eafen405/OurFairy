# Android FGS choice evidence

Primary AOSP source: https://github.com/aosp-mirror/platform_frameworks_base/blob/acba22d717114115833575b7fd98f13562fc8a48/core/java/android/content/pm/ServiceInfo.java

Fetched with `gh api repos/aosp-mirror/platform_frameworks_base/contents/core/java/android/content/pm/ServiceInfo.java?ref=main --jq.content` and base64-decoded; last-file-change commit from GitHub API is `acba22d717114115833575b7fd98f13562fc8a48`. Exact fetched file archived here. Official developer.android.com service-types webpage timed out both direct and via existing local proxy; no webpage verification claimed.

- Source lines 141–173: dataSync is data upload/download/transfer and describes Android 15 six-hour timeout.
- Lines 385–393: remoteMessaging hosts a local server relaying messages across devices; OurFairy is a remote authenticated session consumer, so this is not its purpose.
- Lines 546–592: specialUse is for uses outside the other service types unsuitable for JobInfo APIs; must declare subtype, and use may be restricted.

T15 uses a separate, explicit user-enabled specialUse service with manifest subtype describing persistent live authenticated conversation reception in a self-distributed APK. A JobInfo task does not maintain the user-requested live SSE connection. Source supports type selection; it does not prove the vivo OS will allow it or guarantee a live socket under Doze. Startup rejection is exposed; teardown never stops remote Agent/jobs. No alarms, boot receiver or restart promise added. Physical-device behavior remains final ticket #45.
