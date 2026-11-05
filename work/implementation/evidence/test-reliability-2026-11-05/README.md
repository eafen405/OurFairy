# 测试可靠性修复（2026-11-05）

本轮由用户直接要求审查并改进测试的并发可靠性；没有产品行为或数据库结构改动。
关联 issue：[测试可靠性 #310](https://github.com/eafen405/OurFairy/issues/310)。
基线为 `fa9cec8b74a3aa6a` 工作树，保留开始时已暂存的启动器、生命周期测试改动和已有部署文档。
运行环境：Node `v24.22.2`，Linux，dsh `c41af067cf1d5bb94fa89ca42f4cd4f054db4b17`。
本机用 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2` 指定恰好匹配锁定提交的检出。

## 已验证的问题

| 问题 | 修复前证据 | 修复 |
| --- | --- | --- |
| 构建锁初始化竞争 | 在 `open('wx')` 创建空文件与 PID 写入之间暂停 A，B 将空锁删除后取得锁；恢复 A 后，两个未释放的持有者都进入临界区，断言失败 | [构建脚本](../../../../scripts/tsc.ts) 使用 `flock`，不删除锁文件、不以 PID 或年龄抢锁 |
| 构建锁未覆盖测试读取产物的阶段 | 原 `pretest` 编译完成即释放锁，随后 `node --test` 读取同一产物，另一条 fresh build 可以清理它 | [测试入口](../../../../scripts/test.ts) 从构建开始到测试子进程退出持同一把锁；相关提交门禁与 CI 复用入口 |
| 语音并发测试依赖调度速度 | 将测试的 30 ms 休眠延后到 500 ms，150 ms 的请求期限先到，稳定得到 `504 !== 429` | [语音测试](../../../../tests/speech.test.mjs) 等替身收到请求后再竞争、取消；短超时仅用于专门的超时步骤，替身保持未响应 |
| 技能取消测试会晚于命令结束 | 将 300 ms 取消回调延后到 5500 ms，`sleep 5` 已成功退出，断言 `an aborted run is incomplete` 失败 | [技能验证测试](../../../../tests/skill-verify.test.mjs) 由沙箱子命令通过回环 socket 发送启动信号，再取消；去掉机器速度的 4500 ms 上界 |
| 技能测试哨兵未隔离 | 临时 root 的父目录是公共 `/tmp`，`join(root, '..', 'env')` 指向公共路径 | 临时 home 下创建独立的 `skills` 和 `env`，一并清理 |

调度延迟是受控复现，不代表线上或自然运行的失败概率。两处延迟复验使用临时 preload 改写对应的测试定时器；修复后同样的 preload 已通过。
构建锁复验保持“打开空锁文件后暂停 A，让 B 先取得锁”的交错；新 API 下 A 会等待 B 释放。

## 回归覆盖

- [build-lock.test.mjs](../../../../tests/build-lock.test.mjs)：空文件互斥、相同 inode、嵌套使用、异常释放、子进程继承与持有者被杀后释放。
- [test-runner.test.mjs](../../../../tests/test-runner.test.mjs)：两个独立入口并发，观测 `build → test → build → test`；测试期间第三方拿不到写锁；只运行选中文件；编译和测试失败均传播非零退出码。
- [precommit.test.mjs](../../../../tests/precommit.test.mjs)：相关测试和全量测试使用相同入口，CI 调用统一入口，测试发现范围与选择器一致。

没有添加失败重试或静默跳过，也没有把测试文件整体改成串行。锁只串行化同一工作树的构建/测试命令；Node 文件级并发照常。
系统依赖为 Linux `flock`（util-linux），根 README 已注明。
发布时用户确认保留原 CI 配置：GitHub 凭据缺少修改 workflow 的权限，因此本轮不修改工作流；CI 仍保留独立产品构建步骤，随后 `npm test` 在锁内再构建一次。
直接 `node --test` 仍可调试，但不持工作树锁；标准用法改为 `npm test -- tests/<name>.test.mjs`。

## 验证

- 原工作区全量 `npm test`：**680 passed，0 failed，0 cancelled，0 skipped**，44 suites，测试阶段 `425904.420949 ms`，进程退出码 0。
- 提交前在独立 `ticket/310-test-reliability` 工作树运行完整提交门禁：**679 passed，0 failed，0 cancelled，0 skipped**，44 suites，测试阶段 `411815.099247 ms`，组合检查通过。该树仅包含本轮修复，不含原工作区已暂存的启动器与生命周期用例改动，因此测试数量少一项。
- 全量运行期间启动第二条 `npm run build`；同时用 `flock --nonblock .ourfairy-build.lock true` 确认写锁不可获取。第二条构建等待到全量结束后再编译，退出码 0。
- `npm run combo:verify`：产品、dsh、Android 来源三行均通过。
- 定向锁测试和技能验证测试：8/8 通过；语音调度延迟复验和测试入口回归：5/5 通过。
- 原始运行日志放在 `work/tmp/test-reliability-2026-11-05/`，不入库。

```sh
export OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2
npm test
# 在上面的全量仍运行时，另一个终端执行，验证它等待测试结束：
npm run build
npm run combo:verify
```

所有后端行为测试使用模型/网络替身；未调用真实模型或语音服务。
本轮未改 Android，未运行 Android 构建、测试或真机验收。
