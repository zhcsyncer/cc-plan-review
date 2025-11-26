# Claude Code 计划审核插件

一个 Claude Code 插件，为 Plan Mode 提供人工审核能力。插件通过 hooks 拦截 `ExitPlanMode` 调用，在浏览器中打开审核界面，用户可以对 Claude 生成的计划进行批注和反馈。

## 主要功能

- **ExitPlanMode 拦截**：自动拦截计划提交，触发人工审核
- **行内评论**：针对特定选定的文本添加评论（类似 GitLab MR 审查）
- **批量审查**：在提交之前创建多个草稿评论
- **版本历史**：追踪计划修订，支持差异对比
- **实时更新**：基于 SSE 的浏览器实时更新

## 安装

### 通过 Claude Code CLI
```bash
# 添加 GitHub marketplace
claude plugin marketplace add zhcsyncer/cc-plan-review

# 安装插件
claude plugin install cc-plan-review@cc-plan-review-marketplace
```

### 通过 Claude Code 交互式命令
```
/plugin marketplace add zhcsyncer/cc-plan-review
/plugin install cc-plan-review@cc-plan-review-marketplace
```

或直接使用 `/plugin` 命令进入交互式安装流程。

### 更新插件
```bash
claude plugin marketplace update
```

### 从源码安装（开发者）
```bash
git clone https://github.com/zhcsyncer/cc-plan-review.git
cd cc-plan-review
pnpm install && pnpm build
claude plugin add ./cc-plan-review
```

## 工作原理

插件由两个组件协同工作：

### 1. Hooks (PreToolUse)
拦截 `ExitPlanMode` 调用并触发审核流程：
```
ExitPlanMode 调用 → Hook 拦截 → 打开浏览器 → 用户审核 → 返回 approve/block
```

### 2. MCP Server
提供 4 个审核工具：
- `request_human_review`：创建审核会话
- `get_review_result`：获取审核状态和反馈
- `ask_questions`：Agent 提出澄清问题
- `update_plan`：提交修订版本

## 技术栈

- **前端**：Vue 3, Rsbuild, TailwindCSS
- **后端**：Node.js, Express 5, MCP SDK

## 开发

```bash
pnpm install        # 安装依赖
pnpm dev            # 监视模式
pnpm build          # 完整构建（服务器 + 脚本 + 客户端）
pnpm start          # 启动服务
```

## API

- `GET /api/reviews/:id`：获取审核状态
- `POST /api/reviews/:id/comments`：创建草稿评论
- `PUT /api/reviews/:id/comments/:commentId`：更新草稿
- `DELETE /api/reviews/:id/comments/:commentId`：删除草稿
- `POST /api/reviews/:id/submit`：提交审核
