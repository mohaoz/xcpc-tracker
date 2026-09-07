# 比赛补录与 QOJ 更新 TODO

记录日期：2026-09-07。对照基线：`104036c` 的 [默认 catalog](../catalog/default-catalog.min.json)，版本 `0.6.0`。

本清单汇总两份参考表的全部 49 条记录（2026 赛季 24 条、2025 赛季 25 条），以及单独提出的 QOJ 4071 和 QOJ 更新流程问题。江苏／广东在两份表中各合列一条，因此记录数不等于独立比赛数。

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

- [ ] **QOJ 4071：2026 ICPC 网络赛第一场**。比赛日期 2026-09-06，标题为 The 2026 ICPC Asia East Continent Online Contest (I)，入口为 [QOJ 4071](https://qoj.ac/contest/4071)。此前已从[公开分类](https://qoj.ac/category/763)确认 A–N 共 14 题；待在登录浏览器中导出完整题单，复核后补录。详见[既有待补题单记录](2026-contests-pending-problem-lists.md)。
- [ ] **复核原表疑似错链**。`26-07`（CCPC 河南）和 `26-15`（东北地区赛）D 列显示 `QOJ`，实际都指向 Gym 106551，与 `26-10` 相同；当前 catalog 将该 Gym 映射至 2026 ICPC 南昌邀请赛。取得两场比赛的正确入口后再导入。
- [ ] **复核 2025 南昌两场比赛的榜单映射**。当前 ICPC 南昌记录 `9c24593e-15cd-5d66-b041-6bb69a464fa1` 与 CCPC 南昌记录 `d505e000-4947-579c-8d9b-99e31160839f` 都挂了 `/icpc/50th/nanchang-invitational` 榜单；对照 `25-13` 与 `25-25` 核验并修正 CCPC 榜单来源，检查由此生成的别名及奖牌线。

## 2026 赛季：24 条

- [ ] **26-03 深圳邀请赛**（2026-04-11；新增候选）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（深圳）](https://board.xcpcio.com/icpc/51st/shenzhen-invitational?group=official)。补题：[QOJ 3588?v=1](https://qoj.ac/contest/3588?v=1)。待导出并复核完整题单。

- [ ] **26-04 浙江省赛**（2026-04-25；新增候选）
  名称／榜单：[「睿琪杯」浙江省第 23 届大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/zhejiang?group=undergraduate)。补题：[QOJ 3749?v=1](https://qoj.ac/contest/3749?v=1)。待导出并复核完整题单。

- [ ] **26-05 西安邀请赛**（2026-05-02；新增候选）
  名称／榜单：[第 51 届 ICPC 国际大学生程序设计竞赛邀请赛西安站](https://board.xcpcio.com/icpc/51st/xian-invitational?group=official)。补题：[QOJ 3766](https://qoj.ac/contest/3766)。待导出并复核完整题单。

- [ ] **26-06 北京市赛**（2026-05-10；新增候选）
  名称／榜单：[2026年北京市大学生程序设计竞赛](https://pintia.cn/rankings/2048682058783719424)。原表补题入口待补充；待查找可靠题单。

- [ ] **26-07 CCPC河南省赛**（2026-05-10；链接冲突待核验）
  名称／榜单：[第 8 届 CCPC 河南省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/henan)。原表标 `QOJ`，实际链接为 [Gym 106551](https://codeforces.com/gym/106551)，与 ICPC 南昌冲突；先核验正确入口，再补齐题单。

- [ ] **26-08 黑龙江省赛**（2026-05-10；新增候选）
  名称／榜单：[第二十一届黑龙江省大学生程序设计竞赛](https://pintia.cn/rankings/2049414294076952576)。补题：[Gym 106534](https://codeforces.com/gym/106534)（原表标 `Gym / QOJ`）。待复核完整题单，并查找 QOJ 入口。

- [ ] **26-09 陕西省赛**（2026-05-16；已收录待复核）
  名称／榜单：[第 14 届陕西省国际大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/shaanxi)。补题：[Gym 106532](https://codeforces.com/gym/106532)（原表标 `Gym / QOJ`）。catalog 已有 13 题；复核题单并补查 QOJ 映射。

- [ ] **26-10 ICPC南昌邀请赛**（2026-05-17；已收录待复核）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（南昌）暨江西省赛](https://board.xcpcio.com/icpc/51st/jiangxi-invitational)。补题：[Gym 106551](https://codeforces.com/gym/106551)。catalog 已有 13 题；复核来源，避免与 `26-07`、`26-15` 错配。

- [ ] **26-11 武汉邀请赛**（2026-05-17；新增候选）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（武汉）暨湖北省赛](https://board.xcpcio.com/icpc/51st/wuhan-invitational)。补题：[QOJ 3799?v=1](https://qoj.ac/contest/3799?v=1)。待导出并复核完整题单。

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

- [ ] **26-18 山东省赛**（2026-05-24；新增候选）
  名称／榜单：[2026 年山东省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/shandong?group=official)。补题：[QOJ 3767](https://qoj.ac/contest/3767)。待导出并复核完整题单。

- [ ] **26-19 福州邀请赛**（2026-05-30；新增候选）
  名称／榜单：[第十三届福建省大学生程序设计竞赛 暨2026年CCPC全国邀请赛（福州）](https://pintia.cn/rankings/2056635464310784000)。补题：[Gym 106565](https://codeforces.com/gym/106565)（原表标 `Gym / QOJ`）。待复核完整题单，并查找 QOJ 入口。

- [ ] **26-20 四川省赛**（2026-05-31；已收录待复核）
  名称／榜单：[第十八届四川省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/sichuan?group=official)。补题：[Gym 106570](https://codeforces.com/gym/106570)（原表标 `Gym / QOJ`）。catalog 已有 12 题；复核题单并补查 QOJ 映射。

- [ ] **26-21 广西邀请赛**（2026-05-31；新增候选）
  名称／榜单：[第九届广西大学生程序设计大赛暨2026邀请赛](https://ac.nowcoder.com/acm/contest/136164#rank)。补题：[牛客 136164](https://ac.nowcoder.com/acm/contest/136164#question)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **26-22 内蒙古区赛**（2026-05-31；新增候选）
  名称／榜单：[“绿盟杯”内蒙古自治区第十九届大学生程序设计竞赛](https://pintia.cn/rankings/2057393074358124544)。补题：[PTA 题集入口](https://pintia.cn/market/item/2061646727891632128)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **26-23 贵州邀请赛**（2026-06-07；新增候选）
  名称／榜单：[2026 CCPC 中国大学生程序设计竞赛全国邀请赛（贵州）暨贵州省赛](https://board.xcpcio.com/ccpc/12th/guizhou-invitational?group=official)。D23 为 Gym 邀请入口，待确认比赛 ID 与可访问题单。原表 E23 备注“题目质量较差且有错题”，作为未核实反馈保留，待核验具体题目及修正情况。

- [ ] **26-24 重庆市赛**（2026-06-14；新增候选）
  名称／榜单：[重庆市第十四届大学生程序设计大赛](https://pintia.cn/rankings/2064240000901931008)。补题：[Gym 106589](https://codeforces.com/gym/106589)。待复核完整题单与来源。

- [ ] **26-25 上海市赛**（2026-07-26；新增候选）
  名称／榜单：[“华为智联杯”无线程序设计大赛暨2026年上海市大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2026/shanghai)。补题：[QOJ 3944](https://qoj.ac/contest/3944)。待导出并复核完整题单。

- [ ] **26-26 沈阳邀请赛**（2026-07-29；新增候选）
  名称／榜单：[2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（沈阳）](https://board.xcpcio.com/icpc/51st/shenyang-invitational?group=official)。补题：[QOJ 3945](https://qoj.ac/contest/3945)。待导出并复核完整题单。

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
  官方名称：2025-2026 ICPC 国际大学生程序设计竞赛贵州省赛。原表没有榜单超链接；D21 为 Gym 邀请入口，待确认比赛 ID、举办日期与赛季归属，补齐题单及榜单来源。

- [ ] **25-22 福建邀请赛暨省赛**（2025-06-21；已收录待复核）
  名称／榜单：[第十二届福建省大学生程序设计竞赛暨2025年CCPC福建邀请赛](https://pintia.cn/rankings/1934898936967766016)。补题：[Gym 105977](https://codeforces.com/gym/105977)。catalog 已有 13 题；复核题单与榜单，并补查 QOJ 来源。

- [ ] **25-23 内蒙古区赛**（2025-06-22；新增候选）
  名称／榜单：[“华讯杯”内蒙古自治区第十八届大学生程序设计竞赛](https://rl.algoux.cn/collection/official?rankId=nmcpc18th)。补题：[PTA 题集入口](https://pintia.cn/market/item/1939950898541187072)。先保留参考，查找 CF／QOJ 镜像或可人工核验的完整题单。

- [ ] **25-24 上海市赛**（2025-07-05；已收录待复核）
  名称／榜单：[「华为智联杯」无线程序设计竞赛暨 2025 年上海市大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest%2F2025%2Fshanghai?group=official)。补题：[Gym 105992](https://codeforces.com/gym/105992)。catalog 已有 13 题及 QOJ 2238 来源；复核逐题映射与标题别名。

- [ ] **25-25 CCPC南昌邀请赛/江西省赛**（2025-09-13；已收录待复核，榜单映射冲突）
  名称／榜单：[2025 CCPC 全国邀请赛（南昌）暨第二届江西省赛](https://board.xcpcio.com/ccpc%2F11st%2Fnanchang-invitational?group=official)。补题：[QOJ 2521](https://qoj.ac/contest/2521)。catalog 已有 13 题；核验原表 `11st` 路径及 catalog 中误挂的 ICPC 榜单，复核相关派生数据。

- [ ] **25-26 湖南省赛**（2025-10-12；已收录待复核）
  官方名称：湖南省第二十一届大学生计算机程序设计竞赛。原表没有榜单超链接；补题：[Gym 106139](https://codeforces.com/gym/106139)。catalog 已有 11 题及 QOJ 2566 来源；复核逐题映射并补查榜单。

- [ ] **25-27 辽宁省赛**（2025-11-15；已收录待复核）
  名称／榜单：[第六届辽宁省大学生程序设计竞赛](https://board.xcpcio.com/provincial-contest/2025/liaoning?group=official)。补题：[Gym 106380](https://codeforces.com/gym/106380)。catalog 已有 13 题及 QOJ 2642 来源；复核逐题映射与别名。

## QOJ 更新流程与发布待办

此前审计：`534b75b` 新增的 8 场 2026 比赛全部来自 Codeforces；`c11b8f2` 补的是既有比赛的 QOJ 题目映射。当前 [catalog:refresh](../package.json) 没有调用 QOJ 题单导入；[QOJ 导入脚本](../scripts/import-qoj-problems-export.mjs) 只匹配已经存在的 QOJ 比赛来源，未匹配到的比赛进入 `skippedContests`，不会自动创建新比赛。仓库现有两份 QOJ 快照未包含 2026 比赛。

- [ ] 从用户浏览器保存或导出新的 QOJ 比赛题单，优先覆盖上表 7 个 2026 QOJ 入口及 QOJ 4071；保留完整 URL（含 `?v=`）、上游标题和逐题来源。
- [ ] 为未匹配的新 QOJ 比赛形成可审阅草稿／补丁，再将确认过的比赛与完整题单一起提升为 curated 数据；明确显示跳过与歧义原因。
- [ ] 对已收录的 CF 比赛补查 QOJ 来源，核验逐题对应关系后补映射，保留原内部 ID 和现有来源。
- [ ] 补齐目录刷新中使用已审核 QOJ 题单的步骤，并验证重新生成不会丢失已补录比赛、题目或来源；保留需要人工处理的候选报告。
- [ ] 为新增比赛草稿、跳过报告、QOJ 版本参数、错链和同题多场比赛增加必要的离线 fixture 与验证。
- [ ] 每批数据完成后执行 catalog schema 验证、确定性生成检查及静态构建，确认没有空题单或 `contest_stub`，catalog 版本与应用发布版本一致。
- [ ] 通过验证后按 `main`／`release` 分支规则提交、推送并部署，核对线上比赛数与 QOJ 题目映射；同步勾选本清单并更新[2026 待补题单文档](2026-contests-pending-problem-lists.md)。
