import express, { Request, Response } from "express";
import path from "path";
import { AddressInfo } from "net";
import open from "open";
import { ReviewManager } from "./review-manager.js";
import { McpService } from "./mcp-server.js";
import { logger } from "./logger.js";
import { sseManager } from "./sse-manager.js";
import { reviewEventBus } from "./event-bus.js";

// 获取当前目录（兼容 CJS 打包）
// 使用 path.resolve 确保是绝对路径，避免 sendFile 出错
const currentDir = path.resolve(typeof __dirname !== 'undefined' ? __dirname : path.dirname(new URL(import.meta.url).pathname));
logger.info(`=====> Current directory: ${currentDir}`);
export interface HttpServerOptions {
  enableMcpEndpoint?: boolean;  // 是否启用 /mcp 端点，默认 true
  idleTimeoutMs?: number;       // 空闲超时时间（毫秒），0 表示禁用，默认 30 分钟
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟

export class HttpServer {
  private app: express.Express;
  private reviewManager: ReviewManager;
  private mcpService: McpService;
  private serverInstance: any;
  private options: HttpServerOptions;
  public port: number = 0;

  // 空闲超时相关
  private lastActivityTime: number = Date.now();
  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(reviewManager: ReviewManager, mcpService: McpService, options?: HttpServerOptions) {
    this.reviewManager = reviewManager;
    this.mcpService = mcpService;
    this.options = {
      enableMcpEndpoint: true,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      ...options
    };
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  // 重置活动时间
  private resetActivityTimer() {
    this.lastActivityTime = Date.now();
  }

  // 启动空闲检查
  private startIdleCheck() {
    const timeoutMs = this.options.idleTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) {
      logger.info('Idle timeout disabled');
      return;
    }

    // 每分钟检查一次
    this.idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime;
      if (idleTime >= timeoutMs) {
        logger.info(`Server idle for ${Math.round(idleTime / 60000)} minutes, shutting down...`);
        this.stop();
        process.exit(0);
      }
    }, 60 * 1000);

