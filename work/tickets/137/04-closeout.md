> 发布权威：[#158](https://github.com/eafen405/OurFairy/issues/158)。本文件是工作副本。

## Parent

[#137 启动器拆分：组合层独立成零 spawn 模块，并修正 doctor 的错误契约](https://github.com/eafen405/OurFairy/issues/137)

## What to build

在 01–03 合并后的集成分支上收口：跑全量门禁，登记证据索引，复核本次增量里的每一条「已被保证 / 由 X 派生」声称，
并如实记录未执行项。

## Acceptance criteria

- [ ] 在合并后的集成分支上跑 `npm test` 与 `npm run combo:verify`，命令与结果入库
- [ ] `work/implementation/evidence/137-launcher-split/README.md` 作为该 spec 的证据入口，登记 01–03 的逐票证据
- [ ] 更新 `work/implementation/evidence/README.md` 索引
- [ ] 逐条复核本次增量的可执行声称：每条「A 与 B 不能不一致」「X 已被检查/保证」「清单由 Y 派生」都指向会因它失效而失败的具体命令或测试；答不出的删除该声称
- [ ] 记录改动范围与未完成项（例如零 spawn 没有行为测试、只按模块导入面记录）
- [ ] 证据 README 记录「启动器 import 无副作用」由哪条断言固定
- [ ] 未完成项如实记录

## Blocked by

- 01
- 02
- 03
