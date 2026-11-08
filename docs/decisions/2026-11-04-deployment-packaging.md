> 2026-11-04 状态：日期化记录。本文记录 2026-11-04 对 #301 的设计结论，不描述当前实现。
> 实现落地后的操作文档是 `deploy/README.md` 与 `docs/deployment.md`，本文不替代它们。

# 部署与打包：部署单元、自证与宿主契约

#301 的问题表面是「新机器缺几个包、部署脚本不在仓库」，实际上缺的是三件事的答案：**服务器上落地的到底是什么**、
**怎么证明它可用**、**升级回滚时数据怎么办**。本文记录这三个答案，以及为了它们要改的产品代码（五处）。

结论来自三个视角各自独立成稿后的交叉互评（宿主运行时、发布产物、用户旅程），分歧保留在 §6。

## 1. 结论

1. **部署单元 = 一份已经装好的目录树**，不是源码检出，也不是容器。发布包内含：产品 `files` 发布出来的文件、
   构建好的 dsh 树、**预装好的 profile 模板**、自带 Node、`deploy/`、`release.json`。服务器上没有 git、pnpm、
   corepack、tsc。
2. **关键杠杆是既有模板旁路**：`installDecision` 在 `<root>/.ourfairy-template/<productSourceHash>-<pnpmPin>/node_modules`
   存在时直接拷贝，不跑 pnpm。因此模板是**发布包的硬前提**，缺它就会退到 `install` 分支——服务器上表现为
   `profile install failed … (exit null):` 后面空无一物。
3. **不建第二个 doctor。** 宿主自检是 `backend:doctor` 的一个 deployed 模式（新增 `config` 检查类），
   `deploy/doctor.sh` 只是薄 wrapper。模式只允许**收窄**（多查、少做），永不放宽任何既有失败条件。
4. **不做 `combo:verify --deployed`。** 无 git 时它只能跳过 `.git` 与祖先判断，剩下的「通过」没有含义；
   同一事实也会与发布清单构成第二权威。发布包改由 `deploy/verify.sh` + `release.json` + `dsh/build.json` +
   重算 `productSourceHash` 自证；源码检出继续跑**未改动**的 `combo:verify`，另加一条更严的祖先断言。
5. **宿主契约两份、职责正交**：`deploy/host.json`（人维护，bootstrap/doctor/smoke 读）与 `release.json`
   （CI 生成，verify/install 读）。按「每版变/不变」切，不按「包内文件」切。
6. **五处产品代码改动**：`resolveDsh` 读发布清单（无 `.git` 时）、打包模式跳过 `buildProducts`、缺模板快速失败、
   新增 `serve` 前台子命令（systemd 要监管的进程）、新增 `seed-admin --force`（管理员密码锁死的唯一出口）。
7. **数据与版本分离**：`/opt/ourfairy/releases/<v>` + `current`，数据固定在 `/var/lib/ourfairy`。schema **只前进**；
   回滚 = 切版 + 恢复升级前快照，升级窗口内的新数据会丢——写进脚本输出，不只写文档。
8. **宿主先决条件修正**：`bubblewrap`、`poppler-utils`、`python3`（≥3.9）、`util-linux` 四个 apt 包，
   加上允许非特权用户命名空间。**`jq` 与 `pip3` 不是先决条件**（pypdf 以 wheel 随包 vendored）。
9. **AppArmor 默认定向放行**：写 `/etc/apparmor.d/bwrap`（`flags=(unconfined) { userns, }`）并 reload；
   bootstrap **不改全局 sysctl**（CI 的一次性 runner 除外）。

## 2. 为什么是「已装好的目录树」

| 备选 | 否决理由 |
| --- | --- |
| 源码检出 + 一键 bootstrap | 服务器要 git、pnpm、corepack、TS 工具链，且 dsh 要按四条命令现场构建；「开源后新用户无法复现」只是换了个入口 |
| 容器 / OCI | bwrap 在容器里需要额外特权与 userns 配置，与「默认安全」相抵；#301 已明确不在本票 |
| 只发 dsh 产物、产品现场构建 | 仍需 TS 工具链；`tsc` 来自 dsh 检出，等于把开发环境搬上服务器 |

目录树的好处是**运行期只读**：启动只做一次模板拷贝与 profile 重写，没有解析依赖、没有网络。

## 3. 自证模型（为什么不做 `--deployed`）

三段各管一件事，交叉处只做相等断言：

| 件 | 谁写 | 自证什么 |
| --- | --- | --- |
| `combo.json`（包内逐字节副本） | 产品仓库 | 这次构建**应该**用哪个组合 |
| `dsh/build.json` | 发布流水线 | dsh 树**实际**由哪个提交、用哪四条命令、在哪个 node/libc 上构建 |
| `release.json` + `SHA256SUMS` | 发布流水线 | 这个包**就是**那次构建的产物且内部一致 |

`deploy/verify.sh` 的七步里，真正有密码学意义的只有一步：**重算 `productSourceHash` 并与模板目录名前缀比对**——
它能抓「改了一个 dist 字节」和「模板与源码不同源」。其余是清单自洽与平台早退。

`combo:verify --deployed` 被否决的四条理由见 #301 comment；最硬的一条是：**一个不会失败的闸门比没有闸门更坏。**

## 4. 宿主契约与自检

`deploy/host.json`（人维护，随源码与包一起发）：

