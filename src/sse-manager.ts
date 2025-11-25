import type { Response } from 'express';
import { logger } from './logger.js';
import { reviewEventBus, type ReviewEvent } from './event-bus.js';

interface SSEClient {
  id: string;
  reviewId: string;
  res: Response;
  unsubscribe: () => void;
}

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private clientIdCounter = 0;

  constructor() {
    this.startHeartbeat();
  }

  // 注册新的 SSE 客户端
  registerClient(reviewId: string, res: Response): string {
    const clientId = `sse-${++this.clientIdCounter}-${Date.now()}`;

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 订阅事件
    const unsubscribe = reviewEventBus.subscribeToReview(reviewId, (event) => {
      this.sendEvent(clientId, event);
    });

    const client: SSEClient = {
      id: clientId,
      reviewId,
      res,
      unsubscribe
    };

    this.clients.set(clientId, client);
    logger.info(`SSE: Client ${clientId} connected for review ${reviewId}`);

    // 处理客户端断开
    res.on('close', () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  // 发送事件到指定客户端
  private sendEvent(clientId: string, event: ReviewEvent): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const eventData = JSON.stringify(event.data);
      client.res.write(`event: ${event.type}\n`);
      client.res.write(`id: ${event.timestamp}\n`);
      client.res.write(`data: ${eventData}\n\n`);
    } catch (e) {
      logger.error(`SSE: Failed to send event to client ${clientId}: ${(e as Error).message}`);
      this.removeClient(clientId);
    }
  }

  // 发送初始连接数据
  sendConnectedEvent(clientId: string, reviewData: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const eventData = JSON.stringify({ review: reviewData });
      client.res.write(`event: connected\n`);
      client.res.write(`id: ${Date.now()}\n`);
      client.res.write(`data: ${eventData}\n\n`);
      logger.debug(`SSE: Sent connected event to client ${clientId}`);
    } catch (e) {
      logger.error(`SSE: Failed to send connected event to client ${clientId}: ${(e as Error).message}`);
      this.removeClient(clientId);
    }
  }

  // 移除客户端
  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.unsubscribe();
      this.clients.delete(clientId);
      logger.info(`SSE: Client ${clientId} disconnected`);
    }
  }

  // 启动心跳定时器
  private startHeartbeat(): void {
    const HEARTBEAT_INTERVAL = 30000; // 30秒

    this.heartbeatInterval = setInterval(() => {
      const timestamp = Date.now();
      for (const [clientId, client] of this.clients) {
        try {
          client.res.write(`event: heartbeat\n`);
          client.res.write(`id: ${timestamp}\n`);
          client.res.write(`data: ${JSON.stringify({ timestamp })}\n\n`);
        } catch (e) {
          logger.warn(`SSE: Heartbeat failed for client ${clientId}, removing`);
          this.removeClient(clientId);
        }
      }
    }, HEARTBEAT_INTERVAL);

    logger.info(`SSE: Heartbeat started (${HEARTBEAT_INTERVAL}ms interval)`);
  }

  // 停止心跳
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.info('SSE: Heartbeat stopped');
    }
  }

  // 获取当前连接数
  getClientCount(): number {
    return this.clients.size;
  }

  // 获取指定 review 的连接数
  getClientCountForReview(reviewId: string): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.reviewId === reviewId) count++;
    }
    return count;
  }
}

export const sseManager = new SSEManager();
