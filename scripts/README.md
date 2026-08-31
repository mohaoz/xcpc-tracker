# scripts

构建期和数据整理脚本放在这里。

当前保留的职责：

- 生成 `data/final.json`
- 生成 `catalog/default-catalog.min.json`
- 给无年份的 Codeforces 比赛补 `year` 标签
- 匹配 XCPCIO Board standings 到默认 catalog，并在部署前预计算奖牌线
- 对没有 XCPCIO Board cutoff 的 Codeforces 比赛，用 Codeforces API 的 official standings 预计算 fallback 奖牌线
- 导入 QOJ / Codeforces 抓到的题目列表
- 校验内置 catalog
- 校验成员页生成的 QOJ 批量控制台脚本及其导入 fixture

正常产品运行不依赖这些脚本。

当前命令：

- `npm run catalog:validate`
- `npm run catalog:build-final`
- `npm run catalog:fetch-cf-problems`
- `npm run catalog:check-reviewed-cf-problems`
- `npm run catalog:check-qoj-problems`
- `npm run catalog:import-cf-problems`
- `npm run catalog:import-reviewed-cf-problems`
- `npm run catalog:import-qoj-problems`
- `npm run catalog:match-xcpcio-board`
- `npm run catalog:refresh-xcpcio-board`
- `npm run catalog:refresh-codeforces-award-cutoffs`
- `npm run catalog:generate-default`
- `npm run catalog:refresh`
- `npm run qoj:validate-member-script`

当前流程：

1. 在浏览器里运行 `browser-fetch-contests.mjs` 生成候选 `result.json`
2. 将导出的 `contests.json` 放到 `data/contests.json`
3. `npm run catalog:build-final` 生成 `data/final.json`
4. `npm run catalog:generate-default` 生成 `catalog/default-catalog.min.json`
5. `npm run catalog:import-qoj-problems` 将已保存的两份 QOJ 题单快照合并到现有 catalog；导入按完整 contest URL 优先匹配，仅在路径目标唯一时回退，并跳过审核文件中明确隔离的错误快照
6. `npm run catalog:import-reviewed-cf-problems` 合并维护者已核验的 Codeforces 比赛元数据与题单
7. `npm run catalog:refresh-xcpcio-board` 匹配 XCPCIO Board 并预计算奖牌线
8. `npm run catalog:refresh-codeforces-award-cutoffs` 用 Codeforces official standings 补齐仍无 cutoff 的 Codeforces 比赛
9. `npm run catalog:generate-web-assets` 在 catalog 更新完成后生成前端资产
10. `npm run catalog:check-qoj-problems` 与 `npm run catalog:check-reviewed-cf-problems` 只读检查已审核映射是否完整、导入是否幂等；`npm run catalog:validate` 会同时运行两项检查

额外浏览器脚本：

- `browser-fetch-current-contest-problems.mjs`
  在当前的 QOJ 或 Codeforces 比赛页控制台运行，导出该场比赛的题目数组 JSON
- `browser-fetch-qoj-problems.mjs`
  在 QOJ 浏览器控制台运行，选择 `data/final.json` 或 `data/contests.json`，一次抓取全部 QOJ 比赛题目并导出简单数组 JSON。抓取时保留 contest URL 的 `?v=` 参数；QOJ 同一 contest id 的不同版本可能对应不同题单，不能退化为无查询参数的页面。

额外 Node 脚本：

- `fetch-codeforces-problems.mjs`
  在本地用 Codeforces API 一次抓取全部 Codeforces 比赛题目，默认读取 `data/final.json`，输出到 `data/codeforces-problems.json`
- `import-codeforces-problems-export.mjs`
  将 `data/codeforces-problems.json` 并进 `catalog/default-catalog.min.json`。导入记录可带 `target_contest_ids`，也可带完整 `target_contests` 以原子方式新建比赛及其题单；一个 Codeforces Gym 可显式映射多个目录比赛。`--check` 会只读检查导入是否已完整、幂等地落入目录。维护者核验的 2026 比赛与题单位于 `fixtures/imports/codeforces/2026-xcpc-problem-lists.json`。
