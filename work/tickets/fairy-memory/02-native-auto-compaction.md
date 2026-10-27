## Parent

#240

## What to build

在真实 OurFairy profile 中启用 dsh 原生自动压缩，默认 500K 触发并保留 16K 近期原文，使长会话能够继续，而不是持续累积模型上下文。

## Acceptance criteria

- [ ] 真实装配挂载 token 计量、自动压缩、工具结果裁剪和图片 offload，且不引入命令压缩的 Typert 面。
- [ ] 默认绝对阈值为 500000 token，压缩保留预算为 16000 token。
- [ ] 越过阈值的会话完成压缩后继续回复，保留工具配对和近期原文。
- [ ] 工具结果裁剪、图片 offload、溢出恢复和冷恢复按原生行为通过验收。
- [ ] 会话压缩不会写入长期记忆。

## Blocked by

- #241
