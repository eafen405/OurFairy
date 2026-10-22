> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# Fairybot 空间权限与当前 dsh sandbox 的复用边界

日期：2026-10-14。静态源码核查，未运行测试、编译迁移或隔离原型。Fairybot：`095efdd84fd7ab2215a0b5b03369aac4f1303108`；dsh：`d743267388641bc76f17c45ce8b4c231aed1d32c`。

## 结论

上一代已有文件和脚本的空间权限实现，而且已经复用 dsh 的 sandbox 接口。可复用的重点是现成的授权逻辑、受限文件系统与按授权挂载目录的执行实现。当前 dsh 原生 sandbox 实现主要限制文件修改，并不直接实现 OurFairy 的多用户读取隔离。不能把“可复用 dsh sandbox 接口”与“启用默认 sandbox 就能隔离用户”混为一谈。

## 用户确认的设计约束

2026-10-14，用户接受以旧实现为基础适配的方向，并明确要求避免模块纠缠，不将无关模块的统筹放在同一文件。复用旧功能不自动继承旧宿主、注册表或集中管理文件的职责分配。

后续设计应分别说明会话归属的维护、空间访问范围的计算、文件与进程限制的执行、投递及通知的职责和必要依赖。装配入口负责连接这些模块，各模块内部维护自己的规则；文件与进程使用一致的授权依据，通过明确接口取得所需范围。具体模块及文件划分待设计审查，不以提前拆出大量转发模块替代职责分析。

## 当前 dsh 提供什么

| 部分 | 已有事实 | 对复用的意义 |
| --- | --- | --- |
| 策略传递 | SandboxExecutionPolicy 有 mode、workspaceRoot、sessionId；resolve({session}) 会填 sessionId | 自定义执行实现已有定位调用会话的通道，无须先给 Fairy 增加参数 |
| 执行接口 | SandboxProvider.confine(argv, policy, signal?) 返回受限命令及错误识别信息 | 旧 BwrapSandboxProvider 的主要实现接口与当前接口相符 |
| bash 执行 | bash-sandbox 调用 ctx.sandbox.confine，再将结果交给现有执行链 | 可保留工具和进程执行能力，替换实际限制目录的实现 |
| 默认文件实现 | fs-sandbox 只在 writeText/editText 加限制，读取沿用 fs-local | 不能直接承担私有空间的读授权 |
| 默认 Linux 进程实现 | bwrap 只读挂载整个根目录；Landlock 配置 readOnly ['/'] | 保留宿主进程已有的读取权限，不主动屏蔽其他用户数据 |
| 模式 | danger-full-access 在 bash-sandbox 内直接跳过 confine | 只替换 confine 不足以保证所有执行都受用户限制；需检查实际执行入口 |

证据：[策略字段](/home/eafen405/projects/deepseek-harness/packages/sandbox/sandbox/src/index.ts:40)、[confine 接口](/home/eafen405/projects/deepseek-harness/packages/sandbox/sandbox/src/index.ts:177)、[策略解析](/home/eafen405/projects/deepseek-harness/packages/sandbox/sandbox-policy/src/index.ts:164)、[bash 执行](/home/eafen405/projects/deepseek-harness/packages/shell/bash-sandbox/src/index.ts:89)、[文件实现](/home/eafen405/projects/deepseek-harness/packages/fs/fs-sandbox/src/index.ts:1)、[Linux 挂载与读取范围](/home/eafen405/projects/deepseek-harness/packages/sandbox/sandbox-local/src/profiles.ts:16)。

## 旧 Fairybot 已经怎么做

启动时挂载自有 ProcessingFileSystem 和 BwrapSandboxProvider，分别成为 dsh 的 ctx.fs 和 ctx.sandbox；文件工具与 bash 工具从这些位置取得实现。并非另起一套模型工具接口。

证据：[装配点](/home/eafen405/projects/Fairybot/src/server/processing/host.ts:113)、[旧依赖版本](/home/eafen405/projects/Fairybot/package.json:38)。旧项目依赖 dsh `0.2.0-rc.2`；与当前 checkout 的接口对照不是完整编译兼容验证。

会话身份先从旧身份存储解析，再核验 header.cwd 是否确实属于该用户，将核验结果登记到 ProcessingScopes。文件访问与 shell 挂载都从该处取得资源范围。OurFairy 已确定会话直接携带归属，迁移时需要改变这份身份来源，不应将旧外部会话归属表当作新设计。

证据：[工作区核验](/home/eafen405/projects/Fairybot/src/server/processing/workspace-authority.ts:67)、[执行时取得授权资源](/home/eafen405/projects/Fairybot/src/server/processing/carrier.ts:57)。

