# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-plan-review 是一个 **Claude Code 插件**，为 Plan Mode 提供人工审核能力。插件通过 hooks 拦截 `ExitPlanMode` 调用，在浏览器中打开审核界面，用户可以进行批注式审核，然后将反馈返回给 Claude 进行迭代。

## Plugin Architecture

插件由两个核心组件协同工作：

```
┌─────────────────────────────────────────────────────┐
│                  Claude Code Plugin                  │
├─────────────────────┬───────────────────────────────┤
│       Hooks         │         MCP Server            │
│  (PreToolUse)       │      (4 个审核工具)            │
├─────────────────────┼───────────────────────────────┤
│ 拦截 ExitPlanMode   │ request_human_review          │
│ 调用 intercept-plan │ get_review_result             │
│ 返回 approve/block  │ ask_questions                 │
│                     │ update_plan                   │
└─────────────────────┴───────────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Web UI     │
                    │  (Vue 3 SPA) │
                    └──────────────┘
```

### 工作流程

```
用户在 Plan Mode 中工作
    ↓
Claude 调用 ExitPlanMode
    ↓
Hook 拦截 → 启动审核会话 → 打开浏览器
    ↓
用户审核并提交反馈
    ↓
Hook 返回结果（approve 或 block + 评论）
    ↓
Claude 根据反馈修改或继续执行
```

## Tech Stack

- **后端**: Node.js + Express 5 + TypeScript (ES2022)
- **前端**: Vue 3 + Rsbuild + TailwindCSS
- **MCP SDK**: @modelcontextprotocol/sdk（支持 stdio 和 HTTP 两种传输模式）
- **包管理**: pnpm

## Development Commands

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（监视文件变化）
pnpm build            # 完整构建（服务器 + 脚本 + 客户端）

# 单独构建
pnpm build:server     # 编译后端 TypeScript
pnpm build:scripts    # 编译拦截脚本
pnpm build:client     # 构建前端 SPA

pnpm start            # 启动服务（stdio 模式）
```

## Core Modules

```
src/
├── index.ts          # 入口点 - CLI 参数处理和服务启动
├── mcp-server.ts     # MCP 工具定义（4个核心工具）
├── http-server.ts    # Express HTTP 服务器和 REST API
├── review-manager.ts # 评论管理和状态机核心逻辑
├── sse-manager.ts    # Server-Sent Events 管理
├── event-bus.ts      # 事件总线 - 实时事件分发
└── logger.ts         # 日志工具（输出到 stderr）

scripts/
└── intercept-plan.ts # ExitPlanMode 拦截脚本（Hook 调用）
```

## Review 状态流转（PR 风格）

```
open → changes_requested → discussing → approved
         ↓                      ↓
      updated ←─────────────────┘
```

## Key Files

- `hooks/hooks.json` - Claude Code 钩子配置（PreToolUse 拦截 ExitPlanMode）
- `.claude-plugin/plugin.json` - 插件元数据
- `scripts/intercept-plan.ts` - 拦截脚本入口

## Logging

- 日志输出到 stderr（避免干扰 MCP stdio 协议）
- 调试模式: `DEBUG=1` 或 `CC_PLAN_REVIEW_DEBUG=1`
- 日志文件: `logs/` 目录

## Release Process

**分支策略**：
- `develop` 分支：`.gitignore` 忽略 `dist/`，开发时不跟踪构建产物
- `main` 分支：`.gitignore` **不忽略** `dist/`，构建产物被 git 跟踪，用于发布

**发布流程**（必须严格遵守）：

```bash
# 1. 切换到 main 分支
git checkout main

# 2. 合并 develop
git merge develop

# 3. 重新构建（关键！切换分支后 dist/ 会被回滚到旧版本）
pnpm build

# 4. 提交构建产物
git add dist/
git commit -m "build: update dist"

# 5. 推送发布
git push origin main
```

⚠️ **注意**：合并到 `main` 后必须重新执行 `pnpm build`，否则 `dist/` 是旧版本（被 git checkout 回滚）。
