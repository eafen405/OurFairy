## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-03。

## What to build

修正 Agent 从现行导航入口出发时会遇到的规格遗漏、术语入口过窄、示例路径失效和证据漏登。

## Current evidence

- `work/implementation/CONVENTIONS.md:7-20` 的权威清单只列首版父规格，没有登记记忆工作的现行规格 `docs/specs/fairy-memory.md`。
- `docs/README.md:11` 只描述“外部感官领域词汇”，而 `GLOSSARY-MAP.md` 已登记外部感官与记忆两个局部上下文。
- `docs/README.md:18` 要求文件状态头优先，但没有说明无状态头文件按目录档位理解。
- `docs/agents/domain.md` 仍含本仓库不存在的 `src/<context>/...` 示例路径。
- 证据索引手写段存在漏登；至少需核实 `135-native-semantic-guards`、`255-fairy-eye-highlight`、arch-52/53/58/63/68/70 与 review-arch-map69 系列。

## Scope

- `work/implementation/CONVENTIONS.md`
- `docs/README.md`
- `docs/agents/domain.md`
- `work/implementation/evidence/README.md`
- 仅在修正上述导航确实需要时修改对应链接，不改被链接文档正文。

## Acceptance criteria

- [ ] 记忆与上下文治理工作能从 CONVENTIONS 找到 #240 现行规格，并明确其适用边界；首版父规格仍是产品总权威。
- [ ] `docs/README.md` 的术语入口覆盖当前局部上下文，直接指向 `GLOSSARY-MAP.md` 或列出等价范围。
- [ ] 无状态头文件的档位规则明确，目录档位与文件级覆盖不冲突。
- [ ] `docs/agents/domain.md` 的本仓库路径示例指向真实目录。
- [ ] 逐项核实并补齐当前仍存在的证据目录漏项，不为凑编号虚构分类或说明。
- [ ] 生成段仍由描述文件派生；本票只修手写段，不改变既有生成器设计。

## Verification

```bash
node --test tests/docs.test.mjs
node scripts/evidence-index.ts --check
```

## Blocked by

无。

## Out of scope

不改当前活跃的 `GLOSSARY.md`、`docs/glossary/memory.md` 和未跟踪研究文档；不重写历史证据；不把 `evidence:index --check` 新增为 CI/提交门禁，不新增判断文档正文真实性的测试。
