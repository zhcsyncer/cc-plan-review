# cc-plan-review 升级指令：ExitPlanMode 拦截方案

## 项目背景

当前项目是一个 MCP server，提供 Web GUI 供用户审核 Claude 生成的计划。现在需要：

1. 将其升级为 Claude Code 插件格式，支持 hooks 自动配置
2. 添加 PreToolUse hook 拦截 ExitPlanMode 工具
3. 实现基于项目路径的隔离
4. 在 client 中添加直接 approve 功能

## Phase 1: 创建插件结构

### 1.1 创建 `plugin.json`

在项目根目录创建：

```json
{
  "name": "cc-plan-review",
  "version": "1.0.0",
  "description": "GUI-based plan review for Claude Code with ExitPlanMode interception",
  "main": "dist/index.js",
  "hooks": "hooks/hooks.json",
  "mcpServers": {
    "plan-reviewer": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"]
    }
  }
}
```

### 1.2 创建 `hooks/hooks.json`

```json
{
  "description": "Plan review hooks - intercepts ExitPlanMode for GUI review",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/scripts/intercept-plan.js\"",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

## Phase 2: 实现项目隔离

### 2.1 更新 `src/review-manager.ts`

添加项目路径编码和隔离逻辑：

```typescript
// 在文件顶部添加
function encodeProjectPath(projectPath: string): string {
  // 将路径中的特殊字符替换为安全字符
  return projectPath
    .replace(/^\//, '')  // 移除开头的 /
    .replace(/\//g, '_') // 替换 / 为 _
    .replace(/:/g, '_'); // 替换 : 为 _ (Windows 盘符)
}

function getProjectDataDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(DATA_DIR, 'projects', encoded);
}
```

修改 `ReviewManager` 类：

1. 所有方法签名添加可选的 `projectPath` 参数
2. 修改 `_save` 和 `getReview` 方法支持项目隔离
3. 修改 `getLatestReview` 在指定项目范围内查找

```typescript
export class ReviewManager {
  // 确保项目数据目录存在
  private async ensureProjectDir(projectPath: string): Promise<string> {
    const dir = getProjectDataDir(projectPath);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async _save(review: Review): Promise<void> {
    const dir = review.projectPath 
      ? await this.ensureProjectDir(review.projectPath)
      : DATA_DIR;
    const filePath = path.join(dir, `${review.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(review, null, 2));
    logger.debug(`Saved review ${review.id} to ${filePath}`);
  }

  async getReview(id: string, projectPath?: string): Promise<Review | null> {
    // 先尝试在指定项目目录查找
    if (projectPath) {
      const dir = getProjectDataDir(projectPath);
      try {
        const data = await fs.readFile(path.join(dir, `${id}.json`), 'utf-8');
        return JSON.parse(data) as Review;
      } catch {
        // 继续在全局目录查找
      }
    }
    
    // 在全局目录查找（向后兼容）
    try {
      const data = await fs.readFile(path.join(DATA_DIR, `${id}.json`), 'utf-8');
      return JSON.parse(data) as Review;
    } catch {
      return null;
    }
  }

  async getLatestReview(projectPath?: string): Promise<Review | null> {
    const searchDir = projectPath ? getProjectDataDir(projectPath) : DATA_DIR;
    
    try {
      await fs.access(searchDir);
    } catch {
      return null;
    }

    try {
      const files = await fs.readdir(searchDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) return null;

      let latestFile: string | null = null;
      let maxTime = 0;

      for (const file of jsonFiles) {
        const stats = await fs.stat(path.join(searchDir, file));
        if (stats.mtimeMs > maxTime) {
          maxTime = stats.mtimeMs;
          latestFile = file;
        }
      }

      if (!latestFile) return null;
      return this.getReview(latestFile.replace('.json', ''), projectPath);
    } catch (e) {
      logger.error("Error getting latest review:", e);
      return null;
    }
  }

  async createReview(plan: string, projectPath?: string): Promise<Review> {
    const id = randomUUID();
    const versionHash = this.calculateContentHash(plan);
    logger.info(`Creating new review with ID: ${id}, version: ${versionHash}, project: ${projectPath || 'global'}`);

    const initialVersion: DocumentVersion = {
      versionHash,
      content: plan,
      createdAt: Date.now()
    };

    const review: Review = {
      id,
      createdAt: Date.now(),
      status: 'pending',
      planContent: plan,
      comments: [],
      documentVersions: [initialVersion],
      currentVersion: versionHash,
      projectPath // 存储项目路径
    };
    
    await this._save(review);
    return review;
  }
  
  // ... 其他方法类似更新
}
```

### 2.2 更新 Review 接口

在 `src/review-manager.ts` 的 `Review` 接口中添加：

```typescript
export interface Review {
  // ... 现有字段
  projectPath?: string;  // 关联的项目路径
}
```

## Phase 3: 添加 Server-Sent Events 端点

### 3.1 更新 `src/http-server.ts`

添加 SSE 端点和 approve API：

```typescript
export class HttpServer {
  private reviewManager: ReviewManager;
  private sseClients: Map<string, Response[]> = new Map(); // reviewId -> clients

  // ... 现有代码

  private setupRoutes() {
    // ... 现有路由

    // SSE: 订阅 review 状态变化
    this.app.get("/api/reviews/:id/events", (req: Request, res: Response) => {
      const reviewId = req.params.id;
      
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // 注册客户端
      if (!this.sseClients.has(reviewId)) {
        this.sseClients.set(reviewId, []);
      }
      this.sseClients.get(reviewId)!.push(res);

      // 发送初始连接确认
      res.write(`data: ${JSON.stringify({ type: 'connected', reviewId })}\n\n`);

      // 清理断开的连接
      req.on('close', () => {
        const clients = this.sseClients.get(reviewId);
        if (clients) {
          const index = clients.indexOf(res);
          if (index > -1) clients.splice(index, 1);
        }
      });
    });

    // 直接 Approve（无评论批准）
    this.app.post("/api/reviews/:id/approve", async (req: Request, res: Response) => {
      try {
        const review = await this.reviewManager.getReview(req.params.id);
        if (!review) {
          res.status(404).json({ error: "Review not found" });
          return;
        }

        // 直接设置状态为 submitted，忽略未 resolve 的 comments
        review.status = 'submitted';
        review.approvedDirectly = true; // 标记为直接批准
        await this.reviewManager._save(review);

        // 通知 SSE 客户端
        this.notifyClients(req.params.id, {
          type: 'approved',
          reviewId: req.params.id,
          hasComments: false
        });

        logger.info(`Review ${req.params.id} approved directly`);
        res.json({ status: "ok", approved: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // 更新 Submit Review 以通知 SSE 客户端
    this.app.post("/api/reviews/:id/submit", async (req: Request, res: Response) => {
      try {
        const review = await this.reviewManager.submitReview(req.params.id);
        
        // 通知 SSE 客户端
        this.notifyClients(req.params.id, {
          type: 'submitted',
          reviewId: req.params.id,
          hasComments: review.comments.length > 0,
          commentsCount: review.comments.length
        });

        res.json({ status: "ok" });
      } catch (e: any) {
        res.status(404).json({ error: e.message });
      }
    });

    // Get Latest Review (for hook script)
    this.app.get("/api/reviews/latest", async (req: Request, res: Response) => {
      const projectPath = req.query.project as string | undefined;
      const review = await this.reviewManager.getLatestReview(projectPath);
      if (!review) {
        res.status(404).json({ error: "No active review" });
        return;
      }
      res.json(review);
    });

    // Create Review via API (for hook script)
    this.app.post("/api/reviews", async (req: Request, res: Response) => {
      try {
        const { plan, projectPath } = req.body;
        if (!plan) {
          res.status(400).json({ error: "Missing 'plan' field" });
          return;
        }

        const review = await this.reviewManager.createReview(plan, projectPath);

        // 自动打开浏览器
        const url = `http://localhost:${this.port}/review/${review.id}`;
        const open = (await import('open')).default;
        await open(url);

        res.json(review);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  // 通知所有订阅指定 review 的 SSE 客户端
  private notifyClients(reviewId: string, data: object) {
    const clients = this.sseClients.get(reviewId);
    if (clients) {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      clients.forEach(client => {
        try {
          client.write(message);
        } catch {
          // 忽略已断开的连接
        }
      });
    }
  }
}
```

### 3.2 更新 Review 接口

```typescript
export interface Review {
  // ... 现有字段
  approvedDirectly?: boolean;  // 是否直接批准（无评论）
}
```

## Phase 4: 创建 Hook 拦截脚本

### 4.1 创建 `scripts/intercept-plan.ts`

```typescript
#!/usr/bin/env node
/**
 * ExitPlanMode 拦截脚本
 * 功能：拦截 ExitPlanMode 调用，创建 review session，阻塞等待用户审核完成
 */

import http from 'http';
import { EventEmitter } from 'events';

const SERVER_HOST = 'localhost';
const SERVER_PORT = 3030;
const POLL_INTERVAL = 2000; // 轮询间隔 2 秒
const MAX_WAIT_TIME = 570000; // 最大等待时间 570 秒（留 30 秒余量）

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    plan?: string;
    summary?: string;
    [key: string]: any;
  };
  tool_use_id: string;
}

interface Review {
  id: string;
  status: 'pending' | 'submitted';
  comments: Array<{
    quote: string;
    comment: string;
  }>;
  approvedDirectly?: boolean;
}

// HTTP 请求封装
function httpRequest(options: http.RequestOptions, postData?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

// 创建 review session
async function createReview(plan: string, projectPath: string): Promise<Review> {
  const postData = JSON.stringify({ plan, projectPath });
  const result = await httpRequest({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/api/reviews',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (result.statusCode !== 200 || !result.data) {
    throw new Error('Failed to create review session');
  }
  return result.data;
}

// 获取 review 状态
async function getReview(reviewId: string): Promise<Review | null> {
  try {
    const result = await httpRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: `/api/reviews/${reviewId}`,
      method: 'GET'
    });
    return result.statusCode === 200 ? result.data : null;
  } catch {
    return null;
  }
}

// 使用 SSE 等待 review 完成
function waitForReviewWithSSE(reviewId: string, timeout: number): Promise<Review | 'timeout'> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    // SSE 连接
    const req = http.get({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: `/api/reviews/${reviewId}/events`,
      headers: { 'Accept': 'text/event-stream' }
    }, (res) => {
      res.on('data', (chunk: Buffer) => {
        if (resolved) return;
        
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'submitted' || event.type === 'approved') {
                resolved = true;
                req.destroy();
                // 获取最新的 review 数据
                getReview(reviewId).then(review => {
                  resolve(review || 'timeout');
                });
                return;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      });
    });

    req.on('error', () => {
      // SSE 失败时回退到轮询
      if (!resolved) {
        resolved = true;
        pollForReview(reviewId, timeout - (Date.now() - startTime)).then(resolve);
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        req.destroy();
        resolve('timeout');
      }
    }, timeout);
  });
}

