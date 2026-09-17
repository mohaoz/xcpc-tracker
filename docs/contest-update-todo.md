# 比赛补录与 QOJ 更新待办

本表维护 2025／2026 参考表的 49 条记录（24＋25），以及后续补录任务。最初对照基线是 2026-09-07 的 `104036c`；未勾选条目的题数、来源和日期可能仍反映该批次，应以[正式目录](../catalog/default-catalog.min.json)复核，不能直接据此覆盖现有数据。本次文档清理没有重新核验所有上游链接。

操作步骤统一见[数据维护说明](../scripts/README.md)；本页只记录候选、问题和完成证据。无完整题单的赛程候选另见[待补题单](2026-contests-pending-problem-lists.md)。日常 `catalog:refresh` 是离线校验与资产生成，不是联网抓取、导入或目录重建。

## 已完成批次

- 2026-09-08：黑龙江、福建邀请赛、重庆，3 场／39 题，见 [CF 审核题单](../fixtures/imports/codeforces/2026-xcpc-problem-lists.json)。
- 2026-09-09：网络赛 I、深圳、浙江、西安、武汉、山东、上海、沈阳，8 场／103 题，见 [QOJ 审核题单](../fixtures/imports/qoj/2026-xcpc-problem-lists.json)。带 `?v=` 的重试及空题单错误已修复；原始导出保存在同目录。
- 2026-09-14：网络赛 II，QOJ 4113 A–L 共 12 题，见 [用户保存页面的审核结果](../fixtures/imports/qoj/2026-online-ii-problem-list.json)。未导入保存页面中的个人状态。
- RankLand 榜单迁移及南昌错配修正见 [审核结论](../fixtures/imports/rankland/2026-09-audit.json)，后续 XCPCIO 补录及阻塞组别见 [补录证据](../fixtures/imports/xcpcio-2026-gap-awards.json)。版本变更见 [CHANGELOG](../CHANGELOG.md)。

西安保留 QOJ 3766 默认 Universal Cup 镜像题单，未替换为 `?v=1`。黑龙江参考表与 Gym 日期不同，现场日期仍待核验；重庆只记录已知日期，未推断开赛时刻。

## 当前牌线缺口（2026-09-17）

已补南昌、2025 CCPC 女生赛的官方比例规则；2025 东北邀请赛采用最高邀请赛组的官方名额；2018 焦作、沈阳改用原赛正式队估算。结果见[规则补录](../fixtures/imports/rankland/2026-09-17-official-ratios.json)、[可信替换](../fixtures/imports/rankland/2026-09-17-verified-replacements.json)。

当前有榜单来源但没有可发布牌线的比赛共 **24 场**，不能把“存在榜单”直接等同于“奖项可推断”：

| 原因 | 比赛 |
| --- | --- |
| 边界同解题数、同罚时，尚未审核并列奖牌规则（12 场） | 2018–2019 EC Final、2018–2019 徐州、2019 EC Final、2022 第六届河北省赛、2021 CCPC 哈尔滨、2023 ICPC 网络赛 I、2024 长春邀请赛／吉林第17届、2024 东北邀请赛／东北第18届、2024 CCPC 网络赛、2024 ICPC 网络赛 I、2024 ICPC 网络赛 II、2026 ICPC 网络赛 I |
| 逐题通过结果与总解题数冲突（1 场） | 2025 福建邀请赛／第12届福建省赛 |
| 缺少明确正式队资格标记（2 场） | 第15届吉林省赛、第18届吉林省赛；不能沿用全榜估算 |
| 最高组／资格映射不明确（2 场） | 第14届陕西省赛、2026 GBA |
| 旧估算混合高低组或未证明最高组（6 场） | 2023 第七届河北省赛、2020 第17届浙江省赛、2021 第18届浙江省赛、2022 第19届浙江省赛、2024 浙江省赛、2025 四川省赛；已有 SRK 镜像没有足够组别映射，不能用它重新生成全榜估算 |
| 当前只有未接入的 Pintia 榜单（1 场） | 2026 福州邀请赛／第13届福建省赛 |

