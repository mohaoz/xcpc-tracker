# JSON Schema 入口

按数据类型选用，不需要每次任务读取所有 Schema：

- [catalog-snapshot.schema.json](catalog-snapshot.schema.json)：当前平铺正式目录，包括题目标签／Rating、来源默认项和两类牌线。
- [catalog-bundle.schema.json](catalog-bundle.schema.json) 与 [contest.schema.json](contest.schema.json)：旧嵌套目录及相关结构的验证契约，不是当前正式文件形状。
- [codeforces-import.schema.json](codeforces-import.schema.json)、[qoj-import.schema.json](qoj-import.schema.json)：对应原始导入样例的契约；浏览器实际接受的载荷还需遵循导入器类型和 fixture。
- [rankland-source.schema.json](rankland-source.schema.json)、[rankland-review.schema.json](rankland-review.schema.json)、[rankland-award-review.schema.json](rankland-award-review.schema.json)：上游 SRK、映射审核和牌线审核结构。

`npm run catalog:validate` 执行目录和来源校验；发布流程包含该检查。运行时 IndexedDB 数据由应用校验和迁移，版本说明见[架构文档](../docs/architecture.md#本地数据与剧透)。审核包中的合成样例只供测试，不能应用到正式目录。