旧文件实现通过 tools/execute 取得当前会话，在异步调用范围中传递身份；resolve 及后续读写检查获准范围。受控打开还校验实际打开对象，以应对符号链接和路径替换。实现依赖 Linux 的 /proc/self/fd，不能据此声称跨平台可直接复用。

证据：[文件执行身份](/home/eafen405/projects/Fairybot/src/server/processing/fs-provider.ts:98)、[路径授权](/home/eafen405/projects/Fairybot/src/server/processing/fs-provider.ts:203)、[平台与受控打开说明](/home/eafen405/projects/Fairybot/src/server/processing/fs-provider.ts:28)。

旧脚本执行使用 bubblewrap 创建受限环境，只挂载运行所需目录、本人工作区、获准公共/成员空间、获准只读输入和依赖。它不挂载整个宿主根；清空继承环境，使用独立临时目录，并启用命名空间隔离。bubblewrap 或所需能力不可用时拒绝执行，不回退成无沙箱命令。

证据：[挂载构造](/home/eafen405/projects/Fairybot/src/server/processing/bwrap.ts:152)、[缺失会话拒绝及核验](/home/eafen405/projects/Fairybot/src/server/processing/carrier.ts:92)、[探测失败拒绝](/home/eafen405/projects/Fairybot/src/server/processing/carrier.ts:57)。

旧处理工具守门拒绝 danger-full-access；这是现有模型工具链的一部分。迁移时仍须审查其他直接 shell 调用及升级路径，不能将工具守门等同于所有执行入口的强制检查。

证据：[工具守门](/home/eafen405/projects/Fairybot/src/server/processing/gate.ts:29)、[当前 dsh 绕过分支](/home/eafen405/projects/deepseek-harness/packages/shell/bash-sandbox/src/index.ts:92)。

## 不能自动继承的行为

- 旧文件实现还为内部只读和 HTTP 工作区入口保留特殊路径，依赖其调用方已核对归属；搬到新的 HTTP 接入时不能默认这些前提成立。旧代码也有“工具恒传 header.cwd”的注释，但当前工具通过 workingDirectory.ensure 取得目录；当前目录可由 working-directory/change 事件改变，ensure 还会直接调用 fs.resolve/stat。需要适配这些访问路径，保持“改变当前目录不改变权限”，不能依据旧注释判断兼容。证据：[内部与 HTTP 入口](/home/eafen405/projects/Fairybot/src/server/processing/fs-provider.ts:227)、[当前工具目录来源](/home/eafen405/projects/deepseek-harness/packages/fs/tool-fs/src/session-cwd.ts:17)、[目录状态](/home/eafen405/projects/deepseek-harness/packages/session/working-directory/src/index.ts:82)、[目录校验](/home/eafen405/projects/deepseek-harness/packages/session/working-directory/src/index.ts:134)。
- 旧项目群组外分享仍有独立分享授权行；旧 ADR 已写明调整待实施。OurFairy 当前已确认投递工具调用本身表达授权，不能重新引入旧分享审批要求。
- 空间权限在新操作和新命令启动时读取；已经启动的进程保留其挂载，不能把撤销成员资格描述为立即收回所有运行中进程的访问。
- 旧普通执行隔离网络，依赖安装有单独联网入口。2026-10-14 用户明确要求允许联网，OurFairy 不沿用普通执行默认断网的规则；联网接入需与用户文件隔离分别设计，具体实现尚未验证。允许联网不自动确定依赖安装和共享环境修改权限。
- 当前证据支持优先复用旧实现、保持简单工具接口，但不选定全部运行时装配，不证明所有插件已完成多用户隔离。

证据：[旧 ADR 当前实现](/home/eafen405/projects/Fairybot/docs/adr/0013-persistent-authorization-semantics.md:32)、[执行时生成挂载](/home/eafen405/projects/Fairybot/src/server/processing/carrier.ts:65)、[安装的联网配置](/home/eafen405/projects/Fairybot/src/server/processing/bwrap.ts:228)。

## 验证状态与后续最小验证

旧仓库有文件越界、符号链接、会话伪装、授权变更等测试，以及真实 bubblewrap 执行测试；真实隔离测试在 bubblewrap/user namespace 不可用时会跳过。本轮只读测试代码，不报告通过数，不把测试存在当作当前环境已经验证。

证据：[文件越界测试](/home/eafen405/projects/Fairybot/tests/processing.spec.ts:433)、[真实执行测试及跳过条件](/home/eafen405/projects/Fairybot/tests/processing-carrier.spec.ts:363)。

若进入原型验证，最小目标应为：接入当前 dsh 接口；用两个用户验证普通 read 与 bash/Python 对同一文件得到相同权限结果；本人私有文件和获准共享文件可用，另一用户私有文件不可读；身份缺失与无沙箱执行不能绕过；明确重启恢复与后台任务仍取得同一归属。这是建议的验证范围，尚未执行。
