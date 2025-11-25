import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import open from "open";
import { ReviewManager } from "./review-manager.js";
import { logger } from "./logger.js";
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
    // Tool 1: Request Review (Async)
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

    // Tool 2: Get Review Result
    this.server.tool(
        "get_review_result",
        `获取人工审核的结果。

在以下情况调用此工具：
1. 用户在终端输入 'continue' 后
2. 收到 ExitPlanMode 被阻止的消息后，需要获取详细反馈时

返回内容根据状态不同：
- pending: 用户尚未提交审核
- submitted_feedback: 返回用户的所有评论
- questions_pending: 等待用户回答问题
- approved: 计划已批准，可以开始执行
- revised: 等待用户审核新版本`,
        {
            reviewId: z.string().optional().describe("Review ID。如果省略，获取当前项目最新的审核结果"),
            projectPath: z.string().optional().describe("项目路径，用于查找该项目的审核记录")
        },
        async ({ reviewId, projectPath }) => {
            logger.info(`Tool called: get_review_result (reviewId: ${reviewId || 'latest'}, project: ${projectPath || 'global'})`);
            let review;
            if (reviewId) {
                review = await this.reviewManager.getReview(reviewId, projectPath);
            } else {
                review = await this.reviewManager.getLatestReview(projectPath);
            }

            if (!review) {
                logger.info("get_review_result: No active review found");
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: "No active review found." }) }]
                };
            }

            // 根据状态返回不同内容
            switch (review.status) {
                case 'pending':
                    logger.info(`get_review_result: Review ${review.id} is pending`);
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            reviewId: review.id,
                            status: 'pending',
                            message: "User has not submitted the review yet. Please wait for the user to finish."
                        }) }]
                    };

                case 'questions_pending':
                    logger.info(`get_review_result: Review ${review.id} has questions pending`);
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            reviewId: review.id,
                            status: 'questions_pending',
                            message: "Waiting for user to answer your questions. Please wait."
                        }) }]
                    };

                case 'approved':
                    logger.info(`get_review_result: Review ${review.id} approved`);
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            reviewId: review.id,
                            status: 'approved',
                            message: "Plan approved by user. You may proceed with implementation."
                        }) }]
                    };

                case 'revised':
                    logger.info(`get_review_result: Review ${review.id} revised, waiting for user`);
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            reviewId: review.id,
                            status: 'revised',
                            message: "Waiting for user to review the new revision. Please wait."
                        }) }]
                    };

                case 'submitted_feedback':
                default:
                    // 返回用户的 comments
                    const unresolvedComments = (review.comments || []).filter(c => !c.resolved);

                    if (unresolvedComments.length === 0) {
                        logger.info(`get_review_result: Review ${review.id} has no unresolved comments`);
                        return {
                            content: [{ type: "text", text: JSON.stringify({
                                reviewId: review.id,
                                status: 'submitted_feedback',
                                comments: [],
                                message: "No unresolved comments. You can call update_plan to submit new version."
                            }) }]
                        };
                    }

                    const commentsData = unresolvedComments.map(c => ({
                        id: c.id,
                        quote: c.quote,
                        comment: c.comment,
                        answer: c.answer  // 如果之前有 question，这是用户的回答
                    }));

                    logger.info(`get_review_result: Returned ${unresolvedComments.length} comments for review ${review.id}`);
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            reviewId: review.id,
                            status: 'submitted_feedback',
                            comments: commentsData
                        }) }]
                    };
            }
        }
    );

    // Tool 3: Ask Questions
    this.server.tool(
        "ask_questions",
        `Ask questions or acknowledge comments from user feedback.
MUST cover ALL unresolved comments - each comment needs a question entry.

Question types:
- clarification: Need user to explain further (shows text input)
- choice: Provide options for user to choose (shows radio buttons)
- accepted: Acknowledge the comment, provide resolution message

After calling this, status changes to 'questions_pending'.
Wait for user to answer, then call get_review_result again.`,
        {
            reviewId: z.string().describe("The ID of the review."),
            questions: z.array(z.object({
                commentId: z.string().describe("The ID of the comment to respond to."),
                type: z.enum(['clarification', 'choice', 'accepted']).describe("Type of question/response."),
                message: z.string().describe("Your question or acceptance message."),
                options: z.array(z.string()).optional().describe("Options for 'choice' type (required for choice).")
            })).describe("Array of questions/responses for each comment.")
        },
        async ({ reviewId, questions }) => {
            logger.info(`Tool called: ask_questions (reviewId: ${reviewId}, ${questions.length} questions)`);

            try {
                const review = await this.reviewManager.askQuestions(reviewId, questions);

                const acceptedCount = questions.filter(q => q.type === 'accepted').length;
                const pendingCount = questions.filter(q => q.type !== 'accepted').length;

                logger.info(`ask_questions: ${acceptedCount} accepted, ${pendingCount} pending for review ${reviewId}`);

                return {
                    content: [{ type: "text", text: JSON.stringify({
                        success: true,
                        reviewId: review.id,
                        status: review.status,
                        acceptedCount,
                        pendingCount,
                        message: pendingCount > 0
                            ? `Questions sent. ${acceptedCount} comments accepted, ${pendingCount} awaiting user response. Wait for user to answer.`
                            : `All ${acceptedCount} comments accepted. You can now call update_plan.`
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

    // Tool 4: Update Plan
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
