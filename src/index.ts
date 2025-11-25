#!/usr/bin/env node

/**
 * Claude Reviewer - MCP Server Implementation
 * 功能：拦截 Claude 的计划，弹出 Web 界面供用户审查，并将结果回传给 Claude。
 */

import { ReviewManager } from "./review-manager.js";
import { HttpServer } from "./http-server.js";
import { McpService } from "./mcp-server.js";
import { logger } from "./logger.js";

async function main() {
  try {
    logger.info("Starting Claude Reviewer Server...");

    // 1. Services Initialization
    const reviewManager = new ReviewManager();

    // 2. MCP Service Initialization (port 将在 HTTP 启动后更新)
    let port = 3030;
    const mcpService = new McpService(reviewManager, () => {
      return `http://localhost:${port}`;
    });

    // 3. HTTP Server Initialization (包含 MCP 端点)
    const httpServer = new HttpServer(reviewManager, mcpService);
    port = await httpServer.start();

    logger.info(`MCP endpoint available at http://localhost:${port}/mcp`);
    logger.info("Claude Reviewer Server is fully operational.");
    logger.info(`To add this MCP server to Claude Code, run:`);
    logger.info(`  claude mcp add --transport http cc-plan-review http://localhost:${port}/mcp`);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        logger.info("Received SIGINT. Shutting down...");
        httpServer.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        logger.info("Received SIGTERM. Shutting down...");
        httpServer.stop();
        process.exit(0);
    });

  } catch (error) {
    logger.error(`Fatal error during startup: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
