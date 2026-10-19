## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

把本 spec 划定的边界写成可引用的文档：产品 HTTP/SSE 是明确的并行传输例外（用了什么、没用什么、为什么、什么条件下重新评估）；登录路由留在 `/api` 之外的理由；业务 SQLite、identity、fs/sandbox 保留产品实现而不是换更弱原生能力的理由；不挂 plugin manager、npm 发布不在范围。文档不得声称"已经完全原生"，也不得重复 bundle 已有的行清单。

## Acceptance criteria

- [ ] 新文档记录并行传输例外、登录路径边界、保留的产品实现与未采用的原生能力，各自给出理由与重新评估条件
- [ ] 文档不复制 bundle 行清单或包清单，改为指向唯一权威文件
- [ ] 仓库 Markdown 链接检查通过
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

None (can start immediately).
