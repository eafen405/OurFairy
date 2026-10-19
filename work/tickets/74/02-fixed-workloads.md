## Parent

[#74 Android 长回复呈现性能：设备基线、热点定位与受控优化](https://github.com/eafen405/OurFairy/issues/74)

## What to build

五档固定负载只有一份权威参数，并且由生产接收状态与会话呈现入口驱动，而不是绕开接收路径直接喂消息。长历史、长单条、格式样本、持续流式、重连突发各自的条数、正文字符数、片段大小与间隔写明在入口与证据里；改动参数即产生新基线。

## Acceptance criteria

- [ ] 五档参数集中在一处声明，并出现在每次测量结果与文档中
- [ ] 测量经过生产接收状态（`RemoteChatState`）与其快照，再进入会话呈现入口；不新建第二套会话聚合
- [ ] 参数与 #42 证据记录的一致性或换版理由写明
- [ ] 既有呈现与阅读位置行为测试保持通过

## Blocked by

<<<<<<< HEAD
- [测量入口入库并可干净构建](https://github.com/eafen405/OurFairy/issues/75)
=======
- #74 的测量入口入库票
>>>>>>> integration/ourfairy-v1
