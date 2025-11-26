import { EventEmitter } from 'events';
import { logger } from './logger.js';
import type { ReviewStatus, CommentQuestion } from './review-manager.js';

// SSE 事件类型
export type SSEEventType =
  | 'connected'         // 连接建立，返回完整 Review 数据
  | 'status_changed'    // 状态变更
  | 'version_updated'   // 新版本提交
  | 'questions_updated' // Agent 提交了 questions
  | 'heartbeat';        // 心跳

// 事件数据类型
export interface StatusChangedData {
  status: ReviewStatus;
  previousStatus: ReviewStatus;
  planContent?: string;  // 当 status === 'approved' 时包含最终批准的内容
}

export interface VersionUpdatedData {
  version: {
    versionHash: string;
    createdAt: number;
    changeDescription?: string;
    author?: 'human' | 'agent';
  };
  content: string;
  resolvedComments: Array<{ commentId: string; resolution: string }>;
}

export interface QuestionsUpdatedData {
  questions: Array<{
    commentId: string;
    question: CommentQuestion;
  }>;
}

export interface ReviewEvent {
  reviewId: string;
  type: SSEEventType;
  data: StatusChangedData | VersionUpdatedData | QuestionsUpdatedData | { timestamp: number } | unknown;
  timestamp: number;
}

class ReviewEventBus extends EventEmitter {
  private eventCounter = 0;

  emitReviewEvent(event: Omit<ReviewEvent, 'timestamp'>): void {
    const fullEvent: ReviewEvent = {
      ...event,
      timestamp: Date.now()
    };
    this.eventCounter++;
    logger.debug(`EventBus: Emitting ${event.type} for review ${event.reviewId}`);
    this.emit(`review:${event.reviewId}`, fullEvent);
  }

  subscribeToReview(reviewId: string, callback: (event: ReviewEvent) => void): () => void {
    const handler = (event: ReviewEvent) => callback(event);
    this.on(`review:${reviewId}`, handler);
    logger.debug(`EventBus: Subscribed to review ${reviewId}`);

    return () => {
      this.off(`review:${reviewId}`, handler);
      logger.debug(`EventBus: Unsubscribed from review ${reviewId}`);
    };
  }

  // 便捷方法：发送状态变更事件
  emitStatusChanged(reviewId: string, status: ReviewStatus, previousStatus: ReviewStatus, planContent?: string): void {
    this.emitReviewEvent({
      reviewId,
      type: 'status_changed',
      data: { status, previousStatus, planContent }
    });
  }

  // 便捷方法：发送版本更新事件
  emitVersionUpdated(
    reviewId: string,
    version: VersionUpdatedData['version'],
    content: string,
    resolvedComments: VersionUpdatedData['resolvedComments'] = []
  ): void {
    this.emitReviewEvent({
      reviewId,
      type: 'version_updated',
      data: { version, content, resolvedComments }
    });
  }

  // 便捷方法：发送 questions 更新事件
  emitQuestionsUpdated(reviewId: string, questions: QuestionsUpdatedData['questions']): void {
    this.emitReviewEvent({
      reviewId,
      type: 'questions_updated',
      data: { questions }
    });
  }
}

export const reviewEventBus = new ReviewEventBus();
