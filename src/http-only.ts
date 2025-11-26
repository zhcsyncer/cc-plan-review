#!/usr/bin/env node
/**
 * HTTP-only server entry point
 * 仅启动 HTTP server，不启动 MCP stdio transport
 * 供 hooks 脚本按需 spawn 使用
 */

import { ReviewManager } from './review-manager.js';
import { McpService } from './mcp-server.js';
import { HttpServer } from './http-server.js';
import { logger } from './logger.js';

async function main() {
  logger.info('Starting HTTP-only server...');

  const reviewManager = new ReviewManager();
  const mcpService = new McpService(reviewManager);

  const httpServer = new HttpServer(reviewManager, mcpService, {
    enableMcpEndpoint: false,  // 不启用 MCP HTTP 端点
    idleTimeoutMs: 30 * 60 * 1000  // 30 分钟空闲超时
  });

  try {
    const port = await httpServer.start();
    logger.info(`HTTP-only server started on port ${port}`);

    // 输出 JSON 到 stdout，供调用者获取端口信息
    console.log(JSON.stringify({ status: 'ready', port }));
  } catch (error) {
    logger.error(`Failed to start HTTP server: ${(error as Error).message}`);
    console.log(JSON.stringify({ status: 'error', error: (error as Error).message }));
    process.exit(1);
  }

  // 优雅关闭
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    httpServer.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    httpServer.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
