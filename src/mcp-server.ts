import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import open from "open";
import { ReviewManager } from "./review-manager.js";
import { logger } from "./logger.js";
import type { Request, Response } from "express";

export class McpService {
  private server: McpServer;
  private reviewManager: ReviewManager;
  private getBaseUrl: () => string;

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
      "Requests a human review for the provided plan. This tool is non-blocking. It opens a browser for the user to review. You must wait for the user to signal 'continue' before fetching results.",
      {
        plan: z.string().describe("The detailed execution plan in Markdown format."),
      },
      async ({ plan }) => {
        logger.info("Tool called: request_human_review");
        const review = await this.reviewManager.createReview(plan);
        const url = `${this.getBaseUrl()}/review/${review.id}`;

        logger.info(`Opening browser at ${url}`);
        // Open Browser
        try {
          await open(url);
        } catch (e) {
          logger.error(`Failed to open browser: ${(e as Error).message}`);
        }

        return {
          content: [{ type: "text", text: `Review interface opened at ${url}. Please review the plan in the browser, and type 'continue' in the chat when you are done.` }]
        };
      }
    );

    // Tool 2: Get Review Result
    this.server.tool(
        "get_review_result",
        `Get user's review feedback. Returns different content based on status:
- pending: User hasn't submitted yet
- submitted_feedback: Returns all comments with user feedback
- questions_pending: Waiting for user to answer your questions
- approved: Plan approved, proceed with implementation
- revised: Waiting for user to review new revision

WORKFLOW: After getting 'submitted_feedback', analyze comments and either:
1. Call ask_questions if any comment needs clarification
2. Call update_plan if all comments are clear`,
        {
            reviewId: z.string().optional().describe("The ID of the review. If omitted, fetches the latest active review."),
        },
        async ({ reviewId }) => {
            logger.info(`Tool called: get_review_result (reviewId: ${reviewId || 'latest'})`);
            let review;
            if (reviewId) {
                review = await this.reviewManager.getReview(reviewId);
            } else {
                review = await this.reviewManager.getLatestReview();
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
        `Submit a new version of the plan.
Only call when ALL comments are clear (no pending questions).

Provide resolvedComments to mark which comments were addressed.
After calling this, status changes to 'revised' and user can review.`,
        {
            reviewId: z.string().describe("The ID of the review to update."),
            newContent: z.string().describe("The updated plan content in Markdown format."),
            changeDescription: z.string().optional().describe("A brief description of the changes made."),
            resolvedComments: z.array(z.object({
                commentId: z.string().describe("The ID of the resolved comment."),
                resolution: z.string().describe("Explanation of how this comment was addressed.")
            })).optional().describe("Array of comments that were addressed in this update.")
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
}
