# T16–T19 起点验证

起点见相邻 `../baseline.json`；验证期间三仓集成 tip 未改变。

实际命令与结果：

- `npm test`：首次在受限沙箱运行失败，真实 HTTP fixtures 无法绑定 `127.0.0.1`（独立执行 `node tests/attachment-download-abort.test.mjs` 确认 `listen EPERM`）。原始日志 `npm-test.log` 保留。
- `npm test`（沙箱外，同一源码）：102/102 通过，exit 0，日志 `npm-test-full.log`。
- `npm run combo:verify`：通过，三仓组合与锁定提交一致，日志 `combo-verify.log`。
- `npm run backend:doctor`：全部检查通过，日志 `backend-doctor.log`。

以上是起点检查，不能替代最终集成后再次运行完整入口；未运行真机或官方云服务验收。

正常 hooks：OurFairy `core.hooksPath=.githooks`，`pre-commit` 清除 Git local 环境变量后执行 `npm test`、`npm run combo:verify`；本仓无 pre-push。提交不得绕过。
