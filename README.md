# XCPC Tracker

[在线使用](https://mohaoz.github.io/xcpc-tracker/) · 面向 ACMer 的整场 VP 选题工具。

选择队员，按年份、地区、赛事标签和成员覆盖筛选比赛，再通过现有整场补题链接开始 VP。数据保存在当前浏览器，无需登录本站。

本站接入 Cloudflare Web Analytics 统计访问情况；应用不会主动向统计脚本传入成员数据、导入内容或 API 凭据。

## 使用

- **未做**：所选成员都没有尝试或通过本场任何题目；任何尝试都算已触及。
- **非剧透／剧透**：在详情页标题区通过开关逐场切换，列表不单独显示状态按钮。所有有效成员均无尝试或通过记录时默认非剧透，否则默认剧透；手动选择优先，刷新后保留。打开详情和改变成员筛选不改变默认判定。
- 非剧透隐藏牌线、奖牌信息、题目标签和 Rating，奖牌搜索条件也不匹配这些比赛。普通比赛信息、成员覆盖和整场补题链接仍可使用。
- 剧透模式可查看参考牌线与题目标签。多组别取最高组别，邀请赛兼省赛取邀请赛组；牌线只用于 VP 选题参考，不代表个人真实获奖。
- CF 成员状态通过浏览器直接访问官方 API 同步；QOJ 默认手动导入，复制脚本、打开 QOJ、粘贴或上传 JSON 均在同一弹窗完成。也可按首次提示的帮助安装油猴脚本，在管理页开启「使用 QOJ 油猴脚本」，统一用于添加成员和更新记录。开启「自动同步」也会启用 QOJ 油猴模式，统一并行更新 CF 与 QOJ，页面可见时按 30 分钟新鲜度检查；登录和验证需自行完成。失败不会清空上次成功状态。
- 在管理页导出成员数据作为备份，备份包含手动剧透设置和比例估算设置。浏览器之间不会自动同步。
- 管理页可批量开启／关闭当前全部比赛的剧透，默认不强制全部剧透。比例估算默认开启，可手动关闭；无奖牌配置时按金银铜各 10% / 20% / 30% 估算，不完整榜单或组别不明时不估算。详情上方热力图按成员为行、题目为列，下方标签与 CF 配色 Rating 分列。

## 数据

正式目录为 `catalog/default-catalog.min.json`。原有 CF、QOJ、XCPCIO 等来源继续保留；RankLand 提供核验后的榜单与部分牌线，XCPC Rating problems 提供标签、Rating 及整场补题链接候选。不会根据现场成绩推断成员个人做题状态。

目录内容以正式 JSON 为准，版本更新见 [CHANGELOG.md](CHANGELOG.md)。缺数据、组别不明或来源冲突时保留明确回退；标签来自社区，可能有误。

来源及许可见 [catalog/README.md](catalog/README.md)。数据审核证据在 `fixtures/imports/rankland/` 和 `fixtures/imports/xcpc-rating/`；没有完整题单的候选仅保留在维护文档中，不发布到站点。

## 开发与发布

```sh
npm ci
npm ci --prefix web
npm run deploy:build
npm run dev --prefix web
```

`catalog:refresh` 只校验当前正式目录并生成静态资产，不重建或抓取上游。更新数据参见 [scripts/README.md](scripts/README.md)。

`main` 为开发主分支，`release` 标记线上发布版本。所有修改先进入 main，发布时将 release 快进到 main 的同一提交，不再单独修改 release 或产生发布合并提交；未发布时 main 可以领先。两个分支发布时内容一致，网站包含哪些文件由构建决定。推送 release 后 GitHub Actions 自动发布到现有 Pages，使用 `/xcpc-tracker/` 路径和 hash 路由。纯静态运行，不需要本地后端。

浏览器回归：生成静态资产并启动开发服务器后，执行 `npx playwright install chromium` 和 `npm run vp:browser`。默认构建只运行离线校验。
