import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import open from "open";
import { ReviewManager } from "./review-manager.js";
import { logger } from "./logger.js";

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
        "Retrieves the result of the human review. Call this only after the user has signaled they are done (e.g., by typing 'continue').",
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
                    content: [{ type: "text", text: "No active review found." }]
                };
            }

            if (review.status !== 'submitted') {
                 logger.info(`get_review_result: Review ${review.id} is pending`);
                 return {
                    content: [{ type: "text", text: "User has not submitted the review yet. Please wait for the user to finish." }]
                };
            }

            // Format Comments
            const comments = review.comments || [];
            if (comments.length === 0) {
                logger.info(`get_review_result: Review ${review.id} approved with no comments`);
                return {
                    content: [{ type: "text", text: `Review ID: ${review.id}\n\nUser has approved the plan with no comments.` }]
                };
            }

            const commentsText = comments
              .map((item, index) => {
                return `${index + 1}. [Quote: "${item.quote}"] -> Comment: ${item.comment}`;
              })
              .join("\n");

            logger.info(`get_review_result: Returned ${comments.length} comments for review ${review.id}`);
            return {
                content: [{ type: "text", text: `Review ID: ${review.id}\n\nUser feedback:\n\n${commentsText}` }]
            };
        }
    );

    // Tool 3: Update Plan
    this.server.tool(
        "update_plan",
        "Updates the plan content based on review feedback. Creates a new version. The user's browser will automatically refresh to show the updated plan.",
        {
            reviewId: z.string().describe("The ID of the review to update."),
            newContent: z.string().describe("The updated plan content in Markdown format."),
            changeDescription: z.string().optional().describe("A brief description of the changes made (e.g., 'Added error handling section').")
        },
        async ({ reviewId, newContent, changeDescription }) => {
            logger.info(`Tool called: update_plan (reviewId: ${reviewId})`);

            const review = await this.reviewManager.getReview(reviewId);
            if (!review) {
                logger.warn(`update_plan: Review ${reviewId} not found`);
                return {
                    content: [{ type: "text", text: `Error: Review ${reviewId} not found.` }]
                };
            }

            try {
                const updatedReview = await this.reviewManager.updatePlanContent(
                    reviewId,
                    newContent,
                    {
                        changeDescription,
                        author: 'agent'
                    }
                );

                const versionCount = updatedReview.documentVersions.length;
                const newVersionHash = updatedReview.currentVersion.substring(0, 8);

                logger.info(`update_plan: Created version ${newVersionHash} for review ${reviewId}`);

                return {
                    content: [{
                        type: "text",
                        text: `Plan updated successfully!\n\n- Review ID: ${reviewId}\n- New version: ${newVersionHash}\n- Total versions: ${versionCount}\n- Change: ${changeDescription || 'No description'}\n\nThe user's browser will automatically refresh to show the updated plan.`
                    }]
                };
            } catch (e: any) {
                logger.error(`update_plan failed: ${e.message}`);
                return {
                    content: [{ type: "text", text: `Error updating plan: ${e.message}` }]
                };
            }
        }
    );
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("MCP Server started and connected to stdio");
  }
}
