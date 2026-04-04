# scripts

构建期和数据整理脚本放在这里。

当前保留的职责：

- 生成 `data/final.json`
- 生成 `catalog/default-catalog.min.json`
- 给无年份的 Codeforces 比赛补 `year` 标签
- 校验内置 catalog

正常产品运行不依赖这些脚本。

当前命令：

- `npm run catalog:validate`
- `npm run catalog:build-final`
- `npm run catalog:fetch-cf-problems`
- `npm run catalog:import-qoj-problems`
- `npm run catalog:generate-default`
- `npm run catalog:refresh`

当前流程：

1. 在浏览器里运行 `browser-fetch-contests.mjs` 生成候选 `result.json`
2. 将导出的 `contests.json` 放到 `data/contests.json`
3. `npm run catalog:build-final` 生成 `data/final.json`
4. `npm run catalog:generate-default` 生成 `catalog/default-catalog.min.json`
5. 或直接运行 `npm run catalog:refresh`

额外浏览器脚本：

- `browser-fetch-current-contest-problems.mjs`
  在当前的 QOJ 或 Codeforces 比赛页控制台运行，导出该场比赛的题目数组 JSON
- `browser-fetch-qoj-problems.mjs`
  在 QOJ 浏览器控制台运行，选择 `data/final.json` 或 `data/contests.json`，一次抓取全部 QOJ 比赛题目并导出简单数组 JSON

额外 Node 脚本：

- `fetch-codeforces-problems.mjs`
  在本地用 Codeforces API 一次抓取全部 Codeforces 比赛题目，默认读取 `data/final.json`，输出到 `data/codeforces-problems.json`
- `import-codeforces-problems-export.mjs`
  将 `data/codeforces-problems.json` 并进 `catalog/default-catalog.min.json`
- `import-qoj-problems-export.mjs`
  将 `a.json` 这类 QOJ 题目导出并进 `catalog/default-catalog.min.json`

保留脚本：

- `browser-fetch-contests.mjs`
- `browser-fetch-current-contest-problems.mjs`
- `browser-fetch-qoj-problems.mjs`
- `filter-contests.cjs`
- `filter-rules.cjs`
- `build-final-json.mjs`
- `fetch-codeforces-problems.mjs`
- `import-codeforces-problems-export.mjs`
- `import-qoj-problems-export.mjs`
- `rebuild-catalog-from-result.mjs`
- `fetch-codeforces-undated-contest-times.mjs`
- `apply-codeforces-undated-years.mjs`
- `generate-default-catalog.mjs`
- `catalog-lib.ts`
- `validate-catalog.ts`

CI：

- `.github/workflows/static-catalog.yml` 会校验 catalog 并构建前端