```
hostPackages[] / binaries{} / service{user,home,prefix} / apparmor{path,content} / port / sourceTag
```

`release.json`（CI 生成）只留构建事实：版本、三个提交、`comboJsonSha256`、`productSourceHash`、`templateDir`、
`platform{os,arch,libcMin}`、`components[].sha256`、`commands{run,when,destructive?}`。
Node 版本放 `combo.json.backend.nodeVersion`（源码与 CI 共用的唯一权威），`release.json` 断言相等。

doctor 的 deployed 模式新增 `config` 类，位置在 `host *` 之后、任何写检查之前：

- `config phaethon password`：`OURFAIRY_PHAETHON_PASSWORD` 非空（纯 env 事实）；
- `config trusted hosts`：`OURFAIRY_TRUSTED_HOSTS` 含部署域名（纯 env，不联网）。

**doctor 不读 `identity.sqlite`**：服务运行时是 WAL，读到未 checkpoint 的状态会给出假失败；更重要的是业务库
不属于「进程外事实」。真实「能不能登录」由 smoke 的试登录证明（POST `/identity/sign-in`）。

## 5. 验收（改写 #301 的五条）

| # | 原验收 | 改写后 | 由谁证明 |
| --- | --- | --- | --- |
| A1 | 干净 Ubuntu 24.04 一条命令完成宿主准备 | 空机跑安装器，末行 `host ready: n/n checks ok` | CI 在 `ubuntu-24.04` runner 真跑 |
| A2 | （隐含）部署即产品可用 | 公网 URL 完成 sign-in → register → 一轮 `/chat/send` 收到 `turn/end` | `deploy/smoke.sh --url`（安装器末行强制） |
| A3 | doctor 查得出缺 bwrap/pdftoppm/jq/pip3 | 缺任一宿主能力时退出码 1 且点名 apt 包；不再检查 jq/pip3 | `tests/host-checks.test.mjs`（假二进制 + PATH 遮蔽） |
| A4 | `deploy/` 不含密钥与主机路径 | `git ls-files deploy/` 无密钥、`/home/<name>/`、IP；且脚本不得解析 `--allow-drift`/`--force` | `tests/deploy-safety.test.mjs` |
| A5 | README 的 Markdown 链接可解析 | 同左 | `tests/docs.test.mjs` |
| A6 | 文档覆盖 systemd/nginx/TLS/数据目录/升级回滚/AppArmor | 一次真实部署的证据目录 | `work/implementation/evidence/301-deploy/` |

新增两条机制性验收：

- `tests/deploy-verify-no-install.test.mjs`：在组装好的发布树上断言 `installDecision().mode !== 'install'`——
  把「模板是硬前提」变成可执行断言，而不是文档承诺。
- 反代 smoke 分三层：A 每版跑（伪造 `Host` 直打回环，抓 `TRUSTED_HOSTS` 403 与后端 SSE 首事件）、
  B 只在 nginx 模板变更时跑（真 nginx，唯一能抓缓冲）、C 安装器末行强制 `--url`。

## 6. 保留的分歧

- **安装器脚本算不算「第二份脚本」**：结论是「生成物，不含宿主逻辑」。它是 Release 的第二个资产
  （`ourfairy-deploy-v$V.sh`），只做「查平台 → 下载 tarball → 比对内嵌 SHA → 解包 → exec 包内
  `bootstrap-host.sh`」。宿主准备逻辑仍然只有一份。反对意见（应在包内解决、不要额外资产）保留。
- **B 层 nginx job 的频率**：模板几周不动，每版都加 nginx 会引入抖动源；当前按「paths 过滤」处理。
  若实测抖动，降级为手工 dispatch，并把 C 层的 WARN 提升为硬失败。
- **dsh 依赖裁剪**：本机 2.5G（`node_modules` 2.1G）必须裁，目标 <400M；**本轮没有实测**，接受条件是
  CI 全量 `npm test` + smoke 通过。残余风险（某些路径覆盖不到）保留。
- **arm64**：本轮不做，`platform.arch` 字段保留；native addon 必须按目标 arch 构建，不能交叉编译。

## 7. 切片（实现顺序）

| 片 | 内容 | 依赖 |
| --- | --- | --- |
| S1 | 产品侧五处改动：`resolveDsh` 读清单、跳过 build、缺模板快速失败、`serve`、`seed-admin --force` | — |
| S2 | `deploy/host.json` + `bootstrap-host.sh` + doctor deployed 模式（`host *`/`config`） | S1 的清单读取 |
| S3 | `scripts/release.ts` 打包（dsh 构建与裁剪、模板、Node、`release.json`、`SHA256SUMS`）+ `release.yml` | S1、S2 |
| S4 | `deploy/`：`verify.sh`、`install.sh`（`--upgrade`/`--rollback`）、`backup.sh`/`restore.sh`、`render-config.sh`、`smoke.sh`、unit、`env.example` | S2、S3 |
| S5 | 文档：`deploy/README.md`、`docs/deployment.md`、根 README 一节；#301 原文修正 | S4 |
| S6 | 验证：A/B/C 三层 smoke、`tests/deploy-*`、一次真实部署证据 | S3、S4 |

## 8. 不在本轮

Docker/OCI、多机编排、自动 TLS 签发、监控告警（沿用 #301）；客户端运行时改后端地址（无此入口，
自托管者必须自建 APK）；`package.json.version` 作为版本权威（只认 tag）；签名与公证；增量更新。
