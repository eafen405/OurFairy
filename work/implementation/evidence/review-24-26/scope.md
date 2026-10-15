## ourfairy
Repository: /home/eafen405/projects/OurFairy
Diff: git -C /home/eafen405/projects/OurFairy diff c3d45c60edd778479f84f08cdc8bff992d47148d...de2ded1afa13a6a42816fbdd3682bdcc7be10760
Saved diff: /tmp/ourfairy-stage-review/ourfairy.diff
Commits:
de2ded1 Merge branch 'ticket/01-baseline' into integration/ourfairy-v1
568a069 fix(baseline): prove the product composition serves, then prove it let go
3368dea Merge remote-tracking branch 'origin/integration/ourfairy-v1' into ticket/01-baseline
a4ee4dc fix(baseline): stop the suite from fighting the harness for the product port
a7b2db5 Merge branch 'ticket/03-identity' into integration/ourfairy-v1
7d6c3b8 chore(combo): pin rikkahub to the commit that lands the identity entry
160f68d docs(evidence): ticket #26 identity entry, measured
31f58e1 Merge remote-tracking branch 'origin/integration/ourfairy-v1' into ticket/01-baseline
81dfb33 fix(baseline): keep expectations in tests, isolate the tool cache, and read pins from combo.json
76f8cde Merge branch 'ticket/03-identity' into integration/ourfairy-v1
3f2a45b docs(evidence): ticket #25 ownership and delivery, verified on the merged tip
a02bfde fix(identity): serve bodyless authenticated requests and lock concurrency by arithmetic
2fd96a2 feat(identity): persist Phaethon, invites, and sessions behind real request paths
50d70e0 docs: client access and authentication seam map (verified against d743267388)
734e071 Merge branch 'ticket/01-baseline' into integration/ourfairy-v1
5ceb0ce docs(evidence): rikkahub builds a debug APK locally (3 artifacts, 6m57s) with the proxy/JVM prerequisites recorded
e20646e feat(backend): boot the v1 composition with real liveness and model evidence
83d72dc Merge branch 'integration/ourfairy-v1' into ticket/01-baseline
4232af4 docs: define code-review checkpoints instead of one final review
328b2ca Merge branch 'integration/ourfairy-v1' into ticket/01-baseline
635340e docs: record measured Android build pitfalls (proxy, gradle dist, hostile user gradle.properties, android-37.2, google-services stub)
b20a23e docs: dsh ownership and delivery seam map (verified against d743267388)
f43aec5 test(backend): add the test-only baseline liveness probe and its overlay
0381f07 feat(backend): add the explicit v1 bundle without inheriting dsh-base
cacb47f feat(combo): lock the v1 version combination and verify it against real checkouts
4bad657 test(baseline): failing acceptance tests for real profile boot, exclusions, and keyless startup
9533063 chore: add implementation conventions and ignore worktree/vendor dirs
1ee19f1 docs: restore v1 readiness/contract/input and rikkahub architecture research to integration baseline

## dsh
Repository: /home/eafen405/projects/deepseek-harness
Diff: git -C /home/eafen405/projects/deepseek-harness diff d743267388641bc76f17c45ce8b4c231aed1d32c...2f084be06e75cd56c2a7ac9a31e155db9f4deee0
Saved diff: /tmp/ourfairy-stage-review/dsh.diff
Commits:
2f084be06e Merge branch 'ticket/25-session-format' into product/ourfairy-v1
0284c1d019 fix(session): narrow every consumer of the widened assistant message source
0d9ece10ac Merge branch 'ticket/03-identity' into product/ourfairy-v1
5a7615a128 fix(connection): make the principal Peer compile in the host project
b7986437a0 feat(session): deliver a peer Session's message as a first-class surface event
97060eb624 test(connection): cover principal revocation and authenticator removal
8c1633abef feat(connection): hand the admitted principal Peer to the request handlers
b08b9caf6b feat(connection): admit a registered second credential as its own principal Peer
3666873769 feat(session): durable session owner as a compatible header extension

## rikkahub
Repository: /home/eafen405/projects/rikkahub
Diff: git -C /home/eafen405/projects/rikkahub diff 0966502c4d65c1ee4b2a3e49a19703bb1978016c...ffc88e306b0f55cf52c3592ac93151be0492b864
Saved diff: /tmp/ourfairy-stage-review/rikkahub.diff
Commits:
ffc88e30 Merge branch 'ticket/03-identity' into product/ourfairy-v1
af65606d feat(identity): land on your identity and refuse everything this version does not deliver
0d238805 feat(identity): seal the session credential in the Android keystore
f1f23ddc feat(identity): sign in over real HTTP and gate the navigation by identity
