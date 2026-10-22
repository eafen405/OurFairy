# 07: 升级复核清单与收口

## Parent

[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)

## What to build

把前六张票建立的守卫写进升级复核入口，让升级者不必凭记忆检查；然后跑全量门禁并留下证据。

- `docs/architecture/dsh-ecosystem-boundary.md` 增加「原生语义漂移」一节：逐项写明上游变化、
  产品的处理方式（允许列表 / 原生入口 / 测试期对账 + 运行期显式未知或响亮失败），以及上游变化
  时会失败的具体测试标题。
- `backend/chat/README.md` 的「dsh 升级复核」补入任务状态与停止结果的对账，并让复核命令覆盖
  承载这些断言的测试。
- `tests/ecosystem-boundary.test.mjs` 的引用清单补入本节新引用的测试，使「测试改名/删除」会让
  边界文档的声称失败。
- 文档不得复制 bundle 的行/包清单，也不得引用不存在的测试标题；`tests/ecosystem-boundary.test.mjs`
  与 `tests/docs.test.mjs` 必须保持绿色。

## Acceptance criteria

- [ ] 边界文档新增一节，逐项覆盖六处守卫，并写出每一处「上游变化时失败的测试标题」
- [ ] 新引用的测试标题与真实 `test('…')` 声明逐字一致；`tests/ecosystem-boundary.test.mjs` 的引用清单包含它们
- [ ] chat README 的升级复核包含任务状态与停止结果对账，命令覆盖相应测试
- [ ] 文档没有复制行/包清单，没有断链；`node --test tests/ecosystem-boundary.test.mjs tests/docs.test.mjs` 通过
- [ ] 最终集成状态运行 `npm test` 与 `npm run combo:verify`，两者通过
- [ ] 证据写入 `work/implementation/evidence/135-native-semantic-guards/07-upgrade-checklist/`，记录命令、结果与未完成项

## Blocked by

- [01 任务状态词表](#01-任务状态词表未知状态显式化并与原生类型对账)
- [02 停止结果](#02-停止结果保留原生词表未知结果响亮失败)
- [03 路由保存](#03-路由保存只覆盖手机可编辑字段)
- [04 选型写入](#04-选型写入走原生保存入口)
- [05 输入模态](#05-输入模态从原生列表导入)
- [06 请求幂等](#06-请求幂等同标识连续重发只产生一条消息)