- `import-qoj-problems-export.mjs`
  将 `data/qoj-problems-a.json` / `data/qoj-problems-b.json` 这类 QOJ 题目导出并进 `catalog/default-catalog.min.json`。默认审核排除项位于 `fixtures/imports/qoj/qoj-problem-import-exclusions.json`，用于保留错误快照的证据但阻止其污染正式目录；`--check` 仅检查，不写文件。
- `match-xcpcio-board-contests.mjs`
  XCPCIO Board 的构建期数据管线。`--fetch-raw --normalize` 会先保存原始 board index 到 `data/xcpcio-board-raw.json`，再生成与主 contest 流程一致的 `[{ title, url }]` 风格规范化文件 `data/xcpcio-board-contests.json`；默认匹配阶段读取这个规范化文件并给 title 打 tags。加 `--apply` 会把 high confidence 的 `xcpcio_board` standings source 合并进已有 catalog 比赛；加 `--fetch-cutoffs` 会在构建期读取 board standings 数据，按官方 medal 配置或 10% / 20% / 30% 奖牌数量预计算金银铜线，保存到 `data/xcpcio-board-award-cutoffs.json` 并写入 catalog。该脚本不会新增无题目比赛。前端只读取 catalog 里的 `awardCutoffs`，不会请求 board 数据。若要写入 medium 匹配，显式传 `--apply-confidence=high,medium` 后再人工复核 diff。
- `fetch-codeforces-award-cutoffs.mjs`
  Codeforces fallback 奖牌线管线。默认处理仍没有 `awardCutoffs` 且带 Codeforces contest source 的比赛，并重新刷新已有的 Codeforces fallback；通过 Codeforces `contest.standings` API 拉取 `showUnofficial=false` 的 official standings，再按 10% / 20% / 30% 奖牌数量预计算金银铜线，保存到 `data/codeforces-award-cutoffs.json` 并在 `--apply` 时写回 catalog。前端不会请求 Codeforces standings。
- `validate-qoj-member-script.mjs`
  转译成员页的 QOJ 脚本生成器，检查单账号和批量脚本的 JavaScript 语法、批量 fixture 契约，以及同一 Handle 关联多个本地成员时的防护。`npm run deploy:build` 会自动执行。

保留脚本：

- `browser-fetch-contests.mjs`
- `browser-fetch-current-contest-problems.mjs`
- `browser-fetch-qoj-problems.mjs`
- `filter-contests.cjs`
- `filter-rules.cjs`
- `build-final-json.mjs`
- `fetch-codeforces-problems.mjs`
- `fetch-codeforces-award-cutoffs.mjs`
- `import-codeforces-problems-export.mjs`
- `import-qoj-problems-export.mjs`
- `rebuild-catalog-from-result.mjs`
- `fetch-codeforces-undated-contest-times.mjs`
- `apply-codeforces-undated-years.mjs`
- `generate-default-catalog.mjs`
- `match-xcpcio-board-contests.mjs`
- `catalog-lib.ts`
- `validate-catalog.ts`
- `validate-qoj-member-script.mjs`

CI：

- 部署构建只运行 `npm run deploy:build`，消费仓库里已经提交的 catalog / data，不会在部署时重新抓 XCPCIO Board 或 Codeforces
- 如果要更新奖牌线数据，先手动运行 `npm run catalog:refresh-xcpcio-board` 和 `npm run catalog:refresh-codeforces-award-cutoffs`，确认 diff 后再提交
- `.github/workflows/static-catalog.yml` 现在只校验 catalog 并构建前端，不再在 CI 里刷新外部数据
- QOJ 题号映射属于已发布 catalog 的一部分；如果保存的审核快照能为某题补充 QOJ source，或某个未隔离的 QOJ catalog 场次仍有题目缺少 QOJ source，校验会失败，避免只保留 Codeforces source 而导致成员状态无法匹配
