#!/usr/bin/env node
/**
 * Claude Reviewer - MCP Server Implementation
 * 功能：拦截 Claude 的计划，弹出 Web 界面供用户审查，并将结果回传给 Claude。
 *
 * 支持两种传输模式：
 * - stdio (默认): 通过 stdin/stdout 与 Claude Code 通信，适合作为插件使用
 * - http: 通过 HTTP 端点提供 MCP 服务，适合独立部署
 *
 * 用法:
 *   node dist/index.js                    # stdio 模式 (默认)
 *   node dist/index.js --transport=stdio  # stdio 模式 (显式)
 *   node dist/index.js --transport=http   # HTTP 模式
 */
import { ReviewManager } from "./review-manager.js";
import { HttpServer } from "./http-server.js";
import { McpService } from "./mcp-server.js";
import { logger } from "./logger.js";
function parseArgs() {
    const args = process.argv.slice(2);
    const transportArg = args.find(arg => arg.startsWith('--transport='));
    if (transportArg) {
        const value = transportArg.split('=')[1];
        if (value === 'http' || value === 'stdio') {
            return { transport: value };
        }
        logger.warn(`Unknown transport "${value}", falling back to stdio`);
    }
    return { transport: 'stdio' };
}
async function main() {
    try {
        const { transport } = parseArgs();
        logger.info(`Starting Claude Reviewer Server in ${transport} mode...`);
        // 1. Services Initialization
        const reviewManager = new ReviewManager();
        // 2. MCP Service Initialization (port 将在 HTTP 启动后更新)
        let port = 3030;
        const mcpService = new McpService(reviewManager, () => {
            return `http://localhost:${port}`;
        });
        // 3. HTTP Server Initialization
        // stdio 模式下禁用 /mcp 端点，因为 MCP 通过 stdin/stdout 通信
        const httpServer = new HttpServer(reviewManager, mcpService, {
            enableMcpEndpoint: transport === 'http'
        });
        port = await httpServer.start();
        // 4. 根据传输模式启动 MCP
        if (transport === 'stdio') {
            // stdio 模式：通过 stdin/stdout 与 Claude 通信
            await mcpService.startStdioTransport();
            logger.info(`Web UI available at http://localhost:${port}`);
            logger.info("MCP server running in stdio mode (stdin/stdout)");
        }
        else {
            // HTTP 模式：通过 /mcp 端点提供服务
            logger.info(`MCP endpoint available at http://localhost:${port}/mcp`);
            logger.info(`To add this MCP server to Claude Code, run:`);
            logger.info(`  claude mcp add --transport http cc-plan-review http://localhost:${port}/mcp`);
        }
        logger.info("Claude Reviewer Server is fully operational.");
        // Handle graceful shutdown
        const shutdown = async () => {
            logger.info("Shutting down...");
            if (transport === 'stdio') {
                await mcpService.closeStdioTransport();
            }
            httpServer.stop();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (error) {
        logger.error(`Fatal error during startup: ${error.message}`);
        process.exit(1);
    }
}
main();
