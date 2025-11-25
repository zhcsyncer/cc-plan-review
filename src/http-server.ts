import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { AddressInfo } from "net";
import { ReviewManager } from "./review-manager.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class HttpServer {
  private app: express.Express;
  private reviewManager: ReviewManager;
  private serverInstance: any;
  public port: number = 0;

  constructor(reviewManager: ReviewManager) {
    this.reviewManager = reviewManager;
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
        const { content, changeDescription, author } = req.body;

        if (!content || typeof content !== 'string') {
          res.status(400).json({ error: "Missing or invalid 'content' field" });
          return;
        }

        const updatedReview = await this.reviewManager.updatePlanContent(req.params.id, content, {
          changeDescription,
          author: author || 'human'
        });
        res.json(updatedReview);
      } catch (e: any) {
        const statusCode = e.message === 'Review not found' ? 404 : 500;
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

    // Submit Review
    this.app.post("/api/reviews/:id/submit", async (req: Request, res: Response) => {
      try {
        await this.reviewManager.submitReview(req.params.id);
        res.json({ status: "ok" });
      } catch (e: any) {
        res.status(404).json({ error: e.message });
      }
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