// 轮询等待 review 完成（SSE 失败时的回退方案）
async function pollForReview(reviewId: string, timeout: number): Promise<Review | 'timeout'> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const review = await getReview(reviewId);
    if (review && review.status === 'submitted') {
      return review;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  
  return 'timeout';
}

// 格式化评论反馈
function formatComments(comments: Review['comments']): string {
  if (comments.length === 0) return '';
  
  return comments.map((item, index) => {
    return `${index + 1}. [引用: "${item.quote}"] → 评论: ${item.comment}`;
  }).join('\n');
}

// 主函数
async function main() {
  let inputData = '';
  
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  try {
    const input: HookInput = JSON.parse(inputData);

    // 只处理 ExitPlanMode
    if (input.tool_name !== 'ExitPlanMode') {
      console.log(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // 提取 plan 内容
    const planContent = input.tool_input?.plan || input.tool_input?.summary || '';

    if (!planContent) {
      console.log(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // 创建 review session
    let review: Review;
    try {
      review = await createReview(planContent, input.cwd);
    } catch (error) {
      // 服务器不可用时，允许通过
      console.error(`Failed to create review: ${error}`);
      console.log(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // 等待用户审核完成
    const result = await waitForReviewWithSSE(review.id, MAX_WAIT_TIME);

    if (result === 'timeout') {
      // 超时，返回 deny 并告知用户手动继续
      const output = {
        decision: 'deny',
        reason: `审核等待超时（Review ID: ${review.id}）。

审核界面已在浏览器中打开。用户可能仍在审核中。

请告知用户：完成审核后，在终端输入 "continue"，然后调用 get_review_result 工具获取审核结果。`
      };
      console.log(JSON.stringify(output));
      process.exit(0);
    }

    // 审核完成
    const reviewResult = result as Review;

    if (reviewResult.approvedDirectly || reviewResult.comments.length === 0) {
      // 用户直接批准，允许 ExitPlanMode 执行
      console.log(JSON.stringify({
        decision: 'approve',
        reason: '用户已在 GUI 中批准计划。'
      }));
    } else {
      // 用户有反馈，阻止并返回评论
      const commentsText = formatComments(reviewResult.comments);
      const output = {
        decision: 'deny',
        reason: `用户对计划有以下修改建议（Review ID: ${reviewResult.id}）：

${commentsText}

请根据以上反馈修改计划，然后再次调用 ExitPlanMode 提交修改后的计划。修改后用户的浏览器会自动刷新显示新版本。`
      };
      console.log(JSON.stringify(output));
    }

    process.exit(0);

  } catch (error) {
    // 出错时允许通过，避免阻塞用户
    console.error(`Hook error: ${error}`);
    console.log(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }
}

main();
```

### 4.2 更新构建配置

在 `tsconfig.json` 中确保包含 scripts 目录：

```json
{
  "compilerOptions": {
    // ... 现有配置
  },
  "include": ["src/**/*", "scripts/**/*"]
}
```

## Phase 5: 更新 MCP 工具

### 5.1 更新 `src/mcp-server.ts`

移除 prompts 和 resources，更新工具描述：

```typescript
export class McpService {
  // ... 现有代码

  private setupTools() {
    // Tool 1: Request Review (手动触发，非 Plan 模式下使用)
    this.server.tool(
      "request_human_review",
      `手动请求人工审核计划。

注意：如果你在 Plan 模式下使用 ExitPlanMode，审核界面会自动打开，无需调用此工具。
此工具用于非 Plan 模式下的手动审核请求。`,
      {
        plan: z.string().describe("需要审核的计划内容（Markdown 格式）"),
        projectPath: z.string().optional().describe("项目路径，用于隔离不同项目的审核记录")
      },
      async ({ plan, projectPath }) => {
        logger.info("Tool called: request_human_review");
        const review = await this.reviewManager.createReview(plan, projectPath);
        const url = `${this.getBaseUrl()}/review/${review.id}`;

        try {
          await open(url);
        } catch (e) {
          logger.error(`Failed to open browser: ${(e as Error).message}`);
        }

        return {
          content: [{
            type: "text",
            text: `审核界面已打开: ${url}

Review ID: ${review.id}

请在浏览器中完成审核，完成后在终端输入 'continue'，然后调用 get_review_result 获取结果。`
          }]
        };
      }
    );

    // Tool 2: Get Review Result
    this.server.tool(
      "get_review_result",
      `获取人工审核的结果。

在以下情况调用此工具：
1. 用户在终端输入 'continue' 后
2. 收到 ExitPlanMode 被阻止的消息后，需要获取详细反馈时`,
      {
        reviewId: z.string().optional().describe("Review ID。如果省略，获取当前项目最新的审核结果"),
        projectPath: z.string().optional().describe("项目路径，用于查找该项目的审核记录")
      },
      async ({ reviewId, projectPath }) => {
        logger.info(`Tool called: get_review_result (reviewId: ${reviewId || 'latest'})`);
        
        let review;
        if (reviewId) {
          review = await this.reviewManager.getReview(reviewId, projectPath);
        } else {
          review = await this.reviewManager.getLatestReview(projectPath);
        }

        if (!review) {
          return {
            content: [{ type: "text", text: "未找到审核记录。" }]
          };
        }

        if (review.status !== 'submitted') {
          return {
            content: [{
              type: "text",
              text: `审核尚未完成（Review ID: ${review.id}）。请等待用户在浏览器中完成审核。`
            }]
          };
        }

        if (review.approvedDirectly || review.comments.length === 0) {
          return {
            content: [{
              type: "text",
              text: `Review ID: ${review.id}

用户已批准计划，无修改建议。可以开始执行。`
            }]
          };
        }

        const commentsText = review.comments
          .map((item, index) => `${index + 1}. [引用: "${item.quote}"] → 评论: ${item.comment}`)
          .join("\n");

        return {
          content: [{
            type: "text",
            text: `Review ID: ${review.id}

用户反馈：

${commentsText}

请根据以上反馈修改计划。`
          }]
        };
      }
    );

    // Tool 3: Update Plan
    this.server.tool(
      "update_plan",
      `更新计划内容。创建新版本，用户浏览器会自动刷新显示更新后的计划。

在收到用户反馈后调用此工具更新计划，然后再次调用 ExitPlanMode 提交新版本供用户审核。`,
      {
        reviewId: z.string().describe("Review ID"),
        newContent: z.string().describe("更新后的计划内容（Markdown 格式）"),
        changeDescription: z.string().optional().describe("变更描述，简要说明修改了什么")
      },
      async ({ reviewId, newContent, changeDescription }) => {
        logger.info(`Tool called: update_plan (reviewId: ${reviewId})`);

        const review = await this.reviewManager.getReview(reviewId);
        if (!review) {
          return {
            content: [{ type: "text", text: `错误：未找到 Review ${reviewId}` }]
          };
        }

        try {
          // 重置状态为 pending，以便用户可以继续审核
          review.status = 'pending';
          review.approvedDirectly = false;
          
          const updatedReview = await this.reviewManager.updatePlanContent(
            reviewId,
            newContent,
            { changeDescription, author: 'agent' }
          );

          const newVersionHash = updatedReview.currentVersion.substring(0, 8);

          return {
            content: [{
              type: "text",
              text: `计划已更新！

- Review ID: ${reviewId}
- 新版本: ${newVersionHash}
- 变更: ${changeDescription || '无描述'}

用户浏览器已自动刷新。请再次调用 ExitPlanMode 提交更新后的计划供用户审核。`
            }]
          };
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `更新失败: ${e.message}` }]
          };
        }
      }
    );
  }
}
```

## Phase 6: Client 添加直接 Approve 功能

### 6.1 在 client 中添加 Approve 按钮

在审核页面添加一个 "Approve" 按钮，点击后显示二次确认对话框：

```vue
<!-- 在适当位置添加 Approve 按钮 -->
<template>
  <!-- ... 现有模板 -->
  
  <div class="review-actions">
    <!-- 现有的 Submit 按钮 -->
    <button @click="submitReview" :disabled="comments.length === 0">
      Submit Feedback
    </button>
    
    <!-- 新增 Approve 按钮 -->
    <button @click="showApproveConfirm = true" class="approve-btn">
      Approve Plan
    </button>
  </div>

  <!-- 二次确认对话框 -->
  <div v-if="showApproveConfirm" class="confirm-dialog-overlay">
    <div class="confirm-dialog">
      <h3>确认批准计划？</h3>
      <p v-if="unresolvedComments > 0" class="warning">
        ⚠️ 当前有 {{ unresolvedComments }} 条未处理的评论，批准后这些评论将被忽略。
      </p>
      <p>批准后，Claude 将开始执行此计划。</p>
      <div class="confirm-actions">
        <button @click="showApproveConfirm = false" class="cancel-btn">
          取消
        </button>
        <button @click="approvePlan" class="confirm-btn">
          确认批准
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const showApproveConfirm = ref(false);

const unresolvedComments = computed(() => {
  return comments.value.filter(c => !c.resolved).length;
});

async function approvePlan() {
  try {
    await fetch(`/api/reviews/${reviewId}/approve`, {
      method: 'POST'
    });
    showApproveConfirm.value = false;
    // 显示成功提示或关闭页面
  } catch (error) {
    console.error('Approve failed:', error);
  }
}
</script>

<style>
.approve-btn {
  background-color: #22c55e;
  color: white;
}

.confirm-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-dialog {
  background: white;
  padding: 24px;
  border-radius: 8px;
  max-width: 400px;
}

.warning {
  color: #f59e0b;
  font-weight: 500;
}
</style>
```

## Phase 7: 更新构建脚本

### 7.1 更新 `package.json`

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "npm run build:server && npm run build:scripts && npm run build:client && npm run copy:hooks",
    "build:server": "tsc",
    "build:scripts": "tsc -p scripts/tsconfig.json",
    "build:client": "cd client && pnpm install && pnpm run build",
    "copy:hooks": "cp -r hooks dist/",
    "prepublishOnly": "npm run build",
    "start": "node dist/index.js"
  },
  "files": [
    "dist",
    "client/dist",
    "plugin.json",
    "hooks"
  ]
}
```

### 7.2 创建 `scripts/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "../dist/scripts",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["./**/*.ts"]
}
```

## 测试验证

完成所有修改后，按以下步骤测试：

1. 构建项目：`npm run build`
2. 启动服务器：`npm start`
3. 在另一个项目中测试插件：`claude plugin add /path/to/cc-plan-review`
4. 进入 Plan 模式测试：`plan 创建一个简单的 TODO 应用`
5. 验证流程：
   - Claude 生成计划后调用 ExitPlanMode
   - Hook 拦截并打开浏览器
   - 在浏览器中测试直接 Approve（二次确认）
   - 测试添加评论后 Submit
   - 验证 Claude 收到反馈并修改计划
6. 测试超时场景（可临时调小 MAX_WAIT_TIME）

## 注意事项

1. Hook 脚本需要 server 已启动才能工作，确保 MCP server 正常运行
2. 超时时间设置为 570 秒，略小于 hook 的 600 秒超时，留有余量
3. 项目隔离基于 cwd 路径，不同目录的项目会有独立的审核记录
4. SSE 连接失败时会自动回退到轮询模式，保证兼容性
