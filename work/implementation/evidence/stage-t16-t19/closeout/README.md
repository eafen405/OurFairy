# T16–T19 发布与停止记录

本批 T16/#39、T17/#40、T18/#41、T19/#42 已完成，沿用现有集成分支；本收尾记录不启动后续票。

## 实际组合与验证

| 仓库 | 集成分支 | 已发布行为提交 |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `d189d85bda0b6d0230b3fb96215e5d40f878a8a2`，之后仅本收尾文档 |
| rikkahub | `product/ourfairy-v1` | `771bffd1424da0f8537507caec028e77d0b8b7bc` |
| dsh | `product/ourfairy-v1` | `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`，本批无改动 |

 是最终组合的正常 `git commit` 原文：`npm test` 109/109、`combo:verify` 通过，无 hook 覆盖。Android 全量 515/515、release 构建原文在  与。生产路径 `git diff --check 1807199...HEAD -- backend scripts tests/model-double.test.mjs tests/pdf.test.mjs tests/speech.test.mjs combo.json` 通过；原始命令日志保留其终端表格尾部空格，不改写历史输出。

收尾文档首次正常提交检查为 104/109：PDF 共用的 before hook 启动超时 300 秒，五项依赖该 fixture 的测试均失败。实际进程定位到临时 profile 的 `corepack pnpm@11.28.5 install --ignore-scripts --store-dir...`，未执行到 PDF 断言；根因未确认。原文为，正常钩子重试，不覆盖或绕过检查。

原两轴审查、P2 修复复查和最终源码 SHA256 核验在 `../../review-t16-t19/`。阅读位置修复已闭环；原 T19 首轮测试顺序的历史流程偏离保留。PDF 资源用例在并发构建的一轮完整检查中曾失败，原日志保留在；并发是否为原因尚未确认。最终正常完整检查通过，未修改 PDF 模块或伪称其问题已修复。

## 实际发布

HTTPS 首次推送挂起，读取探针报 HTTP/2 framing 错误；HTTP/1.1 重试无法连接 443，日志分别保留在 `02-*`、`03-*`。用户随后明确要求尝试 SSH，`ssh -T git@github.com` 成功认证为 eafen405。按顺序正常推送 Android、OurFairy，命令如下，原输出见 `04-*`、`05-*`：

```bash
git -C /home/eafen405/projects/rikkahub -c remote.fork.pushurl=ssh://git@github.com/eafen405/rikkahub.git -c core.sshCommand='ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes' push fork product/ourfairy-v1:product/ourfairy-v1
git -c remote.origin.pushurl=ssh://git@github.com/eafen405/OurFairy.git -c core.sshCommand='ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes' push origin integration/ourfairy-v1:integration/ourfairy-v1
```

仅对该次命令设置 SSH URL，未改永久远端配置。 是两仓 SSH `ls-remote` 实际输出，均等于上述提交。

## 关票与精确清理

- #39：<https://github.com/eafen405/OurFairy/issues/39#issuecomment-6218944499>
- #40：已在 T17 集成后关闭，依赖解除证据见 `../t17-integration/`。
- #41：<https://github.com/eafen405/OurFairy/issues/41#issuecomment-6218945819>
- #42：<https://github.com/eafen405/OurFairy/issues/42#issuecomment-6218947302>
- 父 #23 阶段交接：<https://github.com/eafen405/OurFairy/issues/23#issuecomment-6218948399>，父票保持 open。

`issue-operations.json` 保存实际 gh 命令、退出码与响应；`issue-states.json` 实际查询四票均 closed。评论正文以对应 Markdown 文件归档。

`cleanup.json` 保存本批 8 个 worktree 的分支/提交、合并祖先与干净状态、前后清单。仅清理本批 checkout，全部分支和旧 worktree 保留。Android 的 worktree-local node_modules 链接只 unlink，未删除共享目标。最后一个 review 子模块共享临时 gitdir 的 worktree 指针已随 T19 checkout 失效；以显式 `--git-dir/--work-tree` 核验其固定提交 `5b3618b16fdc3825e21d5679bafd144662088ea1` 和干净状态后移除 checkout，未修改共享配置。dsh 16 个原有修改逐文件 SHA256 完全一致，见 `protected-dsh-final.json`。

修复后测试签名 arm64 APK 留在 `/tmp/ourfairy-t16-t19-release/app-arm64-v8a-release.apk`；来源、尺寸、SHA256 见 `release-artifact.json`。不是生产签名，也未在设备运行。

真实硅基/官方云、手机麦克风与 vivo S50 帧耗时/内存/视觉连续性仍按各票联调入口交最终集成/真机验收。本批收尾后停止，不推进 T20。
