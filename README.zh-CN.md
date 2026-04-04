# XCPC-Tracker

一个前端优先、静态部署、本地持久化的 XCPC 题目覆盖追踪工具。

## 当前能力

- 浏览整理后的 XCPC 比赛目录
- 在浏览器本地维护比赛、成员和覆盖状态
- 在比赛列表中直接查看每题颜色状态条
- 用统一搜索、成员筛选和标签匹配快速挑比赛
- 导入、导出、删除本地比赛与成员数据

## 技术栈

- Vue 3 + TypeScript
- Vite
- Pinia
- Dexie / IndexedDB
- Git 管理的 `catalog/default-catalog.min.json`

## 常用命令

目录校验：

```bash
npm run catalog:build-final
npm run catalog:generate-default
npm run catalog:refresh
npm run catalog:validate
```

目录数据链路：

1. 在浏览器里运行 `scripts/browser-fetch-contests.mjs`，导出候选 `contests.json`
2. 将导出的文件保存为 `data/contests.json`
3. 运行 `npm run catalog:build-final`，生成 `data/final.json`
4. 运行 `npm run catalog:generate-default`，生成 `catalog/default-catalog.min.json`
5. 或直接运行 `npm run catalog:refresh`

前端构建：

```bash
cd web
npm install
npm run build
```

## 主要页面

- `/contests`
  比赛池列表，支持统一搜索、成员筛选、分页和题号状态条
- `/contests/:contestId`
  比赛详情、覆盖矩阵与元数据编辑
- `/members`
  本地成员列表
- `/members/new`
  QOJ 成员导入脚本
- `/manage`
  本地比赛/成员数据导入导出工具

## 相关文档

- [README.md](./README.md)
- [AGENTS.md](./AGENTS.md)
- [scripts/README.md](./scripts/README.md)
- [web/README.md](./web/README.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/mvp-design.md](./docs/mvp-design.md)
