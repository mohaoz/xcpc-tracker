# 手动发现比赛与来源更新

工具只生成待审核列表，不修改正式目录、成员状态或发布分支。暂不接入每日 Actions 或 CI，也不生成 QOJ 导出队列。

## 使用

```sh
npm run catalog:discover
npm run catalog:discover -- --offline
npm run catalog:validate-discovery
```

首次运行建立观察基线；后续运行比较变化。`first_seen` 只表示首次观察，不保证是新举办的比赛。来源消失只报告 `missing_upstream`，不删除目录。不同来源的同名比赛仅作为候选，不自动合并或推断组别。

| 来源 | 观察范围 | 限制 |
| --- | --- | --- |
| XCPC Rating | 比赛、题名、题目链接、标签和 Rating | 不能直接认定为完整官方题单 |
| RankLand / SRK | 固定上游提交，比较索引和榜单文件 blob SHA | 不计算或替换牌线，不认定最高组 |
| XCPCIO Board | 公开比赛索引及配置变化 | 索引不变不代表完整榜单未变 |

QOJ 页面仍由用户在自己的浏览器获取。报告可保留上游原始链接，但不请求 QOJ、不使用登录态、不自动组织导出任务。审核和导入继续使用[已有维护流程](../../scripts/README.md#cf--qoj)。

## 输出与失败处理

默认成功快照保存在 `tmp/discovery/state.json`，`--state` 可指定其他缓存路径。报告默认写入 `docs/discovery/generated/`，`--output` 可指定 `docs/`、`tmp/` 或系统临时目录下的位置；禁止写入正式 catalog、web 或 git 目录。生成内容不提交，也不进入网站资产。

- `report.md`：来源状态及待审核列表。
- `report.json`：来源观察、目录关联、题名候选及元数据差异。
- `state.json`：各来源原始成功快照、内容哈希及历史观察。
- `LICENSE-SRK.txt`：SRK 来源许可；其他来源见[来源说明](../../catalog/README.md)。

下载失败、空快照、重复来源 ID、截断 Git tree 或结构异常不会覆盖该来源的上次成功数据，其他来源仍独立更新。旧观察标记为 stale，命令返回非零退出码。`--offline` 只使用已有成功快照，不访问网络；缓存丢失时需重新建立基线。

报告哈希为对象键递归排序后的 JSON SHA256，SRK 文件使用上游 Git blob SHA；这些观察哈希不能替代正式审核工具要求的原始文件哈希。工具不执行 apply，报告本身不授权修改目录。
