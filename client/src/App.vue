<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import PlanViewer from './components/PlanViewer.vue';
import ReviewSidebar from './components/ReviewSidebar.vue';
import VersionPanel from './components/VersionPanel.vue';
import DiffViewer from './components/DiffViewer.vue';
import { useSSE, type ReviewStatus, type StatusChangedData, type VersionUpdatedData, type QuestionsUpdatedData } from './composables/useSSE';

interface TextPosition {
  startOffset: number;
  endOffset: number;
  startLine?: number;
  endLine?: number;
}

interface CommentQuestion {
  type: 'clarification' | 'choice' | 'accepted';
  message: string;
  options?: string[];
}

interface Comment {
  id: string;
  quote: string;
  comment: string;
  position: TextPosition;
  documentVersion: string;
  positionStatus: 'valid' | 'adjusted' | 'stale';
  question?: CommentQuestion;
  answer?: string;
  resolved: boolean;
}

interface CommentRequest {
  quote: string;
  position: {
    startOffset: number;
    endOffset: number;
  };
  boundingRect: DOMRect;
}

interface VersionSummary {
  versionHash: string;
  createdAt: number;
  changeDescription?: string;
  author?: 'human' | 'agent';
  isCurrent: boolean;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffResult {
  fromVersion: string;
  toVersion: string;
  lines: DiffLine[];
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
}

const reviewId = ref<string>('');
const planContent = ref<string>('');
const comments = ref<Comment[]>([]);
const loading = ref(true);
const reviewStatus = ref<ReviewStatus>('pending');
const error = ref('');
const activeCommentId = ref<string | null>(null);

// 二次确认状态
const confirmPending = ref(false);
let confirmTimer: number | null = null;

// 版本管理状态
const versions = ref<VersionSummary[]>([]);
const currentVersionHash = ref<string>('');
const selectedVersion = ref<string>('');
const showDiff = ref(false);
const diffData = ref<DiffResult | null>(null);

// SSE 连接状态
const sseConnected = ref(false);

// 计算属性：是否为只读模式
const isReadOnly = computed(() => {
  return reviewStatus.value === 'submitted_feedback' || reviewStatus.value === 'approved';
});

// 计算属性：是否显示已提交界面
const showSubmittedView = computed(() => {
  return reviewStatus.value === 'approved';
});

// 计算属性：是否处于等待 Agent 状态
const isWaitingForAgent = computed(() => {
  return reviewStatus.value === 'submitted_feedback';
});

// 计算属性：是否有待回答的问题
const hasQuestionsToAnswer = computed(() => {
  return reviewStatus.value === 'questions_pending';
});

// 主题管理
const isDark = ref(false);

// 初始化主题（检查系统偏好或本地存储）
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    isDark.value = savedTheme === 'dark';
  } else {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  applyTheme();
}