此外，2018–2019 南京、2018–2019 China Multi-Provincial、2022 上海大学生赛、CCPC 2016–2017 Finals、2019 CCPC 哈尔滨这 5 场没有独立原赛榜单映射，其 CF Gym 估算也已撤下，不计入上述 24 场。Gym 的 CONTESTANT 不能证明原现场正式队身份。

首轮正式资格核验 77 条旧估算，撤下 13 条、其中 3 场获可靠替换；[最高组复核](../fixtures/imports/rankland/2026-09-17-highest-group-audit.json) 再撤下 7 条，其中 [2025 浙江替换为本科组官方牌线](../fixtures/imports/rankland/2026-09-17-highest-group-replacement.json)。当前保留 59 条正式队／组别核验后的比例估算。旧值与资格证据保存在[首轮审计附件](../fixtures/imports/rankland/2026-09-17-estimate-eligibility.json)及最高组复核附件中，不删除比赛、题目或个人记录。

## 参考与完成标准

- `26-行号` 对应 `/Users/mohao/Downloads/26赛季省赛邀请赛训练补题汇总.xlsx`，工作表 `工作表1`，数据范围 `A3:E26`。
- `25-行号` 对应 `/Users/mohao/Downloads/25赛季省赛邀请赛训练补题汇总.xlsx`，工作表 `工作表1`，数据范围 `A3:D27`。
- 原表 A 列为简称，B 列为官方名称及榜单超链接，C 列为日期，D 列为补题入口；下文日期按原表 Excel 日期转换，保留原始链接中的版本和分组参数。
- **新增候选**：参考链接尚未匹配到正确的已收录比赛，补录前仍需按标题、年份、别名排重。**已收录待复核**：已匹配到 catalog 记录，待核对题单、来源及尚缺的 QOJ 映射。**链接冲突待核验**：参考入口与比赛身份不一致。
- 复选框表示该条目的核验／补录工作完成；已收录的条目也须复核后再勾选。表格只提供比赛与补题入口，没有逐题列表。
- 新增比赛须连同复核后的题号、标题、题目链接及来源映射一起进入 catalog；已有比赛保留内部 ID，补充来源与别名。未取得完整题单的条目继续留在文档。
- 表中写着 `Gym / QOJ` 的单元格实际只包含一个 Gym 超链接，QOJ 入口另待核验。仅有牛客／PTA 的条目先保留候选与人工参考，不据此扩展运行时同步平台。
- 两个 Codeforces 邀请入口保留原表单元格位置，后续在有权限的账号下确认比赛 ID。

## 优先处理