    logger.info(`Idle timeout set to ${Math.round(timeoutMs / 60000)} minutes`);
  }

  private setupMiddleware() {
    this.app.use(express.json());

    // Activity tracking middleware (reset idle timer)
    this.app.use((req, res, next) => {
      this.resetActivityTimer();
      next();
    });

    // Request Logging Middleware
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`HTTP ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
      });
      next();
    });

    // Serve static files
    this.app.use(express.static(path.join(currentDir, "client")));
  }

  private setupRoutes() {
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
        try {
          await open(url);
          logger.info(`Opened browser at ${url}`);
        } catch (e) {
          logger.warn(`Failed to open browser: ${(e as Error).message}`);
        }

        res.json(review);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
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

    // Get Review Data
    this.app.get("/api/reviews/:id", async (req: Request, res: Response) => {
      const review = await this.reviewManager.getReview(req.params.id);
      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }
      res.json(review);
    });

    // Create Comment
    this.app.post("/api/reviews/:id/comments", async (req: Request, res: Response) => {
      try {
        const { quote, comment, position } = req.body;

        // 验证必需字段
        if (!quote || !comment || !position) {
          res.status(400).json({ error: "Missing required fields: quote, comment, position" });
          return;
        }

        if (typeof position.startOffset !== 'number' || typeof position.endOffset !== 'number') {
          res.status(400).json({ error: "Invalid position: startOffset and endOffset must be numbers" });
          return;
        }

        const newComment = await this.reviewManager.addComment(req.params.id, {
          quote,
          comment,
          position
        });
        res.json(newComment);
      } catch (e: any) {
        const statusCode = e.message === 'Review not found' ? 404 : 500;
        res.status(statusCode).json({ error: e.message });
      }
    });

    // Update Comment
    this.app.put("/api/reviews/:id/comments/:commentId", async (req: Request, res: Response) => {
      try {
        const { comment } = req.body;
        const updated = await this.reviewManager.updateComment(req.params.id, req.params.commentId, comment);
        res.json(updated);
      } catch (e: any) {
        res.status(404).json({ error: e.message });
      }
    });

    // Delete Comment
    this.app.delete("/api/reviews/:id/comments/:commentId", async (req: Request, res: Response) => {
      try {
        await this.reviewManager.deleteComment(req.params.id, req.params.commentId);
        res.json({ status: "ok" });
      } catch (e: any) {
        res.status(404).json({ error: e.message });
      }
    });

    // Update Plan Content (creates new version)
    this.app.put("/api/reviews/:id/plan", async (req: Request, res: Response) => {
      try {
        const { content, changeDescription, author, resolvedComments } = req.body;

        if (!content || typeof content !== 'string') {
          res.status(400).json({ error: "Missing or invalid 'content' field" });
          return;
        }

        const review = await this.reviewManager.getReview(req.params.id);
        const previousStatus = review?.status;
        const previousVersion = review?.currentVersion;
        // 记录更新前未解决的评论 ID
        const previousUnresolvedIds = review?.comments.filter(c => !c.resolved).map(c => c.id) || [];

        const updatedReview = await this.reviewManager.updatePlanContent(req.params.id, content, {
          changeDescription,
          author: author || 'human',
          resolvedComments
        });

        // 触发版本更新事件
        if (previousVersion !== updatedReview.currentVersion) {
          const newVersion = updatedReview.documentVersions.find(v => v.versionHash === updatedReview.currentVersion);
          if (newVersion) {
            // 计算实际被 resolve 的评论（从未解决变为已解决）
            const actuallyResolved = updatedReview.comments
              .filter(c => c.resolved && previousUnresolvedIds.includes(c.id))
              .map(c => ({ commentId: c.id, resolution: c.resolution || '已在修订版本中处理' }));

            reviewEventBus.emitVersionUpdated(
              req.params.id,
              {
                versionHash: newVersion.versionHash,
                createdAt: newVersion.createdAt,
                changeDescription: newVersion.changeDescription,
                author: newVersion.author
              },
              newVersion.content,
              actuallyResolved
            );
          }
        }

        // 触发状态变更事件
        if (previousStatus && previousStatus !== updatedReview.status) {
          reviewEventBus.emitStatusChanged(req.params.id, updatedReview.status, previousStatus);
        }

        res.json(updatedReview);
      } catch (e: any) {
        const statusCode = e.message.includes('not found') ? 404 : 400;
        res.status(statusCode).json({ error: e.message });
      }
    });

    // Get Version List
    this.app.get("/api/reviews/:id/versions", async (req: Request, res: Response) => {
      try {
        const review = await this.reviewManager.getReview(req.params.id);
        if (!review) {
          res.status(404).json({ error: "Review not found" });
          return;
        }
        const versions = this.reviewManager.getVersionList(review);
        res.json({
          currentVersion: review.currentVersion,
          versions
        });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Get Specific Version Content
    this.app.get("/api/reviews/:id/versions/:hash", async (req: Request, res: Response) => {
      try {
        const review = await this.reviewManager.getReview(req.params.id);
        if (!review) {
          res.status(404).json({ error: "Review not found" });
          return;
        }
        const version = this.reviewManager.getDocumentVersion(review, req.params.hash);
        if (!version) {
          res.status(404).json({ error: "Version not found" });
          return;
        }
        res.json(version);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Get Diff between two versions
    this.app.get("/api/reviews/:id/diff", async (req: Request, res: Response) => {
      try {
        const { from, to } = req.query;
        if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
          res.status(400).json({ error: "Missing 'from' and 'to' query parameters" });
          return;
        }

        const review = await this.reviewManager.getReview(req.params.id);
        if (!review) {
          res.status(404).json({ error: "Review not found" });
          return;
        }

        const diff = this.reviewManager.computeDiff(review, from, to);
        if (!diff) {
          res.status(404).json({ error: "One or both versions not found" });
          return;
        }
        res.json(diff);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Rollback to a specific version
    this.app.post("/api/reviews/:id/rollback", async (req: Request, res: Response) => {
      try {
        const { versionHash } = req.body;
        if (!versionHash || typeof versionHash !== 'string') {
          res.status(400).json({ error: "Missing or invalid 'versionHash' field" });
          return;
        }

        const updatedReview = await this.reviewManager.rollbackToVersion(req.params.id, versionHash);
        res.json(updatedReview);
      } catch (e: any) {
        const statusCode = e.message === 'Review not found' || e.message === 'Version not found' ? 404 : 500;
        res.status(statusCode).json({ error: e.message });
      }
    });

    // SSE Event Stream
    this.app.get("/api/reviews/:id/events", async (req: Request, res: Response) => {
      const review = await this.reviewManager.getReview(req.params.id);
      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }

      // 注册 SSE 客户端
      const clientId = sseManager.registerClient(req.params.id, res);

      // 发送初始连接数据
      sseManager.sendConnectedEvent(clientId, review);

      logger.info(`SSE: Client connected for review ${req.params.id}`);
    });

    // Request Changes (有批注，请求修改)
    this.app.post("/api/reviews/:id/request-changes", async (req: Request, res: Response) => {
      try {
        const review = await this.reviewManager.getReview(req.params.id);
        const previousStatus = review?.status;

        const updatedReview = await this.reviewManager.submitFeedback(req.params.id);

        // 触发状态变更事件
        if (previousStatus && previousStatus !== updatedReview.status) {
          reviewEventBus.emitStatusChanged(req.params.id, updatedReview.status, previousStatus);
        }

        res.json({ status: "ok", reviewStatus: updatedReview.status });
      } catch (e: any) {
        const statusCode = e.message.includes('not found') ? 404 : 400;
        res.status(statusCode).json({ error: e.message });
      }
    });

    // Approve Review (直接批准，忽略状态验证)
    this.app.post("/api/reviews/:id/approve", async (req: Request, res: Response) => {
      try {
        const { note } = req.body || {};
        const review = await this.reviewManager.getReview(req.params.id);
        if (!review) {
          res.status(404).json({ error: "Review not found" });
          return;
        }

        const previousStatus = review.status;

        // 直接设置为 approved 状态（状态名不变）
        review.status = 'approved';
        review.approvedDirectly = true;
        if (note) {
          review.approvalNote = note;
        }
        await this.reviewManager._save(review);

        // 触发状态变更事件（approved 时包含 planContent）
        if (previousStatus !== review.status) {
          reviewEventBus.emitStatusChanged(req.params.id, review.status, previousStatus, review.planContent);
        }

        logger.info(`Review ${req.params.id} approved directly`);
        res.json({ status: "ok", reviewStatus: review.status });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Ask Questions (Agent 提问)
    this.app.post("/api/reviews/:id/ask-questions", async (req: Request, res: Response) => {
      try {
        const { questions } = req.body;
        if (!questions || !Array.isArray(questions)) {
          res.status(400).json({ error: "Missing or invalid 'questions' array" });
          return;
        }

        const review = await this.reviewManager.getReview(req.params.id);
        const previousStatus = review?.status;

        const updatedReview = await this.reviewManager.askQuestions(req.params.id, questions);

        // 触发状态变更事件
        if (previousStatus && previousStatus !== updatedReview.status) {
          reviewEventBus.emitStatusChanged(req.params.id, updatedReview.status, previousStatus);
        }

        // 触发 questions 更新事件
        const questionsData = questions.map(q => ({
          commentId: q.commentId,
          question: {
            type: q.type,
            message: q.message,
            options: q.options
          }
        }));
        reviewEventBus.emitQuestionsUpdated(req.params.id, questionsData);

        res.json({ status: "ok", reviewStatus: updatedReview.status });
      } catch (e: any) {
        const statusCode = e.message.includes('not found') ? 404 : 400;
        res.status(statusCode).json({ error: e.message });
      }
    });

    // Answer Question (用户回答)
    this.app.post("/api/reviews/:id/comments/:commentId/answer", async (req: Request, res: Response) => {
      try {
        const { answer } = req.body;
        if (!answer || typeof answer !== 'string') {
          res.status(400).json({ error: "Missing or invalid 'answer' field" });
          return;
        }

        const comment = await this.reviewManager.answerQuestion(
          req.params.id,
          req.params.commentId,
          answer
        );

        if (!comment) {
          res.status(404).json({ error: "Comment not found or has no question" });
          return;
        }

        res.json({ status: "ok", comment });
      } catch (e: any) {
        const statusCode = e.message.includes('not found') ? 404 : 400;
        res.status(statusCode).json({ error: e.message });
      }
    });

    // MCP Streamable HTTP Endpoint (仅在 HTTP 传输模式下启用)
    if (this.options.enableMcpEndpoint) {
      this.app.post("/mcp", async (req: Request, res: Response) => {
        await this.mcpService.handleRequest(req, res);
      });
    }

    // SPA Fallback
    this.app.get(/^\/review(\/.*)?$/, (req: Request, res: Response) => {
        // Express 5 requires root option for sendFile
        res.sendFile("index.html", { root: path.join(currentDir, "client") });
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryListen = (port: number) => {
        const server = this.app.listen(port);

        server.on('listening', () => {
          this.serverInstance = server;
          const address = server.address() as AddressInfo;
          this.port = address.port;
          logger.info(`API Server running at http://localhost:${this.port}`);

          // 启动空闲检查
          this.startIdleCheck();

          resolve(this.port);
        });

        server.on('error', (err: any) => {
          if (port === 3030 && err.code === 'EADDRINUSE') {
            logger.info('Port 3030 is in use, trying a random port...');
            tryListen(0);
          } else {
            reject(err);
          }
        });
      };

      tryListen(3030);
    });
  }

  stop() {
    // 清除空闲检查定时器
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    if (this.serverInstance) {
      this.serverInstance.close();
    }
  }
}
