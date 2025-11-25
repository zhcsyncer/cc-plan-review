import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { AddressInfo } from "net";
import { ReviewManager } from "./review-manager.js";
import { McpService } from "./mcp-server.js";
import { logger } from "./logger.js";
import { sseManager } from "./sse-manager.js";
import { reviewEventBus } from "./event-bus.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class HttpServer {
  private app: express.Express;
  private reviewManager: ReviewManager;
  private mcpService: McpService;
  private serverInstance: any;
  public port: number = 0;

  constructor(reviewManager: ReviewManager, mcpService: McpService) {
    this.reviewManager = reviewManager;
    this.mcpService = mcpService;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());

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
    this.app.use(express.static(path.join(__dirname, "../client/dist")));
  }

  private setupRoutes() {
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

        const updatedReview = await this.reviewManager.updatePlanContent(req.params.id, content, {
          changeDescription,
          author: author || 'human',
          resolvedComments
        });

        // 触发版本更新事件
        if (previousVersion !== updatedReview.currentVersion) {
          const newVersion = updatedReview.documentVersions.find(v => v.versionHash === updatedReview.currentVersion);
          if (newVersion) {
            reviewEventBus.emitVersionUpdated(
              req.params.id,
              {
                versionHash: newVersion.versionHash,
                createdAt: newVersion.createdAt,
                changeDescription: newVersion.changeDescription,
                author: newVersion.author
              },
              newVersion.content,
              resolvedComments || []
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

    // Submit Feedback (有批注)
    this.app.post("/api/reviews/:id/submit-feedback", async (req: Request, res: Response) => {
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

    // Approve Review (无批注或接受修改)
    this.app.post("/api/reviews/:id/approve", async (req: Request, res: Response) => {
      try {
        const review = await this.reviewManager.getReview(req.params.id);
        const previousStatus = review?.status;

        const updatedReview = await this.reviewManager.approveReview(req.params.id);

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

    // MCP Streamable HTTP Endpoint
    this.app.post("/mcp", async (req: Request, res: Response) => {
      await this.mcpService.handleRequest(req, res);
    });

    // SPA Fallback
    this.app.get(/^\/review(\/.*)?$/, (req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, "../client/dist/index.html"));
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
    if (this.serverInstance) {
        this.serverInstance.close();
    }
  }
}
