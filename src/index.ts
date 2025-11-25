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

    // 2. HTTP Server Initialization
    const httpServer = new HttpServer(reviewManager);
    const port = await httpServer.start();

    // 3. MCP Server Initialization
    const mcpService = new McpService(reviewManager, () => {
      return `http://localhost:${port}`;
    });
    await mcpService.start();

    logger.info("Claude Reviewer Server is fully operational.");

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
