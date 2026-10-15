# #24–#26 Spec axis notes

Read scope.md completely; pinned committed HEADs verified: OurFairy de2ded1afa13a6a42816fbdd3682bdcc7be10760; dsh 2f084be06e75cd56c2a7ac9a31e155db9f4deee0; rikkahub ffc88e306b0f55cf52c3592ac93151be0492b864. Diff/commit commands are exactly those in scope.md. Read root project rules, relevant dsh package/client rules, rikkahub rules and GLOSSARY.md. No repository files changed. dsh uncommitted test/docs changes were not used as evidence.

## 1. Restore navigation

Requirement: issue-26.md:25, “一 APK 在同一导航组织中按身份进入可用区域”.

Code: RouteActivity.kt:297–312 initializes session.user=null on fresh process and remembers the back stack with SignIn. The asynchronous restore at :304 can establish user/token but only increments revision at :305. The recomputed startScreen does not replace the remembered stack. IdentityAccessPolicy.kt:91–93 rejects SignIn for signed-in identities. RouteActivity.kt:349–350 then renders IdentityNotReadyPage; IdentityPages.kt:443 only offers recovery button while signed out. Thus a returning authenticated user is stranded before Account.

Verified navigation dependency itself, not just assumed from function name: extracted cached navigation3-runtime-android 1.2.0 AAR classes.jar to /tmp/ourfairy-stage-review/navigation3-runtime-classes.jar, inspected with javap. RememberNavBackStackKt__RememberNavBackStack_androidKt uses rememberSerializable with an empty inputs array (bytecode offsets 23–27 and 158). Its initialization lambda captures elements, but the stack state is retained with no element-based reset.

Trigger: sign in once, terminate app process, cold launch with valid stored credential and backend available. Expected Account, actual NotReady after restore. This is a static control-flow finding; no device/emulator was available/run. Recreating Activity with restored saved Account can mask it, so use a genuinely fresh process/task launch.

Smallest fix: one restore-in-progress flag to avoid building stack until restored, or explicitly route to Account/SignIn after restoration with existing generation protection. No new navigation mechanism needed.

## 2. Fixed emulator endpoint

Requirement: issue-26.md:23, “完成邀请生成、注册、登录和会话凭据验证的真实后端请求路径及 Android UI”. Parent spec describes Android APK and vivo S50 target, docs/specs/ourfairy-v1.md:207, :229.

IdentityModule.kt:20 hardcodes http://10.0.2.2:3080; :36 injects it directly into the only IdentityApi. Search of tracked source found no alternate IDENTITY_BASE_URL, URL override, BuildConfig property, or endpoint-setting input. 10.0.2.2 is Android emulator host alias, not a physical phone's backend endpoint. Code's own comment acknowledges phone builds must change it, but no deployment knob implements that. Manifest allows cleartext; that is not the failure.

Trigger: build/install current APK on physical vivo with a backend deployed at a reachable LAN IP/domain and configured Host fence. Every identity request still goes to 10.0.2.2 and fails; backend binding/trusted-host changes cannot change an APK URL. Build-time Gradle property -> BuildConfig string is enough; no new UI necessary. No actual phone verification performed.

## 3. Export consumers miss owner/delivery attachments

Requirements: issue-25.md:23 “新记录往返与重启读取保留全部必要字段”; :25 “同步必要的 surface、消息、查询及协议消费者”.

archive.ts serializeSessionLog constructs a physical current-generation header at :121–132 but enumerates only the previous fields and omits owner. collectEventAttachmentRefs at :248–272 has no delivery/message case and silently returns, even though the event embeds the normal FileBlock/ImageBlock. This is an existing consumer made incomplete by this diff's new authoritative fields/event, not a request to open the later product export/delivery routes.

Executed source-plane reproduction against the pinned clean archive.ts via node --import tsx/esm --input-type=module from dsh root. Called public serializeSessionLog with owner user:2 and public sessionLogZipEntries with includeDescendants=false and deterministic attachment stream provider. No persistence/network is mocked in the first function; the second's existing attachment IO seam lets us count whether an attachment is read.

Input header: {version:4,id:'recipient',createdAt:1,isSeeded:false,delegationDepth:0,owner:'user:2'}.
Input delivery event: seq 0, time 1, surfaceOp append, deliveryId d1, origin sender/user:1, assistant message m1 with delivered-message source d1/sender and content [{type:'file',attachment:{attachmentId:'abcdef',name:'note.txt',bytes:3}}], same ref in attachments.

Observed JSON outputs:

```json
{"type":"delivery/message","exportedOwner":null,"paths":["session.v4.jsonl"],"fileReads":0}
{"type":"assistant/message","exportedOwner":null,"paths":["session.v4.jsonl","files/ab/abcdef/note.txt"],"fileReads":1}
```

The second is a branch-control probe using exactly the same file content, not a valid complete assistant model event (that would additionally need turn/step/stream). It demonstrates existing attachment collection works and the new event discriminator is the missed path. The delivery input itself matches the newly defined event representation. Reproduction ran EXIT=0. Smallest fix: retain owner in export header and add delivery/message attachment scanning alongside current embedded-message cases, plus regression test for new event.

## Other inspected contracts / limits

Checked identity store registration transaction, seed, opaque token hashing/expiry/revocation; identity HTTP routes outside /api; dsh admitted Peer handoff into HTTP/RPC handlers and principal revocation; owner propagation into creation/fork/persistence; delivery surface projection and DeepSeek serialization; Android generation/stale callback and credential store lifecycle. No additional high-confidence requirement defect reported. No scope-creep finding. New remote conversation, per-session authorization and real delivery routing belong to #27+ and were excluded. Existing dsh UI consumers also have no delivery event renderer, but since product currently does not expose that UI and the narrow format ticket is a prerequisite, this was not promoted to a separate finding.
