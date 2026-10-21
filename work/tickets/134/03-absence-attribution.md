# 03: 缺席行按性质分组并写明理由

**What to build:** `FORBIDDEN_ROW_IDS` 现在是一张 34 个 id 的平表，「刻意不要」与「产品需要但暂未适配」混在一起，看过名单的人分不出决定与待办。把它按性质分成四段，每段写一行理由，理由就写在名单旁的注释里——那是唯一权威所在。

这一票只改名单的组织方式与注释，不增删任何 id，不改变任何行的挂载状态，也不为 bundle README 新增对账检查。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `FORBIDDEN_ROW_IDS` 按四段组织，每段一行理由注释：**暂缓（产品需要、尚未适配）**、**与 scoped 文件系统冲突**、**写死排除（Remote 接缝）**、**产品明确不要 / 被 scoped 适配器取代**
- [ ] 四段归属：`session-title`、`session-title-llm` → 暂缓；`tool-fs-search` → 与 scoped 文件系统冲突；`user-questions` → 写死排除；其余 33 个 id → 产品明确不要 / 被替换
- [ ] 理由写明「缺什么」而不只是「不要」：`session-title` 写产品的会话投影没有标题字段、客户端没有消费 `title` 投影单元的位置；`session-title-llm` 写它在 `session-title` 落地前没有注册目标、辅助请求要落到产品的 `llm-pi-ai` 路由；`tool-fs-search` 写 ripgrep 二进制不在产品的 bwrap 命名空间内、返回路径的基准与按归属派生的 scoped 根不同；`user-questions` 写它唯一的出厂应答路径是 Typert/Remote 方法，而产品刻意不接这条接缝
- [ ] 名单新增三个 id（`session-title`、`session-title-llm`、`user-questions`），总数 37；原有 34 个 id 一个不少、一个不改。缺席断言 `tests/baseline-boot.test.mjs` 的两个用例原样通过
- [ ] `backend/v1-bundle/README.md` 的「Absent rows」不再复述分类：保留指向 `FORBIDDEN_ROW_IDS` 的指针，删掉手写的归类散文（其中把 `tool-fs-search` 归进「被 scoped 适配器替换的原生默认」是错的）
- [ ] 不为 README 新增检查；`node --test tests/docs.test.mjs tests/ecosystem-boundary.test.mjs tests/baseline-boot.test.mjs` 通过
