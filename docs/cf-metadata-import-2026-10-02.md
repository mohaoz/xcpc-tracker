# CF 题单增补与历史映射修正（2026-10-02）

本轮目录为 259 场、3193 题。相对 0.8.3 新增贵州 2025 一场 13 题；四川及三场历史比赛只纠正来源，不更改原有内部 ID、原题序、主标题或 QOJ 映射。公开仓库只保留必要的事实、链接和哈希，不包含用户保存的网页脚本、账号字段、令牌或完整原题册。

## 四川与贵州

用户 CF API 导出中，103117 有 12 题，615540 有 13 题，695551 返回不可用。后者只有未核实的第三方线索，仍排除，不能解释成必须加入比赛。

- 四川原题册共 13 题，原 C 为 Triangle Pendant、I 为 Monster Hunter、J 为 Ants。当前 CF C 是 Ants，且没有 J；因此把 `103117:C` 来源移到原 J，补 `103117:I`，原 C 保留原题身份而不合成 CF 链接。
- 贵州 615540 的 13 题与 RankLand 原赛、XCPC Rating 逐题一致。原赛时间为 2025-06-08 04:00 UTC；99 支正式队的明确奖项人数为 9/17/26，累计名次 9/26/52。SRK 标准缺省 `official=true` 的语义按固定版本逐项审核，原始文件未改写。
- 贵州榜单的总罚时是源规则规定的总值。不能用显示的逐题分钟之和替换，否则会制造不存在的铜牌边界并列。

回执：[四川映射](../fixtures/imports/codeforces/2026-10-02-mapping-review.json)、[贵州榜单](../fixtures/imports/rankland/2026-10-02-guizhou-review.json)、[贵州 Rating](../fixtures/imports/xcpc-rating/2026-10-02-guizhou-review.json)。

## 三场历史题单

用户保存的三份 Codeforces 首页共 38 题，字母和标题的链接均指向同一精确题目 ID。首页所链接的原比赛 PDF 独立证明原题序；37 个标题完全一致，2017 I 仅撇号样式不同。匹配使用主标题和原题册，不使用已污染的错误别名。

| 来源 | 原题序与 CF 镜像的关系 |
| --- | --- |
| [2016 China Final 原题册](https://codeforces.com/gym/101194/attachments/download/5009/20162017-acmicpc-china-final-en.pdf) | 原 A→CF L、C→A、D→H、H→D、L→C；其余一致 |
| [2017 EC Final 原题册](https://codeforces.com/gym/101775/attachments/download/6913/20172018-asia-east-continent-league-final-en.pdf) | 原 A→CF M、M→A；其余一致 |
| [2018 青岛现场赛原题册](https://codeforces.com/gym/104270/attachments/download/19460/contest-en.pdf) | 原 A–M 与 104270 A–M 一致；104566 为另一场网赛 |

据此撤回现场赛 A–K 上 11 条错误的 `104566` 来源，保留其网赛记录；转移两场 Final 的 7 条 CF 来源，删除合计 18 个跨题错误别名。受影响 18 题没有 Rating、tags 或 XCPC Rating 来源字段，不存在本次需撤回的此类值。完整旧值、新值、原 PDF 页码、输入哈希及对应表见 [历史映射回执](../fixtures/imports/codeforces/2026-10-02-historical-mapping-review.json)。原网页保存时间无法可靠确定，不将用户文件标记成新获取的 API 响应。

## 导入与状态边界

CF 字母可能与原题不同；导入器不能靠同字母新增来源或把另一道题名当别名。完整输入必须具有明确目标、唯一且一致的题目身份；重复归属和不完整输入在写入前拒绝。合法的跨场共题须明确审核多个目标。四川少一题是绑定具体已审核身份的例外，不扩大成通用部分题单豁免。

修复后的目录决定未来 CF 同步写入哪个题目。历史状态不保证保留了原始 provider problem ID 或当时的手动映射记录，因此一次成功的新同步不能证明旧状态应该被删除或搬走。本轮不升级 IndexedDB，不触碰用户数据库，也不自动迁移旧状态；后续若设计状态纠错，必须有逐条身份依据、歧义保留和可逆恢复。

离线回归涵盖 38 条首页映射及 11 条青岛网赛映射，旧目录负向对照必须重现 18 个错误；另有导入器冲突、部分输入、原子失败、顺序与幂等回归。正式构建继续验证 schema、来源、成员状态、生成数据和静态站点。
