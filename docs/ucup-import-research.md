# UCup 账号导入实测（2026-09-29）

本次为可行性研究，不是已实现功能。产品约定：UCup 队伍就是一个普通本地成员，新增 `ucup` provider，不引入队伍/人员关系模型。

## 浏览器实测

使用独立、未登录的本地 Chrome 会话，仅访问页面与切换页面提供的 Show all submissions 控件。未读取个人浏览器 Cookie，未提交代码或开启 VP。

| 入口 | 结果 |
| --- | --- |
| `https://contest.ucup.ac/user/profile/ucup-team191` | 跳转登录页 |
| `https://contest.ucup.ac/submissions` | HTTP 404 |
| 同上加 `?submitter=ucup-team191` | HTTP 404 |
| `https://contest.ucup.ac/contest/3749` | HTTP 200，完整 13 题及 Submissions 链接 |
| `https://contest.ucup.ac/contest/3749/submissions` | HTTP 200；未勾选 Show all submissions 时没有提交表，不能当作零提交 |
| 同页面勾选 Show all submissions | 出现公开提交表，每页样本 10 行，含提交 ID、题目链接、提交者主页链接、判定结果 |
| 第 2、19 页 | 均可读取；第 19 页有 `ucup-team5046` 的 AC、WA、TL、ML、RE 和 Compile Error 记录 |
| 比赛提交页的 `submitter=ucup-team191` 与不存在的账号 | 两者返回相同的他人记录，说明本次实测该参数不生效 |
| QOJ 主页和全站提交页 | 独立浏览器遇到验证页，未取得登录态样本 |

网页自身的 Show all submissions 控件使用 `show_all_submissions` Cookie 并重载页面。它是显示偏好，不是登录凭证。正常实现应通过页面控件或保留/恢复偏好的方式使用，不覆盖用户长期设置。

分页显示的是滑动窗口：第一页可见页码到 19，第 19 页可见到 28，且还有下一页；不能用第一页最大可见页码推断总页数。仅抽样，没有遍历全部历史。

## 题目和记录匹配

UCup 默认视图的 3749 为 Grand Prix of Wulin，并明确链接到 `3749?v=1` 的浙江省赛视图。其 13 个题目 ID（18119–18131）和题名，与现有已审核 QOJ 浙江省赛目录逐项一致。本样本支持按题目 ID 建立跨 provider 映射，不足以证明全站所有比赛版本都相同。

身份必须从 `/user/profile/<handle>` 提取，不能使用会变化的队名。判定来自提交记录表，不从榜单推断。抽样第 19 页足以确认队伍 5046 的题目 18120 有 AC、18123 有 TL；这是正向证据，不能推断其他题目未做。

提交时间有绝对时间及 VP 相对时间两种展示；增量不能直接解析显示文本当作绝对时间。提交 ID 可用于去重；重判和可见范围变化仍需重新核验。

## 推荐实现路线

1. 独立 `ucup` 适配器，成员仍沿用现有模型。数据获取放在用户浏览器，状态记录保留 provider、handle、提交 ID 和原始结果。
2. 首选登录队伍账号后按比赛读取默认的本人提交。这一路仍需真实登录态确认：默认表是否只含本人、是否包含赛中/VP/赛后提交、分页是否完整。不能根据匿名空表宣称登录后必然可用。
3. 备用路径为比赛内公开提交表。已实测可读取队伍记录，但账号过滤参数不生效，需要逐行按 handle 筛选。适用于手动选择的比赛/有限目录队列；不建议定时扫描全部比赛的全部提交。
4. 候选队列来自已验证的 UCup 比赛入口及目录映射；不能假定所有 QOJ 比赛均在 UCup 可访问，不能从报名或 VP 历史推断已尝试。
5. 未读完时仅导入明确的正向证据，标记范围不完整；保留旧状态，不推进完整同步游标。跟随真实下一页链接，检测重复页、重复 ID、登录/验证页及账号不符。
6. AC 为 solved，有提交但无 AC 为 attempted（包括 CE）；只展示过比赛或报名不算尝试。保留原判定以便后续重判修正。未知/隐藏结果不能猜 AC。

## 外部实现参考与限制

- [官方系统使用说明](https://contest.ucup.ac/)介绍队伍账号、比赛内提交与赛后补题；赛后提交不改变比赛榜单，故榜单不足以覆盖实际做题历史。
- [QOJ Better 源码](https://greasyfork.org/en/scripts/554758-qoj-better/code)将 UCup 标为 contest-only 站点，在 QOJ 构造 `/submissions?submitter=...`、`accepted=1` 链接。不能直接把这些全站路径套在 UCup 域名上，本次实测 UCup 返回 404。
- [oi-checklist 的 QOJ 读取实现](https://github.com/avighnac/oi-checklist/blob/main/src/backend/python/qoj/fetchProblemScores.py)使用 QOJ 提交者过滤和分页，证明存在这类实现思路；不代表当前 UCup 登录态已验证。其服务端登录/抓取方式不适用于本项目。

当前结论：比赛级公开提交导出已有真实可用证据；“输入任意 UCup handle 即快速、完整同步全历史”尚未验证，不能承诺。下一步应验证本人登录态的比赛提交表，再确定首次导入范围和自动同步成本。
