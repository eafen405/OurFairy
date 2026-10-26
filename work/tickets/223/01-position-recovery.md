> 发布权威：[#224](https://github.com/eafen405/OurFairy/issues/224)。本文件是工作副本。

## Parent

[#223 消息呈现顺序：跨页恢复与稳定位置](https://github.com/eafen405/OurFairy/issues/223)

## Blocked by

无。

## Scope

按父规格实施唯一切片：后端读时派生数字 `position`，Android 使用它恢复消息呈现顺序，保留现有 `seq >=` 内容合并与恢复保障。

## Implementation Constraints

- 只修改父规格列出的后端/Android 契约、实现、术语与测试；不改 dsh fork、数据库或持久 state 形状，`stateVersion` 保持 4。
- `position` 必填且仅用于排列；缺失或冲突响亮失败，无 seq/messageId 兜底。
- 实现留在现有 `RemoteChatState` 私有合并/排序函数附近，不新建恢复 module。
- 后端测试穿过 projection fold/HTTP 契约，Android 测试穿过 `RemoteChatState.bind/snapshot`；不新增测试专用生产接口。
- 先写失败回归，再实现；不修改或删除既有约束制造通过。

## Acceptance

父规格全部确定性场景与相关测试。实施代理完成票分支 TDD、相关测试、合并集成分支前的同步；主线负责最终全量门禁、真实服务三步验收、两轴评审与证据收口。

## Probe

`probe/message-ordering-20261025` @ `ade0239c3f`：后端 `[u-first,u-second,a1]` 被当前 Android 排成 `[u-second,a1,u-first]`；合法旧页未覆盖较新 live。
