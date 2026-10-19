## Parent

[#74 Android 长回复呈现性能：设备基线、热点定位与受控优化](https://github.com/eafen405/OurFairy/issues/74)

## What to build

把本轮改动纳入版本组合并收口：更新 `combo.json` 的客户端锁定提交、在证据索引登记目录、把基线/门槛/原始数据与未完成项交给 #45，并按 issue tracker 的关闭方式结束本票。只改文档或测量记录时也要说明是否影响既有组合。

## Acceptance criteria

- [ ] `combo.json` 反映本轮合并后的客户端提交，`npm run combo:verify` 通过
- [ ] 证据索引与本票证据目录互相可达，链接可解析
- [ ] #45 交接说明包含基线、门槛、原始数据与未执行项
- [ ] 父票 #23 的正文、标题与状态未被修改

## Blocked by

- 热点判定与受控优化票
