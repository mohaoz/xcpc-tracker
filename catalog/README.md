# 正式目录与来源

`default-catalog.min.json` 是唯一正式目录；完整字段契约见 [catalog-snapshot.schema.json](../schemas/catalog-snapshot.schema.json)。它是平铺快照：`contests[]` 通过 `problemIds` 引用 `problems[]`，不是旧的嵌套 bundle。

比赛可含 `awardCutoffs` 和 `estimatedAwardCutoffs`；题目可含 `tags` 和 `rating`。来源保存在 `sources`，保留 provider 映射、上游标题及可选版本信息；牌线自身保留 `sourceProvider/sourceLabel/sourceUrl`。沿用现有字段命名，不因通用命名偏好迁移 JSON。

发布必须有经审核的完整题单。其他数据约束见 [AGENTS.md](../AGENTS.md#catalog-and-import-contracts)，运行时使用方式见[架构说明](../docs/architecture.md)，导入、审核和验证命令见[维护说明](../scripts/README.md)。

## Attribution and data license

RankLand summaries derive from [algoUX / srk-collection](https://github.com/algoux/srk-collection), pinned at `a820e48181a28a1a30bfbcf965b320606e337e15`. Upstream contributors include XCPCIO and algoUX. The SRK-derived catalog data and its review evidence are provided under AGPL-3.0; see [LICENSE-SRK.txt](LICENSE-SRK.txt) and the editable catalog/source history in this repository. This data notice does not relicense unrelated application code.

Problem tags, ratings and whole-contest practice-link candidates come from [XCPC Rating](https://hei-maom.github.io/xcpcrating/#/problems), by [Hei-MaoM](https://github.com/Hei-MaoM/xcpcrating). Metadata provenance is recorded on problem sources; community tags and ratings are visible only in spoiler mode. CF/QOJ problem mappings remain authoritative for individual member coverage. Other source attributions remain attached to each contest/problem.
