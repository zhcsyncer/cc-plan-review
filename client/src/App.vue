<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import PlanViewer from './components/PlanViewer.vue';
import ReviewSidebar from './components/ReviewSidebar.vue';
import VersionPanel from './components/VersionPanel.vue';
import DiffViewer from './components/DiffViewer.vue';

interface TextPosition {
  startOffset: number;
  endOffset: number;
  startLine?: number;
  endLine?: number;
}

interface Comment {
  id: string;
  quote: string;
  comment: string;
  position: TextPosition;
  documentVersion: string;
  positionStatus: 'valid' | 'adjusted' | 'stale';
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
const submitted = ref(false);
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

// 轮询定时器
let pollInterval: number | null = null;
const POLL_INTERVAL_MS = 3000; // 3秒

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

onMounted(async () => {
  initTheme();

  const path = window.location.pathname;
  const parts = path.split('/');
  // If path is /review/123, parts is ['', 'review', '123']
  // If path is /review/123/, parts is ['', 'review', '123', '']
  const id = parts.find((p, i) => parts[i-1] === 'review');

  if (!id) {
    error.value = 'Invalid URL: No Review ID found.';
    loading.value = false;
    return;
  }
  reviewId.value = id;

  try {
    await fetchReview();
    // 启动轮询
    startPolling();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  // 清理确认定时器
  if (confirmTimer) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  // 清理轮询定时器
  stopPolling();
});

async function fetchReview() {
  const res = await fetch(`/api/reviews/${reviewId.value}`);
  if (!res.ok) throw new Error('Review not found');
  const data = await res.json();
  planContent.value = data.planContent;
  comments.value = data.comments;
  currentVersionHash.value = data.currentVersion;
  selectedVersion.value = data.currentVersion;

  // 获取版本列表
  if (data.documentVersions) {
    versions.value = data.documentVersions.map((v: any) => ({
      versionHash: v.versionHash,
      createdAt: v.createdAt,
      changeDescription: v.changeDescription,
      author: v.author,
      isCurrent: v.versionHash === data.currentVersion
    }));
  }

  if (data.status === 'submitted') {
    submitted.value = true;
  }
}

// 轮询检测更新
function startPolling() {
  if (pollInterval) return;
  pollInterval = window.setInterval(async () => {
    try {
      const res = await fetch(`/api/reviews/${reviewId.value}`);
      if (!res.ok) return;
      const data = await res.json();

      // 检测到新版本
      if (data.currentVersion !== currentVersionHash.value) {
        // 自动刷新数据
        currentVersionHash.value = data.currentVersion;
        planContent.value = data.planContent;
        comments.value = data.comments;
        selectedVersion.value = data.currentVersion;

        // 更新版本列表
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

      // 检测状态变化
      if (data.status === 'submitted' && !submitted.value) {
        submitted.value = true;
      }
    } catch (e) {
      // 轮询失败时静默处理
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
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
    const res = await fetch(`/api/reviews/${reviewId.value}/submit`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed');
    submitted.value = true;
  } catch (e) {
    alert('Error submitting review');
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
        <div v-if="submitted" class="text-green-600 font-medium flex items-center gap-2">
          <span>✓ Submitted</span>
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

      <div v-else-if="submitted" class="absolute inset-0 flex flex-col items-center justify-center bg-app-surface-light dark:bg-app-surface-dark z-10 space-y-4 transition-colors duration-200">
        <div class="text-4xl mb-2">🎉</div>
        <h2 class="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Review Submitted!</h2>
        <p class="text-text-secondary-light dark:text-text-secondary-dark">You can close this window and return to Claude.</p>
        <p class="text-sm text-text-secondary-light dark:text-text-secondary-dark">Type "continue" in the chat.</p>
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
            @update-comment="onUpdateComment"
            @delete-comment="onDeleteComment"
            @submit-review="onSubmitReview"
            @comment-click="onCommentClick"
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
