# RankLand 迁移 Schema 设计

日期：2026-09-09。状态：v1 构建期契约；本批不迁移榜单、不修改 catalog 或 IndexedDB。

对应 [迁移计划](rankland-migration-plan.md)。契约采用 JSON Schema Draft 2020-12；所有新持久化字段使用 snake_case。上游原始 SRK 仍使用其自身 Schema，本契约描述本项目的审核材料，不重新定义 SRK。

## 三类契约

| Schema | 责任 |
| --- | --- |
| `rankland-source.schema.json` | 一个 SRK 文件的上游身份、固定提交、内容哈希、目录证据、已核验页面链接和署名信息 |
| `rankland-review.schema.json` | 比赛候选、匹配理由、审核结论；approved 才包含明确的内部目标与默认入口选择 |
| `rankland-award-review.schema.json` | 绑定已审核映射的奖牌线提案、目标组、参评规则、单位、最终榜单和计算证据 |

来源身份取 `srk:<srk_path>`，例如 `srk:official/icpc/icpc2026/example.srk.json`。完整路径包含集合名，避免重名文件冲突；这不是 RankLand 数据库 ID。目录重命名时进入重新审核，不自行改写本站内部 ID。页面链接单独核验，禁止由路径臆造数据库 ID。

`commit_sha` 固定 Git 提交，`content_sha256` 绑定原始 SRK 字节，`index_sha256` 绑定同提交目录配置。`catalog_sha256` 绑定审核时 canonical catalog 原始字节。任何一个输入改变都应重审／重新生成；初版采用全目录哈希失效规则，宁可多一次审核，也不静默复用过期批准。

## 审核状态与安全边界

- `pending` / `conflict`：保留候选内部 ID 和证据，禁止 `selection`、`review`。
- `approved`：必须有审核人、时间、理由及 `selection`；选择已有 `contest_id`，并明确是否提升为默认入口。
- `rejected`：必须有审核信息，禁止 `selection`，保留拒绝理由。
- 奖牌线 `blocked`：只记录不能计算的原因，禁止 `result` 和批准信息。
- 奖牌线 `proposed`：包含可复核结果，尚不可应用。
- 奖牌线 `approved`：必须有结果和独立审核信息；比赛链接批准不等于奖牌线批准。

fixture 顶层 `synthetic: true` 明确标记示例，永远不能用于正式应用。JSON 校验通过不代表上游真实、匹配正确或获得发布授权。此阶段只提供验证器，不提供 apply 命令。

## 奖牌线语义

首版只表达 `official_awards`（明确获奖记录）和 `official_medal_config`（有证据的官方名额配置）。暂不允许按比例估算，继续保留已有估算数据的兼容读取；以后新增估算方法须升级契约并补测试。

`group` 使用显式 `all_eligible` 或 `selected`。selected 必须给出源分组 ID 和人工解释；两种情况均记录资格判定、排除规则、并列处理及 SRK 字段位置／配置依据。不能把“所有行”默认视为正式参赛队。

结果统一 `penalty_unit: minutes`，值可以是非负小数；`source_penalty_unit` 与 `normalization_notes` 记录转换依据。`rank` 是所选参评集合中按最终排序得到的 1-based 位置；`team_id` 是边界队伍的源 ID。金银铜必须各有对象或 null，null 表示该组没有该奖项，并在 `missing_medals_reason` 解释。全部 null 不允许批准为有效计算结果。

`standings_state: final` 仅允许完整、已解封且资格规则可解释的最终结果。封榜、残缺、未知规则一律 blocked。SRK 适配器需要检验这一事实，不能仅信任手填字段。

## JSON Schema 与跨记录验证

JSON Schema 检查结构、枚举、URI／时间格式、路径、哈希格式及状态分支。配套离线验证器补充：

- provider ID 必须等于 `srk:` + 完整文件路径，路径必须属于对应 collection。
- 页面只允许已定义 RankLand 主机与榜单路由；合集入口必须且只能有一个非空 rankId。
- 一份审核包内 entry_id、上游源身份唯一；一个目标最多批准一个默认榜单。
- approved 的目标必须出现在候选列表；奖牌线必须引用 approved 映射，且目标、catalog 哈希及源文件哈希一致。
- 正整数人数、奖牌线名次不超过人数／递增、解题数不超过题数／不递增、边界队伍不重复、null 奖项有解释。

实际应用前还必须读取 catalog 和 SRK：验证目标存在、题单完整，核验所有哈希、提交与路径可解析、上游版本受支持、分组实际存在、边界队伍／排名和完整题目映射正确。跨记录验证器不声称完成这些文件内容核验。

## 与现有模型的兼容

审核批准后，未来适配器可将 `selection.contest_id` 定位到现有 `contestId`；来源映射为 `provider=rankland`、`kind=standings`、`url=page_url`、`provider_contest_id`、`source_title`、`label=RankLand`。原始下载 URL、审核人和大体积证据留在构建期材料中。

奖牌线未来映射到既有 `awardCutoffs`：`source=explicit`、`sourceProvider=rankland`、`sourceUrl=page_url`、`eligibleTeamCount` 及边界 `teamId` 等。完整方法与分组证据通过审核文件追溯，不冒用旧来源。

`make_default` 目前只是审核意图。现有 catalog 尚无明确的默认榜单持久化契约，实施 P1 时需设计可保存该选择的可选字段及前端选择器，不能靠 sources 数组顺序暗示优先级。多组同时展示、证据进入公开摘要也须先扩展 catalog Schema 与导入／导出契约。

现有 `contest.schema.json` 描述 nested bundle，不完整覆盖扁平 catalog 中的 `awardCutoffs`。本批不假装把新 Schema 接进去就解决旧验证缺口；实施 P2 时须增加真实快照／奖牌线校验，避免归一化时丢字段导致假通过。

## 示例与验证

`fixtures/imports/rankland/` 保存合成示例：完整的审核包（四种状态）、奖牌线包（三种状态）。示例 ID、哈希、URL 参数及审核人均为虚构契约测试数据，不代表上游核验结果。

```sh
python3 -m venv /tmp/xcpc-schema-venv
/tmp/xcpc-schema-venv/bin/pip install -r scripts/requirements-schema.txt
/tmp/xcpc-schema-venv/bin/python scripts/validate-rankland-schemas.py
```

验证包含 Schema 自检、示例及故意破坏状态／证据／边界的负例。安装完成后验证过程不访问网络。这是设计期独立检查，尚未接入默认 Node CI；RankLand apply 上线前必须将等价校验接入部署流程。本批不新增运行时 Python 依赖。

参考：[JSON Schema 验证规范](https://json-schema.org/draft/2020-12/json-schema-validation)、[SRK 格式与 Schema](https://github.com/algoux/standard-ranklist)、[SRK 合集](https://github.com/algoux/srk-collection)。
