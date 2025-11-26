import { ref, onMounted, onUnmounted, type Ref } from 'vue';

// 事件类型
export type SSEEventType =
  | 'connected'
  | 'status_changed'
  | 'version_updated'
  | 'questions_updated'
  | 'heartbeat';

// Review 状态类型 (PR 风格命名)
export type ReviewStatus =
  | 'open'              // 打开状态，等待用户审阅
  | 'changes_requested' // 请求更改
  | 'discussing'        // 讨论中
  | 'approved'          // 已批准
  | 'updated';          // 已更新

// 事件数据类型
export interface StatusChangedData {
  status: ReviewStatus;
  previousStatus: ReviewStatus;
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
    question: {
      type: 'clarification' | 'choice' | 'accepted';
      message: string;
      options?: string[];
    };
  }>;
}

export interface ConnectedData {
  review: any;
}

// SSE 回调选项
export interface SSECallbacks {
  onConnected?: (data: ConnectedData) => void;
  onStatusChanged?: (data: StatusChangedData) => void;
  onVersionUpdated?: (data: VersionUpdatedData) => void;
  onQuestionsUpdated?: (data: QuestionsUpdatedData) => void;
  onError?: (error: Event) => void;
}

export function useSSE(reviewId: Ref<string>, callbacks: SSECallbacks) {
  const isConnected = ref(false);
  const lastEventId = ref<string | null>(null);
  let eventSource: EventSource | null = null;
  let reconnectTimeout: number | null = null;
  const RECONNECT_DELAY = 3000;

  function connect() {
    if (!reviewId.value) return;

    // 构建 URL，支持 Last-Event-ID
    let url = `/api/reviews/${reviewId.value}/events`;

    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      isConnected.value = true;
      console.log('[SSE] Connected');
    };

    // 连接事件
    eventSource.addEventListener('connected', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ConnectedData;
        lastEventId.value = e.lastEventId;
        callbacks.onConnected?.(data);
        console.log('[SSE] Received connected event');
      } catch (err) {
        console.error('[SSE] Failed to parse connected event:', err);
      }
    });

    // 状态变更事件
    eventSource.addEventListener('status_changed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as StatusChangedData;
        lastEventId.value = e.lastEventId;
        callbacks.onStatusChanged?.(data);
        console.log('[SSE] Status changed:', data.previousStatus, '->', data.status);
      } catch (err) {
        console.error('[SSE] Failed to parse status_changed event:', err);
      }
    });

    // 版本更新事件
    eventSource.addEventListener('version_updated', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as VersionUpdatedData;
        lastEventId.value = e.lastEventId;
        callbacks.onVersionUpdated?.(data);
        console.log('[SSE] Version updated:', data.version.versionHash.substring(0, 8));
      } catch (err) {
        console.error('[SSE] Failed to parse version_updated event:', err);
      }
    });

    // Questions 更新事件
    eventSource.addEventListener('questions_updated', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as QuestionsUpdatedData;
        lastEventId.value = e.lastEventId;
        callbacks.onQuestionsUpdated?.(data);
        console.log('[SSE] Questions updated:', data.questions.length, 'questions');
      } catch (err) {
        console.error('[SSE] Failed to parse questions_updated event:', err);
      }
    });

    // 心跳事件（静默处理）
    eventSource.addEventListener('heartbeat', (e: MessageEvent) => {
      lastEventId.value = e.lastEventId;
    });

    // 错误处理和自动重连
    eventSource.onerror = (e) => {
      isConnected.value = false;
      console.warn('[SSE] Connection error, will reconnect...');
      callbacks.onError?.(e);

      // 关闭当前连接
      eventSource?.close();
      eventSource = null;

      // 自动重连
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = window.setTimeout(() => {
        console.log('[SSE] Reconnecting...');
        connect();
      }, RECONNECT_DELAY);
    };
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
      isConnected.value = false;
      console.log('[SSE] Disconnected');
    }
  }

  onMounted(() => {
    if (reviewId.value) {
      connect();
    }
  });

  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    lastEventId,
    connect,
    disconnect
  };
}
