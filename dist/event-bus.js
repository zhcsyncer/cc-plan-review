import { EventEmitter } from 'events';
import { logger } from './logger.js';
class ReviewEventBus extends EventEmitter {
    eventCounter = 0;
    emitReviewEvent(event) {
        const fullEvent = {
            ...event,
            timestamp: Date.now()
        };
        this.eventCounter++;
        logger.debug(`EventBus: Emitting ${event.type} for review ${event.reviewId}`);
        this.emit(`review:${event.reviewId}`, fullEvent);
    }
    subscribeToReview(reviewId, callback) {
        const handler = (event) => callback(event);
        this.on(`review:${reviewId}`, handler);
        logger.debug(`EventBus: Subscribed to review ${reviewId}`);
        return () => {
            this.off(`review:${reviewId}`, handler);
            logger.debug(`EventBus: Unsubscribed from review ${reviewId}`);
        };
    }
    // 便捷方法：发送状态变更事件
    emitStatusChanged(reviewId, status, previousStatus, planContent) {
        this.emitReviewEvent({
            reviewId,
            type: 'status_changed',
            data: { status, previousStatus, planContent }
        });
    }
    // 便捷方法：发送版本更新事件
    emitVersionUpdated(reviewId, version, content, resolvedComments = []) {
        this.emitReviewEvent({
            reviewId,
            type: 'version_updated',
            data: { version, content, resolvedComments }
        });
    }
    // 便捷方法：发送 questions 更新事件
    emitQuestionsUpdated(reviewId, questions) {
        this.emitReviewEvent({
            reviewId,
            type: 'questions_updated',
            data: { questions }
        });
    }
}
export const reviewEventBus = new ReviewEventBus();