function applyTheme() {
  if (isDark.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}

function toggleTheme() {
  isDark.value = !isDark.value;
  applyTheme();
}

watch(isDark, applyTheme);

// Draft state
const showCommentModal = ref(false);
const currentQuote = ref('');
const currentPosition = ref<TextPosition | null>(null);
const currentBoundingRect = ref<DOMRect | null>(null);
const newCommentText = ref('');

// SSE 回调处理
function handleSSEConnected(data: { review: any }) {
  const review = data.review;
  planContent.value = review.planContent;
  comments.value = review.comments || [];
  currentVersionHash.value = review.currentVersion;
  selectedVersion.value = review.currentVersion;
  reviewStatus.value = review.status || 'pending';

  if (review.documentVersions) {
    versions.value = review.documentVersions.map((v: any) => ({
      versionHash: v.versionHash,
      createdAt: v.createdAt,
      changeDescription: v.changeDescription,
      author: v.author,
      isCurrent: v.versionHash === review.currentVersion
    }));
  }

  sseConnected.value = true;
  loading.value = false;
}

function handleSSEStatusChanged(data: StatusChangedData) {
  reviewStatus.value = data.status;
  console.log('[App] Status changed:', data.previousStatus, '->', data.status);
}

function handleSSEVersionUpdated(data: VersionUpdatedData) {
  // 更新当前版本
  currentVersionHash.value = data.version.versionHash;
  planContent.value = data.content;
  selectedVersion.value = data.version.versionHash;

  // 更新版本列表
  const existingIndex = versions.value.findIndex(v => v.versionHash === data.version.versionHash);
  if (existingIndex === -1) {
    // 新版本，添加到列表
    versions.value.push({
      versionHash: data.version.versionHash,
      createdAt: data.version.createdAt,
      changeDescription: data.version.changeDescription,
      author: data.version.author,
      isCurrent: true
    });
  }

  // 更新所有版本的 isCurrent 状态
  versions.value = versions.value.map(v => ({
    ...v,
    isCurrent: v.versionHash === data.version.versionHash
  }));

  // 标记已解决的 comments
  for (const rc of data.resolvedComments) {
    const comment = comments.value.find(c => c.id === rc.commentId);
    if (comment) {
      comment.resolved = true;
    }
  }

  console.log('[App] Version updated:', data.version.versionHash.substring(0, 8));
}

function handleSSEQuestionsUpdated(data: QuestionsUpdatedData) {
  // 更新 comments 的 question 字段
  for (const q of data.questions) {
    const comment = comments.value.find(c => c.id === q.commentId);
    if (comment) {
      comment.question = q.question;
      // 如果是 accepted 类型，标记为已解决
      if (q.question.type === 'accepted') {
        comment.resolved = true;
      }
    }
  }
  console.log('[App] Questions updated:', data.questions.length, 'questions');
}

onMounted(async () => {
  initTheme();

  const path = window.location.pathname;
  const parts = path.split('/');
  const id = parts.find((p, i) => parts[i-1] === 'review');

  if (!id) {
    error.value = 'Invalid URL: No Review ID found.';
    loading.value = false;
    return;
  }
  reviewId.value = id;

  // SSE 会在 useSSE 中自动连接，connected 事件会更新数据
});

// 初始化 SSE（在 reviewId 设置后）
const { isConnected: sseIsConnected, disconnect: disconnectSSE } = useSSE(reviewId, {
  onConnected: handleSSEConnected,
  onStatusChanged: handleSSEStatusChanged,
  onVersionUpdated: handleSSEVersionUpdated,
  onQuestionsUpdated: handleSSEQuestionsUpdated,
  onError: () => {
    console.warn('[App] SSE connection error');
  }
});

onUnmounted(() => {
  // 清理确认定时器
  if (confirmTimer) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  // SSE 会在 useSSE 的 onUnmounted 中自动断开
});

// fetchReview 保留用于手动刷新（降级方案）
async function fetchReview() {
  const res = await fetch(`/api/reviews/${reviewId.value}`);
  if (!res.ok) throw new Error('Review not found');
  const data = await res.json();
  planContent.value = data.planContent;
  comments.value = data.comments || [];
  currentVersionHash.value = data.currentVersion;
  selectedVersion.value = data.currentVersion;
  reviewStatus.value = data.status || 'pending';

  if (data.documentVersions) {
    versions.value = data.documentVersions.map((v: any) => ({
      versionHash: v.versionHash,
      createdAt: v.createdAt,
      changeDescription: v.changeDescription,
      author: v.author,
      isCurrent: v.versionHash === data.currentVersion
    }));
  }
}

// 版本选择
async function onSelectVersion(hash: string) {
  if (hash === currentVersionHash.value) {
    // 切换回当前版本
    selectedVersion.value = hash;
    planContent.value = (await fetchVersionContent(hash)) || planContent.value;
    return;
  }

  // 获取指定版本内容
  const content = await fetchVersionContent(hash);
  if (content) {
    selectedVersion.value = hash;
    planContent.value = content;
  }
}

async function fetchVersionContent(hash: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/versions/${hash}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.content;
  } catch {
    return null;
  }
}

