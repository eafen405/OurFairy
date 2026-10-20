# #73 实施票与任务图

父规格：[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)。

状态：已完成。11 张原生子议题（#96–#106）全部关闭，实现与证据已合入 `integration/spec-73`；
收口记录见 `work/implementation/evidence/106-closeout/README.md`。列表序号是阅读顺序，实际身份见各票链接。

## 拆分原则

- 先做 bundle 自描述与一致性检查（#96/#98），再做行级拆分（#99–#101），Config/元数据与单一模型权威并行（#102/#103），最后是最高 seam 的生态验收（#104）与 overlay 可寻址验收（#105）。
- 文档边界（#97）无依赖，可与 #96 并行；它只写文档，不改装配。
- 每票形成可从真实 launcher、真实 dsh CLI 或 overlay 验证的行为，不用内部实现细节当断言。
- 与并行 spec 的写范围见 `work/implementation/notes/73-boundary.md`；行拆分的具体落点见 `work/implementation/notes/73-row-plan.md`。

## 已发布实施票

1. **bundle 成为产品包集合的唯一权威**（#96，无阻塞）
   - 交付：profile 的产品包集合由 bundle manifest 导出；launcher 不再有人工清单；doctor 与测试对"行 / 声明包 / 已安装包 / 生成 profile"做一致性检查。
   - [GitHub](https://github.com/eafen405/OurFairy/issues/96) · [本地副本](01-bundle-package-authority.md)

2. **并行传输例外与保留产品实现的书面边界**（#97，无阻塞）
   - 交付：可引用的边界文档，说明并行 HTTP/SSE 传输、登录路径、保留的产品实现与不采用的原生能力，各带理由与重新评估条件。
   - [GitHub](https://github.com/eafen405/OurFairy/issues/97) · [本地副本](08-ecosystem-boundary-doc.md)

3. **产品包声明明确的 dsh 兼容范围并由 doctor 校验**（#98，阻塞于 #96）
   - 交付：`workspace:` peer 改为 semver；doctor 用 dsh 公开判定校验每个已安装产品包。
   - [GitHub](https://github.com/eafen405/OurFairy/issues/98) · [本地副本](02-upstream-compatibility.md)

4. **投递成为独立产品行并只向 chat 请求窄运行时**（#99，阻塞于 #96）
   - [GitHub](https://github.com/eafen405/OurFairy/issues/99) · [本地副本](03-delivery-row.md)

5. **群组工具成为独立产品行**（#100，阻塞于 #96）
   - [GitHub](https://github.com/eafen405/OurFairy/issues/100) · [本地副本](04-groups-row.md)

6. **文件系统、sandbox、bash、工作目录 scoped provider 各自成行**（#101，阻塞于 #96）
   - [GitHub](https://github.com/eafen405/OurFairy/issues/101) · [本地副本](05-scoped-provider-rows.md)

7. **产品行声明 Config 并在加载期以行名和字段失败**（#102，阻塞于 #101）
   - 交付：identity/spaces/attachments 的 Config；探针把 bundle 产品行未激活当作启动失败。
   - [GitHub](https://github.com/eafen405/OurFairy/issues/102) · [本地副本](06-config-contracts-and-row-liveness.md)

8. **共享模型初始声明只保留在 bundle**（#103，阻塞于 #102）
   - [GitHub](https://github.com/eafen405/OurFairy/issues/103) · [本地副本](07-single-model-authority.md)

9. **只声明 bundle 的 profile 可安装并启动**（#104，阻塞于 #98/#99/#100/#101/#102/#103）
   - [GitHub](https://github.com/eafen405/OurFairy/issues/104) · [本地副本](09-bundle-only-acceptance.md)

10. **行可寻址与配置契约的 overlay 验收**（#105，阻塞于 #99/#100/#101/#102）
    - [GitHub](https://github.com/eafen405/OurFairy/issues/105) · [本地副本](10-row-addressability-tests.md)

11. **版本组合、证据与两轴评审收口**（#106，阻塞于 #104/#105）
    - [GitHub](https://github.com/eafen405/OurFairy/issues/106) · [本地副本](11-closeout.md)
