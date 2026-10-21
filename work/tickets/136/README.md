# #136 产品包清单真实性：实施票与任务图

父票：[#136 产品包清单真实性：peer、files 与缺失字段的一致性](https://github.com/eafen405/OurFairy/issues/136)。
票面本体的 Web 权威在上面这个链接；本目录是工作副本，编号对应见 `published.json`。

三张子票互不阻塞，可并行：

| 文件 | 票号 | 内容 |
| --- | --- | --- |
| `01-peer-declarations.md` | #148 | peer 声明对齐真实 import |
| `02-license.md` | #149 | search 与 spaces 补 license |
| `03-kernel-readmes.md` | #150 | identity/sessions README 与 files 存在性检查 |

---

## Problem Statement

产品包的清单在四处说了不准确的话：

- `groups` 声明了 identity 的 peer，但它的源码从不 import identity，只在运行时读服务。
- `probe` import 了 `@ourfairy/dsh-identity/owner`，却一个 peer 都没声明。
- `identity` 与 `sessions` 的 `files` 列了 `README.md`，而两个目录下都没有这个文件。它们是产品内核，也是唯一没有自己 README 的两个包。
- `search` 的清单缺 `license` 字段，其余九个产品包都有。

这些都不会让任何检查失败：`.md` 的缺失被 glob 静默跳过，`@ourfairy/*` 的 peer 被明确排除在兼容性判定之外。于是清单逐渐变成历史残留，而不是可读的事实。

## Solution

让每份清单只写真实存在的东西：删掉无消费者的声明，补上被引用的声明或写明理由，补齐两个内核包的 README 与缺失字段。

## User Stories

1. 作为维护者，我想让每个 peer 声明都对应一处真实 import，这样读清单能判断依赖方向。
2. 作为维护者，我想让每个被 import 的产品包都被声明，这样清单不会漏掉实际依赖。
3. 作为维护者，我想让 `files` 里列出的每个路径都存在，这样安装副本的构成可以被信任。
4. 作为维护者，我想让两个内核包有自己的 README，这样它们不比插件包更难理解。
5. 作为审查者，我想让 README 说明每个内核包拥有什么、不拥有什么，这样「谁负责归属」不必读源码。
6. 作为升级者，我想让内核包的 README 指向它们依赖的 dsh 接缝，这样升级时有复核起点。
7. 作为打包者，我想让所有产品包在许可字段上一致，这样许可证扫描不需要例外清单。
8. 作为审查者，我想让这次改动不改变任何运行时代码，这样它可以在任何时间点独立合并。
9. 作为维护者，我想让清单类的不一致有可执行的发现方式，而不是靠人工通读。
10. 作为维护者，我想在无法做出可靠检查时明确说不做，而不是加一个只看文本的假检查。
11. 作为审查者，我想让每个被删声明在提交说明里写明「从未有消费者」，这样它不是被误删。
12. 作为维护者，我想让 probe 的声明状态要么合规要么有注释说明为何例外，这样它是决定而不是遗漏。

## Implementation Decisions

- 删除 `groups` 对 identity 的 peer 声明。它在运行时读 `ctx.identity`，那是服务可用性约束，不是模块依赖。
- `probe` 要么声明它 import 的产品包 peer，要么在清单里注释说明为何测试夹具例外。二者择一，理由写进提交说明。
- 为 `identity` 与 `sessions` 写 README，内容限于：该包拥有什么、不拥有什么、依赖哪些 dsh 接缝、以及它对外暴露的服务名。不复述行配置，不复述测试清单——那两处各有唯一权威。
- `search` 补 `license` 字段，与其余产品包一致。
- 不新增「peer 与 import 一致」的扫描式检查。这类检查断言源码文本而不是行为，且 `@ourfairy/*` 的 peer 已被明确排除在兼容性判定之外，没有运行期后果。若将来要防漂移，正确做法是让声明缺失在加载期就失败，而不是加一条正则。
- 「`files` 中的路径必须存在」可以作为一条轻量检查：它读的是清单与文件系统，不读源码文本，且能防止安装副本静默缺件。

## Testing Decisions

好测试只断言外部事实：安装副本里有什么、诊断报告了什么。不扫描源码判断某个 import 是否配了 peer。

- 接缝：`doctor --json` 的 `product packages` 与安装副本检查，既有入口。
- `tests/bundle-packages.test.mjs` 的「安装副本只含已声明文件」已经覆盖 bundle 包；若新增 `files` 存在性检查，放在同一个测试文件里，对全部产品包生效。
- README 的存在不需要测试；`files` 里列出它之后，安装副本检查会自然覆盖「被列出的必须被发布」。
- 先前艺术：`tests/plugin-compatibility.test.mjs` 对每份 manifest 的遍历方式。
- 全量门槛：`npm test` 与 `npm run combo:verify`。

## Out of Scope

- 修改任何包的 `exports`。
- 新增产品或原生依赖。
- 为 peer 一致性新增源码扫描检查。
- 重写既有的包 README。

## Further Notes

- 关联 #73（插件契约）。本票清的是那次收敛之后残留的清单不一致。
- 若写内核 README 时发现某个包「拥有什么」难以一句话说清，那本身是信号——记录下来，不要在 README 里绕过去。

