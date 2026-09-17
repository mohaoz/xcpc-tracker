# 数据维护与验证

XCPCIO 缺口补录：保存目标比赛的 `config/team/run.json` 后，使用 `node scripts/apply-xcpcio-gaps.mjs <缓存目录>`。只补缺失牌线，不修改来源；正式组不明则阻止应用。证据记录在 `fixtures/imports/xcpcio-2026-gap-awards.json`；`scripts/validate-xcpcio-gaps.mjs` 校验 CE 不计罚时、秒级累加取整和奖牌配置优先级。该补录脚本会重写审核附件，重跑前保留原附件并审查差异，不能把已应用条目不再进入缺口集合误当成证据可以删除。

无奖牌配置的榜单估算：`node scripts/build-medal-estimates.mjs <已审核 SRK 缓存目录>`，结果写入独立的 `estimatedAwardCutoffs`，跳过原因保存在审核附件。浏览器管理页默认开启估算，也同时控制原目录已有的比例估算牌线。

已审核题目的 Rating 补充：`node scripts/enrich-reviewed-ratings.mjs <原始 problems-index.json>`。该命令核对已保存审核包的原始文件 SHA，仅按已有来源映射写入有限非负数值；冲突与缺失不估算。

所有脚本只用于构建或维护，正常使用不依赖它们。`catalog/default-catalog.min.json` 是正式数据，不能用旧抓取结果覆盖重建。

## 日常命令

```sh
npm run catalog:refresh        # 校验现有目录并生成静态资产，无网络获取
npm run deploy:build           # Schema、来源、CF/QOJ、覆盖与状态回归，静态构建
npm run vp:browser             # 已启动本地服务器时运行真实浏览器回归
```

`catalog:generate-default`、`catalog:build-final` 等旧脚本仅用于显式迁移。运行前备份并审查输出；它们不在日常刷新或部署链路中。

## XCPC Rating

```sh
npm run catalog:rating -- fetch tmp/sources/rating-problems.json
npm run catalog:rating -- inspect tmp/sources/rating-problems.json tmp/sources/rating-review.json
# 审查匹配与未匹配条目，添加 review: {status:"approved", reviewed_by:"..."}
npm run catalog:rating -- apply tmp/sources/rating-problems.json tmp/sources/rating-review.json
```

审核包绑定输入和 catalog 的 SHA256。按 provider problem ID 加题名，或完整比赛映射加题号／题名匹配；相同题单不能自动认定为同一榜单。仅提升社区标签与整场补题链接；不改变成员状态、内部 ID 或逐题交互。

## RankLand

刷新已有映射：`node scripts/refresh-standings-audit.mjs <新的缓存目录>` 获取当前 SRK 提交、逐场页面及 Board 目录／配置，缺失牌线的 Board 比赛另外获取 team/run。该命令仅写缓存和审核报告；`--offline` 使用已下载数据重算。核对身份、题号、日期、组别和审核报告后，`node scripts/apply-standings-refresh.mjs <缓存目录> <新的审核附件路径>` 仅补缺失的 RankLand 牌线，不覆盖既有奖项或默认来源。已发布目录 SHA 和原始文件 SHA 必须仍与审核一致。新增映射及旧值冲突继续单独审核，不能运行旧 Board 的全量 apply 来覆盖迁移结果。

2026-09-17 修正了封榜时长被当作当前封榜状态的问题，详见 `fixtures/imports/rankland/2026-09-17-refresh.json`；旧审核附件保留作为历史，不再代表最新缺口原因。

官方比例规则补录见 `fixtures/imports/rankland/2026-09-17-official-ratios.json`；南昌及女生赛按 SRK 的累计比例、默认 ceil 计算，来源仍为 explicit。`node scripts/audit-estimate-eligibility.mjs <刷新缓存>` 联网核验现有估算的正式队范围，`--offline` 复用缓存，仅生成报告；审核后用 `node scripts/apply-estimate-eligibility-audit.mjs <报告> <新附件>` 撤下无法证明资格的估算，旧值完整保存在附件中。首轮 `2026-09-17-estimate-eligibility.json` 后继续做了 `2026-09-17-highest-group-audit.json` 最高组核查；当前完整缺口与替换结果见[待办清单](../docs/contest-update-todo.md#当前牌线缺口2026-09-17)。不得从历史输入重新引入全榜、跨组或 CF Gym 练习队伍估算。

```sh
npm run catalog:rankland -- fetch tmp/sources/srk tmp/sources/rating-review.json
npm run catalog:rankland -- inspect tmp/sources/srk tmp/sources/rating-review.json tmp/sources/rankland-review.json
# 审查 .audit.json，按 schemas/rankland-review.schema.json 批准精确映射
# 单独填写 tmp/sources/rankland-review.json.awards.json，使用 rankland-award-review Schema
npm run catalog:rankland -- apply tmp/sources/srk tmp/sources/rating-review.json tmp/sources/rankland-review.json
```

固定提交在 `import-rankland-standings.mjs` 中；升级时使用新的缓存目录并重新审核。获取只处理候选榜单，失败保留上次数据；检查默认只输出报告。apply 校验原始内容哈希、页面身份、题数／题号、日期和审核绑定后原子写入。重复应用结果相同；CLI 面对已变化目录会要求重新审核。

只提升明确官方金银铜名额或支持的官方比例规则、完整终榜、资格明确、单位可解释、无边界并列的结果。多组取最高组：邀请赛优于省赛，本科优于高职；未知层级保持 blocked。新旧数值有未解释差异时保留审核证据。旧 XCPCIO 刷新跳过已迁移 RankLand 比赛，CF Gym 不提供现场奖牌估算。

`fixtures/imports/rankland/2026-09-*` 保存本次映射审核、奖牌审核、全目录处理结论、差异和纠错证据；Rating 快照的哈希和逐题匹配在其目录中。大型原始 SRK 不入库。合成 fixture 明确用于测试，不得正式应用。AGPL 数据署名和许可证随公开 catalog 发布。

## CF / QOJ

`catalog:import-reviewed-cf-problems` 和 `catalog:import-reviewed-qoj-problems` 应用各自命令指定的审核题单；后者只导入原八场 QOJ 批次。网络赛 II 使用 `node scripts/import-qoj-problems-export.mjs fixtures/imports/qoj/2026-online-ii-problem-list.json`。`catalog:check-reviewed-qoj-problems` 同时校验两个批次；`catalog:check-*` 离线检查映射完整及重复导入无变更，不写入目录。导出含 `target_contest(s)` 时才允许添加已有完整题单的新比赛。

新增 QOJ 题单：在用户自己的浏览器登录 QOJ，运行下述单场或批量导出脚本；批量导出需选择本次候选 URL 清单。审核返回 JSON 中的比赛身份、题号、标题、链接和版本后，补充明确目标，再调用 `scripts/import-qoj-problems-export.mjs <已审核 JSON>`。`catalog:refresh` 只验证与生成资产，不执行导入或联网抓取。

QOJ 使用用户浏览器中的 `browser-fetch-current-contest-problems.mjs` 或 `browser-fetch-qoj-problems.mjs` 导出，必须保留 `?v=` 版本。空题单、登录跳转、版本丢失需要重新导出。排除证据位于 `fixtures/imports/qoj/qoj-problem-import-exclusions.json`，不能绕过。无题单候选保留在 `docs/`。