// 版本对比
async function onCompareVersions(from: string, to: string) {
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/diff?from=${from}&to=${to}`);
    if (!res.ok) {
      alert('Failed to load diff');
      return;
    }
    diffData.value = await res.json();
    showDiff.value = true;
  } catch {
    alert('Error loading diff');
  }
}

// 版本回滚
async function onRollback(hash: string) {
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionHash: hash })
    });
    if (!res.ok) {
      alert('Failed to rollback');
      return;
    }
    // 刷新数据
    await fetchReview();
  } catch {
    alert('Error during rollback');
  }
}

function onRequestComment(data: CommentRequest) {
  currentQuote.value = data.quote;
  currentPosition.value = data.position;
  currentBoundingRect.value = data.boundingRect;
  newCommentText.value = '';
  showCommentModal.value = true;
}

async function confirmAddComment() {
  if (!newCommentText.value.trim() || !currentPosition.value) return;

  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote: currentQuote.value,
        comment: newCommentText.value,
        position: currentPosition.value
      })
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to add comment');
    }
    const newComment = await res.json();
    comments.value.push(newComment);
    showCommentModal.value = false;
    currentPosition.value = null;
    currentBoundingRect.value = null;
  } catch (e: any) {
    alert(`Error adding comment: ${e.message}`);
  }
}

async function onUpdateComment(id: string, text: string) {
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/comments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: text })
    });
    if (!res.ok) throw new Error('Failed');

    const idx = comments.value.findIndex(c => c.id === id);
    if (idx !== -1) comments.value[idx].comment = text;
  } catch (e) {
    alert('Error updating comment');
  }
}

async function onDeleteComment(id: string) {
  if (!confirm('Delete this comment?')) return;
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/comments/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed');
    comments.value = comments.value.filter(c => c.id !== id);
  } catch (e) {
    alert('Error deleting comment');
  }
}

async function onSubmitReview() {
  // 第一次点击：进入确认状态
  if (!confirmPending.value) {
    confirmPending.value = true;

    // 启动3秒倒计时
    confirmTimer = window.setTimeout(() => {
      confirmPending.value = false;
      confirmTimer = null;
    }, 3000);

    return;
  }

  // 第二次点击：执行提交
  // 清除定时器
  if (confirmTimer) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  confirmPending.value = false;

  try {
    // 检查是否有未解决的 comments
    const unresolvedComments = comments.value.filter(c => !c.resolved);

    if (unresolvedComments.length === 0) {
      // 无批注或全部已解决，直接通过
      const res = await fetch(`/api/reviews/${reviewId.value}/approve`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to approve');
    } else {
      // 有批注，提交反馈
      const res = await fetch(`/api/reviews/${reviewId.value}/submit-feedback`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to submit feedback');
    }
    // 状态会通过 SSE 自动更新
  } catch (e) {
    alert('Error submitting review');
  }
}

// 回答 Agent 的问题
async function onAnswerQuestion(commentId: string, answer: string) {
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/comments/${commentId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer })
    });
    if (!res.ok) throw new Error('Failed to submit answer');

    // 更新本地状态
    const comment = comments.value.find(c => c.id === commentId);
    if (comment) {
      comment.answer = answer;
    }
  } catch (e) {
    alert('Error submitting answer');
  }
}

function onCommentClick(id: string) {
  // 切换激活状态
  activeCommentId.value = activeCommentId.value === id ? null : id;

  // 如果激活了评论，滚动到对应的文本位置
  if (activeCommentId.value === id) {
    const highlight = document.querySelector(`mark[data-comment-id="${id}"]`);
    if (highlight) {
      highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function onHighlightClick(id: string) {
  // 点击高亮时，切换激活状态
  activeCommentId.value = activeCommentId.value === id ? null : id;
}
</script>

<template>
  <div class="h-screen flex flex-col bg-app-bg-light dark:bg-app-bg-dark overflow-hidden transition-colors duration-200">
    <!-- Header -->
    <header class="bg-app-surface-light dark:bg-app-surface-dark border-b border-border-light dark:border-border-dark px-6 py-3 shadow-sm flex items-center justify-between transition-colors duration-200">
      <h1 class="font-bold text-lg text-text-primary-light dark:text-text-primary-dark">Claude Plan Review</h1>
      <div class="flex items-center gap-4">
        <!-- 主题切换按钮 -->
        <button
          @click="toggleTheme"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
        >
          <span v-if="isDark" class="text-2xl">☀️</span>
          <span v-else class="text-2xl">🌙</span>
        </button>
        <!-- 状态指示器 -->
        <div v-if="reviewStatus === 'approved'" class="text-green-600 font-medium flex items-center gap-2">
          <span>✓ Approved</span>
        </div>
        <div v-else-if="reviewStatus === 'submitted_feedback'" class="text-orange-500 font-medium flex items-center gap-2 animate-pulse">
          <span>⏳ Waiting for Agent...</span>
        </div>
        <div v-else-if="reviewStatus === 'questions_pending'" class="text-purple-600 font-medium flex items-center gap-2">
          <span>❓ Questions from Agent</span>
        </div>
        <div v-else-if="reviewStatus === 'revised'" class="text-blue-600 font-medium flex items-center gap-2">
          <span>📝 New Revision Available</span>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1 flex overflow-hidden relative">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-app-surface-light dark:bg-app-surface-dark z-10 text-text-primary-light dark:text-text-primary-dark transition-colors duration-200">
        Loading...
      </div>

      <div v-else-if="error" class="absolute inset-0 flex items-center justify-center bg-app-surface-light dark:bg-app-surface-dark z-10 text-red-600 transition-colors duration-200">
        {{ error }}
      </div>

      <!-- Approved 状态 -->
      <div v-else-if="showSubmittedView" class="absolute inset-0 flex flex-col items-center justify-center bg-app-surface-light dark:bg-app-surface-dark z-10 space-y-4 transition-colors duration-200">
        <div class="text-4xl mb-2">🎉</div>
        <h2 class="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Plan Approved!</h2>
        <p class="text-text-secondary-light dark:text-text-secondary-dark">You can close this window and return to Claude.</p>
        <p class="text-sm text-text-secondary-light dark:text-text-secondary-dark">Type "continue" in the chat.</p>
      </div>

      <!-- Waiting for Agent 状态 -->
      <div v-else-if="isWaitingForAgent" class="absolute inset-0 flex flex-col items-center justify-center bg-app-surface-light dark:bg-app-surface-dark z-10 space-y-4 transition-colors duration-200">
        <div class="text-4xl mb-2 animate-bounce">⏳</div>
        <h2 class="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Feedback Submitted</h2>
        <p class="text-text-secondary-light dark:text-text-secondary-dark">Waiting for Agent to process your feedback...</p>
        <p class="text-sm text-text-secondary-light dark:text-text-secondary-dark">This page will update automatically.</p>
      </div>

      <template v-else>
        <!-- Left: Plan Content Area (65-70%) -->
        <div class="flex-1 overflow-y-auto px-6 lg:px-12">
          <div class="max-w-5xl mx-auto py-12">
            <!-- 版本面板 -->
            <div class="mb-6">
              <VersionPanel
                :versions="versions"
                :current-version="currentVersionHash"
                :selected-version="selectedVersion"
                @select-version="onSelectVersion"
                @compare-versions="onCompareVersions"
                @rollback="onRollback"
              />
            </div>

            <!-- 查看历史版本提示 -->
            <div
              v-if="selectedVersion !== currentVersionHash"
              class="mb-4 px-4 py-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm flex items-center justify-between"
            >
              <span>
                You are viewing a historical version ({{ selectedVersion.substring(0, 8) }}).
                Comments are not editable in this view.
              </span>
              <button
                @click="onSelectVersion(currentVersionHash)"
                class="px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors text-xs"
              >
                Back to Current
              </button>
            </div>

            <PlanViewer
              :content="planContent"
              :comments="comments"
              :active-comment-id="activeCommentId"
              :is-historical-version="selectedVersion !== currentVersionHash"
              @request-comment="onRequestComment"
              @highlight-click="onHighlightClick"
            />
          </div>
        </div>

        <!-- Right: Comment Rail (30%) -->
        <div class="w-[30%] min-w-[320px] max-w-[480px] shadow-2xl z-10">
          <ReviewSidebar
            :comments="comments"
            :confirm-pending="confirmPending"
            :review-status="reviewStatus"
            :is-read-only="isReadOnly"
            :has-questions="hasQuestionsToAnswer"
            @update-comment="onUpdateComment"
            @delete-comment="onDeleteComment"
            @submit-review="onSubmitReview"
            @comment-click="onCommentClick"
            @answer-question="onAnswerQuestion"
          />
        </div>
      </template>
    </main>

    <!-- Add Comment Modal -->
    <div v-if="showCommentModal" class="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-center justify-center p-4 transition-colors duration-200">
      <div class="bg-app-surface-light dark:bg-app-surface-dark rounded-lg shadow-xl w-full max-w-md p-6 transition-colors duration-200">
        <h3 class="text-lg font-bold mb-4 text-text-primary-light dark:text-text-primary-dark">Add Comment</h3>
        <div class="bg-app-surface-alt-light dark:bg-app-surface-alt-dark p-3 rounded border border-border-light dark:border-border-dark mb-4 text-sm italic text-text-secondary-light dark:text-text-secondary-dark max-h-32 overflow-y-auto transition-colors duration-200">
          "{{ currentQuote }}"
        </div>
        <textarea
          v-model="newCommentText"
          class="w-full border border-border-light dark:border-border-dark rounded p-3 mb-4 focus:ring-2 focus:ring-claude-primary dark:focus:ring-claude-primary-dark outline-none bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark transition-colors duration-200"
          rows="4"
          placeholder="Type your comment here..."
          autofocus
        ></textarea>
        <div class="flex justify-end gap-3">
          <button
            @click="showCommentModal = false"
            class="px-4 py-2 text-text-secondary-light dark:text-text-secondary-dark hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            @click="confirmAddComment"
            class="px-4 py-2 bg-claude-primary dark:bg-claude-primary-dark text-white rounded hover:bg-claude-primary-hover disabled:opacity-50 transition-colors"
            :disabled="!newCommentText.trim()"
          >
            Add Comment
          </button>
        </div>
      </div>
    </div>

    <!-- Diff Viewer Modal -->
    <DiffViewer
      v-if="showDiff && diffData"
      :diff="diffData"
      @close="showDiff = false; diffData = null"
    />
  </div>
</template>
