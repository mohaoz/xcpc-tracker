# XCPC Tracker

[在线使用](https://mohaoz.github.io/xcpc-tracker/) · 面向 ACMer 的整场 VP 选题工具。

选择队员，按年份、地区、赛事标签和成员覆盖筛选比赛，再通过现有整场补题链接开始 VP。数据保存在当前浏览器，无需登录本站。

## 使用

- **未做**：所选成员都没有尝试或通过本场任何题目；任何尝试都算已触及。
- **非剧透／剧透**：列表和详情都可以逐场切换。所有有效成员均无尝试或通过记录时默认非剧透，否则默认剧透；手动选择优先，刷新后保留。打开详情和改变成员筛选不改变默认判定。
- 非剧透隐藏牌线、奖牌信息、题目标签，奖牌搜索条件也不匹配这些比赛。普通比赛信息、成员覆盖和整场补题链接仍可使用。
- 剧透模式可查看参考牌线与题目标签。多组别取最高组别，邀请赛兼省赛取邀请赛组；牌线只用于 VP 选题参考，不代表个人真实获奖。
- CF 成员状态通过浏览器直接访问官方 API 同步；QOJ 使用成员页生成的浏览器脚本导出 JSON，再导入本站。关注最近同步时间和缺口提示，未匹配记录可能是目录外题目。
- 在管理页导出成员数据作为备份，备份包含手动剧透设置。浏览器之间不会自动同步。

## 数据

正式目录为 `catalog/default-catalog.min.json`。原有 CF、QOJ、XCPCIO 等来源继续保留；RankLand 提供核验后的榜单与部分牌线，XCPC Rating problems 提供标签及整场补题链接候选。不会根据现场成绩推断成员个人做题状态。

0.7.0 保留 246 场、3031 题，新增 139 场 RankLand 榜单、10 场已核验牌线和 1413 道题的社区标签。本批匹配的整场补题链接均已存在，因此没有重复添加。缺数据、组别不明或来源冲突时保留明确回退。标签来自社区，可能有误。

来源及许可见 [catalog/README.md](catalog/README.md)。数据审核证据在 `fixtures/imports/rankland/` 和 `fixtures/imports/xcpc-rating/`；没有完整题单的候选仅保留在维护文档中，不发布到站点。

## 开发与发布

```sh
npm ci
npm ci --prefix web
npm run deploy:build
npm run dev --prefix web
```

`catalog:refresh` 只校验当前正式目录并生成静态资产，不重建或抓取上游。更新数据参见 [scripts/README.md](scripts/README.md)。

`main` 为开发主分支，`release` 为发布分支；发布所需代码、数据、工具、Schema、许可与简要说明同步到 `release`。推送 `release` 后 GitHub Actions 自动发布到现有 Pages，使用 `/xcpc-tracker/` 路径和 hash 路由。纯静态运行，不需要本地后端。

浏览器回归：生成静态资产并启动开发服务器后，执行 `npx playwright install chromium` 和 `npm run vp:browser`。默认构建只运行离线校验。
