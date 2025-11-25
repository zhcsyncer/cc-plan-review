# Claude Plan Reviewer (中文说明)

这是一个功能齐全的单页应用 (SPA)，旨在模仿 GitLab 合并请求 (Merge Request) 的审查体验，用于审查 Claude 生成的计划。

## 主要功能

- **批量审查**：在提交之前创建多个草稿评论。
- **行内评论**：针对特定选定的文本添加评论。
- **持久化**：审查状态保存到本地文件系统 (`.reviews/` 目录)。
- **异步工作流**：解耦请求和获取步骤。

## 技术栈

- **前端**：Vue 3, Rsbuild, TailwindCSS
- **后端**：Node.js, Express, MCP SDK

## 使用方法

### MCP 工具

- `request_human_review`：开始审查会话。
- `get_review_result`：获取审查评论。

### API

- `GET /api/reviews/:id`：获取审查状态。
- `POST /api/reviews/:id/comments`：创建草稿。
- `PUT /api/reviews/:id/comments/:commentId`：更新草稿。
- `DELETE /api/reviews/:id/comments/:commentId`：删除草稿。
- `POST /api/reviews/:id/submit`：提交审查。
