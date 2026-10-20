## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

群组成为独立产品行：`groups` / `group_create` / `group_members` 工具与群组空间的额外根贡献迁到自己的产品包与行 id。identity 继续拥有群组数据与成员事务，spaces 继续拥有空间范围计算，群组行只作为贡献者注册。单独 disable 群组行时，文件与脚本能力仍工作，群组工具与群组根缺席。

## Acceptance criteria

- [ ] bundle 中存在独立的群组行，行 id 稳定、可被 overlay 定位；群组代码位于自己的产品包
- [ ] spaces 仍独占空间范围计算；群组只通过公开的贡献者注册接入额外根，不复制范围逻辑
- [ ] 既有群组场景全部通过；disable 群组行后群组工具与群组根缺席，私有/公有文件与脚本仍工作
- [ ] 群组包带最小 `meta` 与 dsh semver peer 声明
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [bundle 成为产品包集合的唯一权威](https://github.com/eafen405/OurFairy/issues/96)
