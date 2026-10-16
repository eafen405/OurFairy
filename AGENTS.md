VOICE_API_KEY为硅基流动的语音识别服务。
本仓库fork rikkahub,deepseek-harness,在wsl的本地projects目录下存在，
github地址：https://github.com/rikkahub/rikkahub; https://github.com/deepseek-ai/deepseek-harness

## 研发与审查

### 设计与复杂度控制

- **复用优先。** 先查现有实现，明确能力、缺口和最小改动；新增入口或角色不默认另建流程。
- **区分来源。** 分清用户要求、代码事实与模型建议。
- **结构按需。** 新增表、模块或机制须说明必要性及无法复用的原因；依据生命周期、查询、容量和并发选择结构，不为假设扩展过度设计。
- **权威唯一。** 复用规则与数据，避免重复逻辑和多份权威状态；快照及派生数据须明确来源与失效规则。
- **限制范围。** 局部需求不默认改造全局；超出原方案先说明必要性和更小替代方案，不静默扩展，也不对已授权的常规细节反复请示。
- **精简不减保障。** 保留必要的权限、隔离、事务、幂等、并发控制、失败恢复及操作溯源。设计与交付均检查影响范围和维护成本；测试通过或文档已确认不代表架构必要。
- **规模校准。** 本项目是个人项目、面向少量受邀用户：抽象与防御只在当下明确需求或已观测到的失败面前加入，并指名它服务哪一个需求或故障。必需的保障按「精简不减保障」完整保留。

### 数据库

- 业务状态、分类、象限、来源等有限枚举，数据库与接口统一使用数字编码；中文含义通过注释、枚举类或前端常量维护。
- 业务表必须包含逻辑删除字段，并记录必要的关联人员、创建及更新时间。
- 禁止数据库外键与唯一键索引。
- 若改动涉及数据结构，需在设计阶段明确告知用户变动内容。

### 编码标准

编写或审查代码时读 `CODING_STANDARDS.md`；实施首版票时从 `work/implementation/CONVENTIONS.md` 进入，按指针读取当前任务所需内容。

## Agent skills

### Issue tracker

Issues live as GitHub issues, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map to `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
