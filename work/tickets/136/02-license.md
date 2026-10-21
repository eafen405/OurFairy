## Parent

#136

## What to build

每个产品包的清单在 `license` 字段上一致。`backend/search` 与 `backend/spaces` 的 `package.json` 目前没有 `license`，其余产品包均为 `UNLICENSED`；补齐这两个，使许可证扫描不需要例外清单。

本票只改清单字段，不改运行时代码。

## Acceptance criteria

- [ ] `backend/search/package.json` 声明 `"license": "UNLICENSED"`
- [ ] `backend/spaces/package.json` 声明 `"license": "UNLICENSED"`
- [ ] `backend/` 下每个带 `package.json` 的包都声明同一个 `license` 值
- [ ] 清单仍是合法 JSON，包名、exports、files、peerDependencies 不变
- [ ] 不改动任何运行时代码

## Blocked by

None (can start immediately).
