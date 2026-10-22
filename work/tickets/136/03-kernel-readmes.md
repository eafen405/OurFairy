## Parent

#136

## What to build

两个产品内核包 `backend/identity` 与 `backend/sessions` 目前没有 README，而它们的 `files` 已经列出 `README.md`。补齐这两份 README，并把「`files` 里的每个条目都必须发布真实存在的文件」变成可执行检查。

README 内容限于：该包拥有什么、不拥有什么、依赖哪些 dsh 接缝、对外暴露的服务名。不复述行配置，不复述测试清单。若某个包「拥有什么」难以一句话说清，记录下来，不要在 README 里绕过去。

检查放在 `tests/bundle-packages.test.mjs`：遍历 `backend/` 下每个带 `package.json` 的包，对 `files` 的每个条目确认它至少发布一个真实存在的文件。glob（如 `locale/*.json`）必须命中至少一个文件；目录必须存在且其下至少有一个文件。这是清单加文件系统的检查，不读源码文本。

先写检查让它因 `identity`、`sessions` 的 README 缺失而失败，再补 README 让它通过。

## Acceptance criteria

- [ ] `backend/identity/README.md` 与 `backend/sessions/README.md` 存在，各写明拥有/不拥有、依赖的 dsh 接缝、暴露的服务名
- [ ] `tests/bundle-packages.test.mjs` 新增用例：每个产品包 `files` 的每个条目至少发布一个存在的文件
- [ ] 新用例在补 README 前因 identity/sessions 失败，补后通过
- [ ] `node --test tests/docs.test.mjs` 通过（新 README 的相对链接可解析）
- [ ] 未新增扫描源码文本的检查
- [ ] 不改动任何运行时代码

## Blocked by

None (can start immediately).