- [x] **QOJ 4071：2026 ICPC 网络赛第一场**。比赛日期 2026-09-06，标题为 The 2026 ICPC Asia East Continent Online Contest (I)，入口为 [QOJ 4071](https://qoj.ac/contest/4071)。此前已从[公开分类](https://qoj.ac/category/763)确认 A–N 共 14 题；已按用户导出补录全部 14 题。
- [ ] **复核原表疑似错链**。`26-07`（CCPC 河南）和 `26-15`（东北地区赛）D 列显示 `QOJ`，实际都指向 Gym 106551，与 `26-10` 相同；当前 catalog 将该 Gym 映射至 2026 ICPC 南昌邀请赛。取得两场比赛的正确入口后再导入。
- [x] **修正 2025 南昌两场比赛的榜单错配**。CCPC 南昌已移除误挂的 ICPC 榜单，使用独立 RankLand 来源；审核证据见 [RankLand 审核目录](../fixtures/imports/rankland/)。不要重新挂回旧来源。

## 2026 赛季：24 条

- [x] **26-03 深圳邀请赛**（2026-04-11；已补录）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（深圳）](https://board.xcpcio.com/icpc/51st/shenzhen-invitational?group=official)。补题：[QOJ 3588?v=1](https://qoj.ac/contest/3588?v=1)。已补录 13 题，内部 ID 为 `fca291f3-d017-5cd3-9298-63a1b624b39e`。

- [x] **26-04 浙江省赛**（2026-04-25；已补录）
  名称／榜单：[「睿琪杯」浙江省第 23 届大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/zhejiang?group=undergraduate)。补题：[QOJ 3749?v=1](https://qoj.ac/contest/3749?v=1)。已补录 13 题，内部 ID 为 `a9098c59-44d3-5586-8b15-837d828f90b4`。

- [x] **26-05 西安邀请赛**（2026-05-02；已补录）
  名称／榜单：[第 51 届 ICPC 国际大学生程序设计竞赛邀请赛西安站](https://board.xcpcio.com/icpc/51st/xian-invitational?group=official)。补题：[QOJ 3766](https://qoj.ac/contest/3766)。已补录 14 题，内部 ID 为 `b6069f69-bc27-5966-a6e1-467028aebdcd`。

- [ ] **26-06 北京市赛**（2026-05-10；新增候选）
  名称／榜单：[2026年北京市大学生程序设计竞赛](https://pintia.cn/rankings/2048682058783719424)。原表补题入口待补充；待查找可靠题单。

- [ ] **26-07 CCPC河南省赛**（2026-05-10；链接冲突待核验）
  名称／榜单：[第 8 届 CCPC 河南省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/henan)。原表标 `QOJ`，实际链接为 [Gym 106551](https://codeforces.com/gym/106551)，与 ICPC 南昌冲突；先核验正确入口，再补齐题单。

- [ ] **26-08 黑龙江省赛**（原表日期 2026-05-10；已补录，日期／QOJ 待核验）
  名称／榜单：[第二十一届黑龙江省大学生程序设计竞赛](https://pintia.cn/rankings/2049414294076952576)。补题：[Gym 106534](https://codeforces.com/gym/106534)（原表标 `Gym / QOJ`）。2026-09-08 已补录 A–M 共 13 题及 PTA 榜单，内部 ID 为 `411cc95d-3733-5a0b-8806-ab17b43f8838`；因参考表与 Gym 日期不同，`startAt` 暂留空，待核验现场日期并补查 QOJ 来源。

- [ ] **26-09 陕西省赛**（2026-05-16；已收录待复核）
  名称／榜单：[第 14 届陕西省国际大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/shaanxi)。补题：[Gym 106532](https://codeforces.com/gym/106532)（原表标 `Gym / QOJ`）。catalog 已有 13 题；复核题单并补查 QOJ 映射。

- [ ] **26-10 ICPC南昌邀请赛**（2026-05-17；已收录待复核）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（南昌）暨江西省赛](https://board.xcpcio.com/icpc/51st/jiangxi-invitational)。补题：[Gym 106551](https://codeforces.com/gym/106551)。catalog 已有 13 题；复核来源，避免与 `26-07`、`26-15` 错配。

- [x] **26-11 武汉邀请赛**（2026-05-17；已补录）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（武汉）暨湖北省赛](https://board.xcpcio.com/icpc/51st/wuhan-invitational)。补题：[QOJ 3799?v=1](https://qoj.ac/contest/3799?v=1)。已补录 13 题，内部 ID 为 `b9a24afb-e623-5fd8-b97f-d7c71de3f8b6`。

- [ ] **26-12 江苏省赛/广东省赛**（2026-05-17；已收录待复核）
  名称／榜单：[2026 年江苏省大学生程序设计竞赛 / 广东省第二十三届大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/jiangsu?group=official)。补题：[Gym 106550](https://codeforces.com/gym/106550)（原表标 `Gym / QOJ`）。catalog 分为江苏、广东两场，各 12 题；复核共用题单及各自榜单，并补查 QOJ 映射。

- [ ] **26-13 吉林省赛**（2026-05-23；已收录待复核）
  名称／榜单：[第 19 届吉林省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/jilin)。补题：[Gym 106567](https://codeforces.com/gym/106567)（原表标 `Gym / QOJ`）。catalog 已有 13 题；复核题单并补查 QOJ 映射。

- [ ] **26-14 秦皇岛邀请赛**（2026-05-24；新增候选）
  名称／榜单：[CCPC2026-秦皇岛全国邀请赛暨河北省赛](https://cpc.csgrandeur.cn/outrank/rank?outrank_uuid=88998553-ce66-46ec-a062-1beb357d774c)。原表补题入口待补充；待查找可靠题单。

- [ ] **26-15 东北地区赛**（2026-05-24；链接冲突待核验）
  名称／榜单：[第二十届东北地区大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/northeastern?group=official)。原表标 `QOJ`，实际链接为 [Gym 106551](https://codeforces.com/gym/106551)，与 ICPC 南昌冲突；先核验正确入口，再补齐题单。

- [ ] **26-16 CCPC南昌邀请赛**（2026-05-24；已收录待复核）
  名称／榜单：[2026 CCPC 中国大学生程序设计竞赛全国邀请赛（南昌）](https://board.xcpcio.com/ccpc/12th/nanchang-invitational)。原表补题入口待补充；catalog 已有 [Gym 106554](https://codeforces.com/gym/106554) 与 13 题，待复核并补查 QOJ 来源。

- [ ] **26-17 ICPC河南省赛**（2026-05-24；新增候选）
  名称／榜单：[第 17 届 ICPC 河南省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/henan-icpc?group=official)。原表补题入口待补充；待查找可靠题单，注意与 CCPC 河南分开。

- [x] **26-18 山东省赛**（2026-05-24；已补录）
  名称／榜单：[2026 年山东省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/shandong?group=official)。补题：[QOJ 3767](https://qoj.ac/contest/3767)。已补录 13 题，内部 ID 为 `965d670a-c551-5dda-a280-33fc2229feaf`。

- [ ] **26-19 福州邀请赛**（2026-05-30；已补录，QOJ 待补查）
  名称／榜单：[第十三届福建省大学生程序设计竞赛 暨2026年CCPC全国邀请赛（福州）](https://pintia.cn/rankings/2056635464310784000)。补题：[Gym 106565](https://codeforces.com/gym/106565)（原表标 `Gym / QOJ`）。2026-09-08 已补录 A–M 共 13 题及 PTA 榜单，内部 ID 为 `abb72fec-deb3-5d04-9ca3-2b16d6c83ed9`；待补查 QOJ 来源。

- [ ] **26-20 四川省赛**（2026-05-31；已收录待复核）
  名称／榜单：[第十八届四川省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/sichuan?group=official)。补题：[Gym 106570](https://codeforces.com/gym/106570)（原表标 `Gym / QOJ`）。catalog 已有 12 题；复核题单并补查 QOJ 映射。

- [ ] **26-21 广西邀请赛**（2026-05-31；新增候选）
  名称／榜单：[第九届广西大学生程序设计大赛暨2026邀请赛](https://ac.nowcoder.com/acm/contest/136164#rank)。补题：[牛客 136164](https://ac.nowcoder.com/acm/contest/136164#question)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **26-22 内蒙古区赛**（2026-05-31；新增候选）
  名称／榜单：[“绿盟杯”内蒙古自治区第十九届大学生程序设计竞赛](https://pintia.cn/rankings/2057393074358124544)。补题：[PTA 题集入口](https://pintia.cn/market/item/2061646727891632128)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **26-23 贵州邀请赛**（2026-06-07；新增候选）
  名称／榜单：[2026 CCPC 中国大学生程序设计竞赛全国邀请赛（贵州）暨贵州省赛](https://board.xcpcio.com/ccpc/12th/guizhou-invitational?group=official)。D23 为 Gym 邀请入口，待确认比赛 ID 与可访问题单。原表 E23 备注“题目质量较差且有错题”，作为未核实反馈保留，待核验具体题目及修正情况。

- [x] **26-24 重庆市赛**（2026-06-14；已补录）
  名称／榜单：[重庆市第十四届大学生程序设计大赛](https://pintia.cn/rankings/2064240000901931008)。补题：[Gym 106589](https://codeforces.com/gym/106589)。2026-09-08 已补录 A–M 共 13 题及 PTA 榜单，内部 ID 为 `a218c192-1ca0-50e3-886c-95286d773f1d`；仅记录参考表提供的日期，没有推断开赛时刻。

- [x] **26-25 上海市赛**（2026-07-26；已补录）
  名称／榜单：[“华为智联杯”无线程序设计大赛暨2026年上海市大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/shanghai)。补题：[QOJ 3944](https://qoj.ac/contest/3944)。已补录 10 题，内部 ID 为 `e7f754fb-7c45-5a17-8549-5fc0c7bde688`。

- [x] **26-26 沈阳邀请赛**（2026-07-29；已补录）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（沈阳）](https://board.xcpcio.com/icpc/51st/shenyang-invitational?group=official)。补题：[QOJ 3945](https://qoj.ac/contest/3945)。已补录 13 题，内部 ID 为 `f6802fb9-74a6-5029-9a19-e0f5cfaf7645`。

## 2025 赛季：25 条

- [ ] **25-03 北京市赛/小米邀请赛**（2025-04-20；已收录待复核）
  名称／榜单：[2025年北京市大学生程序设计竞赛暨“小米杯”全国邀请赛](https://pintia.cn/rankings/1911705434392723456)。补题：[Gym 105851](https://codeforces.com/gym/105851)。catalog 已有 11 题及 QOJ 1986 来源；复核来源映射与榜单。

- [ ] **25-04 浙江省赛**（2025-04-26；已收录待复核）
  名称／榜单：[「睿琪杯」浙江省第 22 届大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fzhejiang?group=official)。补题：[QOJ 2021?v=1](https://qoj.ac/contest/2021?v=1)。catalog 已有 13 题；复核版本及逐题映射。

- [ ] **25-05 武汉邀请赛**（2025-04-27；已收录待复核）
  名称／榜单：[第 50 届 ICPC 国际大学生程序设计竞赛邀请赛武汉站](https://board.xcpcio.com/icpc%2F50th%2Fwuhan-invitational?group=official)。补题：[Gym 105901](https://codeforces.com/gym/105901)。catalog 已有 13 题及 QOJ 2025?v=1 来源；复核逐题映射。

- [ ] **25-06 西安邀请赛**（2025-05-04；新增候选）
  名称／榜单：[第 50 届 ICPC 国际大学生程序设计竞赛邀请赛西安站](https://rl.algoux.cn/collection/official?rankId=icpc2025invitational-xi_an)。原表补题入口待补充；待查找可靠题单。

- [ ] **25-07 重庆市赛**（2025-05-10；已收录待复核）
  名称／榜单：[第十三届重庆市大学生程序设计竞赛](https://pintia.cn/rankings/1917126683478355968)。补题：[Gym 105887](https://codeforces.com/gym/105887)。catalog 已有 12 题；复核题单与榜单，并补查 QOJ 来源。

- [ ] **25-08 陕西省赛**（2025-05-10；已收录待复核）
  名称／榜单：[第十三届陕西省国际大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fshaanxi?group=official)。补题：[Gym 105891](https://codeforces.com/gym/105891)。catalog 已有 13 题；复核题单并补查 QOJ 来源。

- [ ] **25-09 河南省赛**（2025-05-10；新增候选）
  名称／榜单：[2025 ICPC 河南省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fhenan?group=official)。补题：[牛客 110308](https://ac.nowcoder.com/acm/contest/110308)。查找 CF／QOJ 镜像或可人工核验的完整题单，注意与 CCPC 河南分开。

- [ ] **25-10 黑龙江省赛**（2025-05-11；新增候选）
  名称／榜单：[第二十届黑龙江省大学生程序设计竞赛](https://pintia.cn/rankings/1915280742287147008)。补题：[PTA 题集入口](https://pintia.cn/market/item/1939947583086477312)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **25-11 河北省赛**（2025-05-17；已收录待复核）
  名称／榜单：[第九届河北省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fhebei?group=official)。补题：[Gym 105909](https://codeforces.com/gym/105909)。catalog 已有 13 题及 QOJ 2629 来源；复核逐题映射。

- [ ] **25-12 新疆省赛**（2025-05-17；新增候选）
  名称／榜单：[2025年ICPC新疆维吾尔自治区大学生程序设计竞赛](https://ac.nowcoder.com/acm/contest/109791#rank)。补题：[牛客 109791](https://ac.nowcoder.com/acm/contest/109791#question)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **25-13 南昌邀请赛/江西省赛**（2025-05-18；已收录待复核，榜单映射冲突）
  名称／榜单：[第 50 届 ICPC 国际大学生程序设计竞赛邀请赛南昌站暨 ICPC 江西省大学生程序设计竞赛](https://board.xcpcio.com/icpc%2F50th%2Fnanchang-invitational?group=icpc)。补题：[Gym 105911](https://codeforces.com/gym/105911)。ICPC 记录已有 13 题；与 `25-25` 一起核验榜单归属，不合并两场比赛。

- [ ] **25-14 吉林省赛**（2025-05-24；已收录待复核）
  名称／榜单：[第 18 届吉林省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fjilin?group=A)。补题：[Gym 105922](https://codeforces.com/gym/105922)。catalog 已有 12 题及 QOJ 2033 来源；复核逐题映射。

- [ ] **25-15 东北邀请赛/东北省赛**（2025-05-25；已收录待复核）
  名称／榜单：[2025 年 CCPC 全国邀请赛（东北）暨第十九届 CCPC 东北地区大学生程序设计竞赛](https://board.xcpcio.com/ccpc/11th/northeastern?group=NE-A)。补题：[Gym 105924](https://codeforces.com/gym/105924)。catalog 已有 12 题；复核题单并补查 QOJ 来源。

- [ ] **25-16 山东省赛**（2025-05-25；已收录待复核）
  名称／榜单：[2025年山东省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fshandong?group=official)。补题：[Gym 105930](https://codeforces.com/gym/105930)。catalog 已有 13 题及 QOJ 2040 来源；复核逐题映射。

- [ ] **25-17 广西邀请赛暨省赛**（2025-05-25；新增候选）
  名称／榜单：[第八届广西大学生程序设计大赛暨2025邀请赛](https://ac.nowcoder.com/acm/contest/110811#rank)。补题：[牛客 110811](https://ac.nowcoder.com/acm/contest/110811#question)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **25-18 江苏省赛/广东省赛**（2025-06-02；已收录待复核）
  名称／榜单：[「华为杯」2025 年江苏省大学生程序设计竞赛 / 2025 年广东省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fjiangsu?group=official)。补题：[Gym 105945](https://codeforces.com/gym/105945)。catalog 目前合为一条记录，共 12 题，并有 QOJ 2058?v=1 来源；复核共用题单、日期和两省榜单的表达。

- [ ] **25-19 郑州邀请赛/CCPC河南省赛**（2025-06-02；已收录待复核）
  名称／榜单：[2025 CCPC 全国邀请赛（郑州）暨第七届 CCPC 河南省赛](https://board.xcpcio.com/ccpc%2F11st%2Fzhengzhou-invitational?group=official)。补题：[Gym 105941](https://codeforces.com/gym/105941)。catalog 已有 13 题；原表榜单路径含 `11st`，catalog 为 `11th`，待核验链接并补查 QOJ 来源。

- [ ] **25-20 四川省赛**（2025-06-08；已收录待复核）
  名称／榜单：[2025 四川省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fsichuan?group=official)。补题：[Gym 105949](https://codeforces.com/gym/105949)。catalog 已有 12 题及 QOJ 2152 来源；复核逐题映射。

- [ ] **25-21 贵州省赛**（2025-06-08；新增候选）
  官方名称：2025-2026 ICPC 国际大学生程序设计竞赛贵州省赛。原表没有榜单超链接；D21 为 Gym 邀请入口，待确认比赛 ID、举办日期与赛季归属，补齐题单及榜单来源。仓库旧候选数据另指向 [Gym 615540](https://codeforces.com/gym/615540)，2026-09-08 匿名访问跳转登录页，仍未取得可核验题单。

- [ ] **25-22 福建邀请赛暨省赛**（2025-06-21；已收录待复核）
  名称／榜单：[第十二届福建省大学生程序设计竞赛暨2025年CCPC福建邀请赛](https://pintia.cn/rankings/1934898936967766016)。补题：[Gym 105977](https://codeforces.com/gym/105977)。catalog 已有 13 题；复核题单与榜单，并补查 QOJ 来源。

- [ ] **25-23 内蒙古区赛**（2025-06-22；新增候选）
  名称／榜单：[“华讯杯”内蒙古自治区第十八届大学生程序设计竞赛](https://rl.algoux.cn/collection/official?rankId=nmcpc18th)。补题：[PTA 题集入口](https://pintia.cn/market/item/1939950898541187072)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **25-24 上海市赛**（2025-07-05；已收录待复核）
  名称／榜单：[「华为智联杯」无线程序设计竞赛暨 2025 年上海市大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fshanghai?group=official)。补题：[Gym 105992](https://codeforces.com/gym/105992)。catalog 已有 13 题及 QOJ 2238 来源；复核逐题映射与标题别名。

- [ ] **25-25 CCPC南昌邀请赛/江西省赛**（2025-09-13；已收录，旧榜单错配已修正，逐题映射待复核）
  名称／榜单：[2025 CCPC 全国邀请赛（南昌）暨第二届江西省赛](https://board.xcpcio.com/ccpc%2F11st%2Fnanchang-invitational?group=official)。补题：[QOJ 2521](https://qoj.ac/contest/2521)。catalog 已有 13 题；误挂的 ICPC 榜单已移除，当前使用 RankLand `ccpc2025invitational-nanchang`。原表 `11st` 链接仅作原始证据保留，逐题映射仍待复核。

- [ ] **25-26 湖南省赛**（2025-10-12；已收录待复核）
  官方名称：湖南省第二十一届大学生计算机程序设计竞赛。原表没有榜单超链接；补题：[Gym 106139](https://codeforces.com/gym/106139)。catalog 已有 11 题及 QOJ 2566 来源；复核逐题映射并补查榜单。

- [ ] **25-27 辽宁省赛**（2025-11-15；已收录待复核）
  名称／榜单：[第六届辽宁省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2025/liaoning?group=official)。补题：[Gym 106380](https://codeforces.com/gym/106380)。catalog 已有 13 题及 QOJ 2642 来源；复核逐题映射与别名。

## 其他待办

- [ ] 对已收录 CF 比赛补查 QOJ 来源，核验逐题对应后补映射，保留内部 ID 和现有来源。
- [ ] 完善构建期 Gym 题单获取脚本的认证和错误报告。历史批次曾遇到匿名 `contest.standings` 认证失败；后续以实际响应和用户自有权限为准，不把失败当成空题单。
- [ ] 继续核验缺失牌线的榜单资格与最高组别；组别不明、榜单不完整时保留缺口，不能为了完成清单估算数据。
