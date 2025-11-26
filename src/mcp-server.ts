import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// import open from "open";  // 已禁用 request_human_review 工具
import { ReviewManager } from "./review-manager.js";
import { logger } from "./logger.js";
import { reviewEventBus } from "./event-bus.js";
import type { Request, Response } from "express";

export class McpService {
  private server: McpServer;
  private reviewManager: ReviewManager;
  private getBaseUrl: () => string;
  private stdioTransport?: StdioServerTransport;

  constructor(reviewManager: ReviewManager, getBaseUrl: () => string) {
    this.reviewManager = reviewManager;
    this.getBaseUrl = getBaseUrl;
    this.server = new McpServer({
      name: "gui-reviewer",
      version: "2.0.0",
    });
    this.setupTools();
  }

  private setupTools() {
    // Tool 1: Request Review (Async) - 已禁用，通过 ExitPlanMode hook 自动触发
    /*
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

        logger.info(`Opening browser at ${url}`);
        // Open Browser
        try {
          await open(url);
        } catch (e) {
          logger.error(`Failed to open browser: ${(e as Error).message}`);
        }

        return {
          content: [{ type: "text", text: `审核界面已打开: ${url}

Review ID: ${review.id}

请在浏览器中完成审核，完成后在终端输入 'continue'，然后调用 get_review_result 获取结果。` }]
        };
      }
    );
    */

    // Tool 2: Ask Questions (阻塞等待用户回答)
    this.server.tool(
        "ask_questions",
        `Ask questions or acknowledge comments from user feedback.
MUST cover ALL unresolved comments - each comment needs a question entry.

Question types:
- clarification: Need user to explain further (shows text input)
- choice: Provide options for user to choose (shows radio buttons)
- multiChoice: Allow user to select multiple options (shows checkboxes)
- accepted: Acknowledge the comment, provide resolution message

This tool will BLOCK until user submits their answers (timeout: 10 minutes).`,
        {
            reviewId: z.string().describe("The ID of the review."),
            questions: z.array(z.object({
                commentId: z.string().describe("The ID of the comment to respond to."),
                type: z.enum(['clarification', 'choice', 'multiChoice', 'accepted']).describe("Type of question/response."),
                message: z.string().describe("Your question or acceptance message."),
                options: z.array(z.string()).optional().describe("Options for 'choice' or 'multiChoice' type (required for choice/multiChoice).")
            })).describe("Array of questions/responses for each comment.")
        },
        async ({ reviewId, questions }) => {
            logger.info(`Tool called: ask_questions (reviewId: ${reviewId}, ${questions.length} questions)`);

            const WAIT_TIMEOUT = 10 * 60 * 1000; // 10 分钟超时
            const POLL_INTERVAL = 2000; // 2 秒轮询

            try {
                // 获取之前的状态
                const beforeReview = await this.reviewManager.getReview(reviewId);
                const previousStatus = beforeReview?.status;

                const review = await this.reviewManager.askQuestions(reviewId, questions);

                const acceptedCount = questions.filter(q => q.type === 'accepted').length;
                const pendingCount = questions.filter(q => q.type !== 'accepted').length;

                // 发送 SSE 事件通知前端
                if (previousStatus && previousStatus !== review.status) {
                    reviewEventBus.emitStatusChanged(reviewId, review.status, previousStatus);
                }

                // 发送 questions 更新事件
                const questionsData = questions.map(q => ({
                    commentId: q.commentId,
                    question: {
                        type: q.type,
                        message: q.message,
                        options: q.options
                    }
                }));
                reviewEventBus.emitQuestionsUpdated(reviewId, questionsData);

                logger.info(`ask_questions: ${acceptedCount} accepted, ${pendingCount} pending for review ${reviewId}`);

                // 如果没有待回答的问题，直接返回
                if (pendingCount === 0) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            reviewId: review.id,
                            status: review.status,
                            acceptedCount,
                            pendingCount: 0,
                            message: `All ${acceptedCount} comments accepted.`
                        }) }]
                    };
                }

                // 阻塞等待用户回答（轮询状态变化）
                logger.info(`ask_questions: Waiting for user to answer questions...`);
                const startTime = Date.now();

                while (Date.now() - startTime < WAIT_TIMEOUT) {
                    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

                    const currentReview = await this.reviewManager.getReview(reviewId);
                    if (!currentReview) {
                        logger.warn(`ask_questions: Review ${reviewId} not found during wait`);
                        break;
                    }

                    // 状态从 discussing 变化，说明用户已提交回答
                    if (currentReview.status !== 'discussing') {
                        logger.info(`ask_questions: User answered, status changed to ${currentReview.status}`);

                        // 收集用户的回答
                        const answers = currentReview.comments
                            .filter(c => c.question && c.answer)
                            .map(c => ({
                                commentId: c.id,
                                question: c.question?.message,
                                answer: c.answer
                            }));

                        return {
                            content: [{ type: "text", text: JSON.stringify({
                                success: true,
                                reviewId: currentReview.id,
                                status: currentReview.status,
                                answers,
                                message: `User has answered ${answers.length} questions.`
                            }) }]
                        };
                    }
                }

                // 超时
                logger.warn(`ask_questions: Timeout waiting for user answers`);
                return {
                    content: [{ type: "text", text: JSON.stringify({
                        success: false,
                        reviewId,
                        status: 'discussing',
                        error: 'Timeout waiting for user to answer questions (10 minutes).',
                        message: 'Please ask the user to complete their answers in the browser, then retry ask_questions or modify the plan and re-submit via ExitPlanMode.'
                    }) }]
                };

            } catch (e: any) {
                logger.error(`ask_questions failed: ${e.message}`);
                return {
                    content: [{ type: "text", text: JSON.stringify({
                        success: false,
                        error: e.message
                    }) }]
                };
            }
        }
    );

    // Tool 4: Update Plan - 已禁用，修订版本通过 ExitPlanMode + REVIEW_ID 标记提交
    /*
    this.server.tool(
        "update_plan",
        `更新计划内容。创建新版本，用户浏览器会自动刷新显示更新后的计划。

在收到用户反馈后调用此工具更新计划，然后再次调用 ExitPlanMode 提交新版本供用户审核。`,
        {
            reviewId: z.string().describe("Review ID"),
            newContent: z.string().describe("更新后的计划内容（Markdown 格式）"),
            changeDescription: z.string().optional().describe("变更描述，简要说明修改了什么"),
            resolvedComments: z.array(z.object({
                commentId: z.string().describe("已解决的评论 ID"),
                resolution: z.string().describe("解决说明，说明如何处理了这个评论")
            })).optional().describe("本次更新解决的评论列表")
        },
        async ({ reviewId, newContent, changeDescription, resolvedComments }) => {
            logger.info(`Tool called: update_plan (reviewId: ${reviewId})`);

            const review = await this.reviewManager.getReview(reviewId);
            if (!review) {
                logger.warn(`update_plan: Review ${reviewId} not found`);
                return {
                    content: [{ type: "text", text: JSON.stringify({
                        success: false,
                        error: `Review ${reviewId} not found.`
                    }) }]
                };
            }

            try {
                const updatedReview = await this.reviewManager.updatePlanContent(
                    reviewId,
                    newContent,
                    {
                        changeDescription,
                        author: 'agent',
                        resolvedComments
                    }
                );

                const versionCount = updatedReview.documentVersions.length;
                const newVersionHash = updatedReview.currentVersion.substring(0, 8);
                const resolvedCount = resolvedComments?.length || 0;

                logger.info(`update_plan: Created version ${newVersionHash} for review ${reviewId}, resolved ${resolvedCount} comments`);

                return {
                    content: [{ type: "text", text: JSON.stringify({
                        success: true,
                        reviewId,
                        status: updatedReview.status,
                        newVersion: newVersionHash,
                        totalVersions: versionCount,
                        resolvedCommentsCount: resolvedCount,
                        changeDescription: changeDescription || 'No description',
                        message: "Plan updated successfully. User's browser will refresh to show the new version."
                    }) }]
                };
            } catch (e: any) {
                logger.error(`update_plan failed: ${e.message}`);
                return {
                    content: [{ type: "text", text: JSON.stringify({
                        success: false,
                        error: e.message
                    }) }]
                };
            }
        }
    );
    */
  }

  async handleRequest(req: Request, res: Response) {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,  // 无状态模式
        enableJsonResponse: true
      });

      res.on('close', () => {
        transport.close();
      });

      await this.server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error(`MCP request error: ${(error as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  }

  /**
   * 启动 stdio 传输模式
   * 用于 Claude Code 插件模式，通过 stdin/stdout 与 Claude 通信
   */
  async startStdioTransport(): Promise<void> {
    this.stdioTransport = new StdioServerTransport();
    await this.server.connect(this.stdioTransport);
    logger.info('MCP server connected via stdio transport');
  }

  /**
   * 关闭 stdio 传输
   */
  async closeStdioTransport(): Promise<void> {
    if (this.stdioTransport) {
      await this.stdioTransport.close();
      this.stdioTransport = undefined;
    }
  }
}
