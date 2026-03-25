# xcpc-vp-gather

一个本地优先的 XCPC/ACM VP 辅助工具，用来维护比赛池、同步队员做题历史，并帮助判断哪些比赛或题目更值得 VP。

版本：`0.1.1`

## 当前能做什么

- 把 Codeforces Gym 比赛同步到本地池子
- 同步队员在 Codeforces 上的做题历史
- 按比赛查看覆盖情况，用于 VP 前判断
- 在比赛列表中直接显示每题状态块
- 按 tag 和 pool scope 过滤比赛池
- 批量补同步那些“只导入了元信息、还没真正拉题目”的比赛
- 在 Intake 页面记录操作日志

## MVP 范围

- 只支持一个 OJ：Codeforces Gym
- 单机、本地单用户
- 本地网页 + localhost Python 服务
- SQLite 作为持久化数据源
- 支持比赛同步、队员历史同步、覆盖摘要、导入导出和本地浏览

## 快速启动

在仓库根目录执行：

```bash
make dev
```

它会自动：

- 创建 `apps/service/.venv`
- 安装 service 依赖
- 安装 web 依赖
- 启动 FastAPI 服务 `http://127.0.0.1:8000`
- 启动前端页面 `http://127.0.0.1:5173`

如果只想准备依赖：

```bash
make bootstrap
```

如果需要强制刷新依赖：

```bash
XVG_BOOTSTRAP_FORCE=1 make bootstrap
```

## 手动开发

后端：

```bash
cd apps/service
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m uvicorn xcpc_vp_gather.main:app --reload
```

前端：

```bash
cd apps/web
npm install
npm run dev
```

## 主要页面

- `/contests`
  比赛池列表，支持分页、tag 过滤、pool scope、题号状态条
- `/contests/intake`
  添加比赛、导入导出、补同步未同步比赛、查看操作日志
- `/contests/:contestId`
  比赛详情与覆盖矩阵
- `/members`
  队员列表与做题概况

## 常见工作流

1. 在 Intake 页面添加或导入比赛
2. 同步队员做题历史
3. 在 Contest Pool 页面快速扫描比赛价值
4. 打开比赛详情页看每题每人的覆盖情况

## 为什么会看到 `0 problems`

如果某个比赛卡片显示 `0 problems`，通常表示这场比赛的基础信息已经进了本地库，但题目数据还没有真正同步下来。现在可以在 Intake 页面点击 `Sync Missing Contests`，只补同步这些还没有题目数据的比赛。

## 验证命令

后端测试：

```bash
cd apps/service
./.venv/bin/pytest tests/test_sync_and_coverage.py tests/test_schema_init.py
```

前端构建：

```bash
cd apps/web
npm run build
```

## 相关文档

- [README.md](./README.md)
- [AGENTS.md](./AGENTS.md)
- [apps/service/README.md](./apps/service/README.md)
- [apps/web/README.md](./apps/web/README.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/mvp-design.md](./docs/mvp-design.md)
