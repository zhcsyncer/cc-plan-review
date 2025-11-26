<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import PlanViewer from './components/PlanViewer.vue';
import ReviewSidebar from './components/ReviewSidebar.vue';
import VersionPanel from './components/VersionPanel.vue';
import DiffViewer from './components/DiffViewer.vue';
import KeyboardHelpModal from './components/KeyboardHelpModal.vue';
import Kbd from './components/Kbd.vue';
import TemplateDropdown from './components/TemplateDropdown.vue';
import SettingsPage from './pages/SettingsPage.vue';
import type { CommentTemplate } from './composables/useConfig';
import { useSSE, type ReviewStatus, type StatusChangedData, type VersionUpdatedData, type QuestionsUpdatedData } from './composables/useSSE';
import { useKeyboard } from './composables/useKeyboard';
import { useNotification } from './composables/useNotification';
import { useConfig } from './composables/useConfig';

// 简单路由
const currentPath = ref(window.location.pathname);
const isSettingsPage = computed(() => currentPath.value === '/settings');

// 监听 popstate 事件
window.addEventListener('popstate', () => {
  currentPath.value = window.location.pathname;
});

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
  hasSameContent: boolean;
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
const reviewStatus = ref<ReviewStatus>('open');
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

// 补充意见（Approve 时可选填写）
const approvalNote = ref('');

// PassThrough 模式：评论作为建议传递，直接通过
const passThrough = ref(false);

// Approved 后的倒计时关闭
const countdown = ref(3);
let countdownTimer: number | null = null;

// 通知
const { notifyVersionUpdated, notifyQuestionsUpdated, notifyTimeoutWarning } = useNotification();
const { loadConfig } = useConfig();

// 超时预警计时器
const REVIEW_TIMEOUT = 10 * 60 * 1000; // 10 分钟
const WARNING_BEFORE = 2 * 60 * 1000;  // 提前 2 分钟预警
let reviewStartTime: number | null = null;
let warningTimer: number | null = null;

function startTimeoutWarning() {
  reviewStartTime = Date.now();
  // 设置超时预警计时器
  warningTimer = window.setTimeout(() => {
    const remaining = Math.ceil((REVIEW_TIMEOUT - (Date.now() - (reviewStartTime || 0))) / 60000);
    notifyTimeoutWarning(remaining);
  }, REVIEW_TIMEOUT - WARNING_BEFORE);
}

function clearTimeoutWarning() {
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }
  reviewStartTime = null;
}

// 快捷键帮助面板
const showKeyboardHelp = ref(false);

// 快捷键 Approve 连击确认
const approveShortcutPending = ref(false);
let approveShortcutTimer: number | null = null;

// 选中文本状态（用于 C 键快捷键）
const hasTextSelection = ref(false);
const selectionData = ref<CommentRequest | null>(null);

// 计算属性：是否为只读模式
const isReadOnly = computed(() => {
  return reviewStatus.value === 'changes_requested' || reviewStatus.value === 'approved';
});

// 计算属性：是否显示已提交界面
const showSubmittedView = computed(() => {
  return reviewStatus.value === 'approved';
});

// 计算属性：是否处于等待 Agent 状态
const isWaitingForAgent = computed(() => {
  return reviewStatus.value === 'changes_requested';
});

// 计算属性：是否有待回答的问题
const hasQuestionsToAnswer = computed(() => {
  return reviewStatus.value === 'discussing';
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
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null);

// 操作系统检测（用于快捷键提示）
const isMac = computed(() => navigator.platform.toUpperCase().includes('MAC'));
const shortcutHint = computed(() => isMac.value ? '⌘↵' : 'Ctrl+↵');

// 弹窗打开时自动聚焦输入框
watch(showCommentModal, (newVal) => {
  if (newVal) {
    nextTick(() => {
      commentTextareaRef.value?.focus();
    });
  }
});

// SSE 回调处理
function handleSSEConnected(data: { review: any }) {
  const review = data.review;
  planContent.value = review.planContent;
  comments.value = review.comments || [];
  currentVersionHash.value = review.currentVersion;
  selectedVersion.value = review.currentVersion;
  reviewStatus.value = review.status || 'open';

  if (review.documentVersions) {
    const currentContent = review.documentVersions.find(
      (v: any) => v.versionHash === review.currentVersion
    )?.content || '';
    versions.value = review.documentVersions.map((v: any) => ({
      versionHash: v.versionHash,
      createdAt: v.createdAt,
      changeDescription: v.changeDescription,
      author: v.author,
      isCurrent: v.versionHash === review.currentVersion,
      hasSameContent: v.content === currentContent
    }));
  }

  sseConnected.value = true;
  loading.value = false;

  // 加载配置（用于通知设置）
  loadConfig().catch(() => {});

  // 启动超时预警计时器（仅在未 approved 状态下）
  if (review.status !== 'approved') {
    startTimeoutWarning();
  }
}

function handleSSEStatusChanged(data: StatusChangedData) {
  reviewStatus.value = data.status;
  console.log('[App] Status changed:', data.previousStatus, '->', data.status);

  // 如果状态变为 approved，启动倒计时关闭窗口
  if (data.status === 'approved') {
    clearTimeoutWarning();  // 清除超时预警
    startCloseCountdown();
  }
}

// 启动倒计时关闭窗口
function startCloseCountdown() {
  countdown.value = 3;
  countdownTimer = window.setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      // 尝试关闭窗口
      window.close();
    }
  }, 1000);
}

async function handleSSEVersionUpdated(data: VersionUpdatedData) {
  // 更新当前版本
  currentVersionHash.value = data.version.versionHash;
  planContent.value = data.content;
  selectedVersion.value = data.version.versionHash;

  // 重新获取版本列表（以便正确计算 hasSameContent）
  try {
    const res = await fetch(`/api/reviews/${reviewId.value}/versions`);
    if (res.ok) {
      const versionData = await res.json();
      versions.value = versionData.versions;
    }
  } catch {
    // 获取失败时，使用简化的本地更新
    const existingIndex = versions.value.findIndex(v => v.versionHash === data.version.versionHash);
    if (existingIndex === -1) {
      versions.value.push({
        versionHash: data.version.versionHash,
        createdAt: data.version.createdAt,
        changeDescription: data.version.changeDescription,
        author: data.version.author,
        isCurrent: true,
        hasSameContent: true
      });
    }
    versions.value = versions.value.map(v => ({
      ...v,
      isCurrent: v.versionHash === data.version.versionHash,
      hasSameContent: v.versionHash === data.version.versionHash ? true : v.hasSameContent
    }));
  }

  // 标记已解决的 comments
  for (const rc of data.resolvedComments) {
    const comment = comments.value.find(c => c.id === rc.commentId);
    if (comment) {
      comment.resolved = true;
    }
  }

  console.log('[App] Version updated:', data.version.versionHash.substring(0, 8));

  // 发送浏览器通知
  notifyVersionUpdated(data.version.versionHash);
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

  // 发送浏览器通知
  if (data.questions.length > 0) {
    notifyQuestionsUpdated(data.questions.length);
  }
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
  // 清理倒计时定时器
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  // 清理超时预警定时器
  clearTimeoutWarning();
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
  reviewStatus.value = data.status || 'open';

  if (data.documentVersions) {
    const currentContent = data.documentVersions.find(
      (v: any) => v.versionHash === data.currentVersion
    )?.content || '';
    versions.value = data.documentVersions.map((v: any) => ({
      versionHash: v.versionHash,
      createdAt: v.createdAt,
      changeDescription: v.changeDescription,
      author: v.author,
      isCurrent: v.versionHash === data.currentVersion,
      hasSameContent: v.content === currentContent
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

// 选择评论模板
function onSelectTemplate(template: CommentTemplate) {
  // 如果输入框已有内容，在末尾追加；否则直接设置
  if (newCommentText.value.trim()) {
    newCommentText.value += '\n' + template.content;
  } else {
    newCommentText.value = template.content;
  }
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

// 处理评论输入框快捷键
function handleCommentKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    confirmAddComment();
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
    const hasApprovalNote = approvalNote.value.trim();

    if (unresolvedComments.length === 0 && !hasApprovalNote) {
      // 无批注且无全局意见 → 直接通过
      const res = await fetch(`/api/reviews/${reviewId.value}/approve`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to approve');
    } else if (passThrough.value) {
      // PassThrough 模式：有批注但直接通过，评论作为建议传递
      const body: { note?: string; passThrough: boolean } = { passThrough: true };
      if (hasApprovalNote) {
        body.note = hasApprovalNote;
        approvalNote.value = '';
      }
      const res = await fetch(`/api/reviews/${reviewId.value}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Failed to approve with suggestions');
    } else {
      // 有批注或有全局意见 → 请求修改
      const body: { note?: string } = {};
      if (hasApprovalNote) {
        body.note = hasApprovalNote;
        approvalNote.value = '';  // 清空输入框
      }
      const res = await fetch(`/api/reviews/${reviewId.value}/request-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Failed to request changes');
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

// 处理文本选中状态变化
function onSelectionChange(data: CommentRequest | null) {
  hasTextSelection.value = !!data;
  selectionData.value = data;
}

// 快捷键 Approve（连击确认）
function handleApproveShortcut() {
  // 仅在非只读、非加载状态下触发
  if (isReadOnly.value || loading.value || showSubmittedView.value || isWaitingForAgent.value) {
    return;
  }

  // 第一次按下：进入确认状态
  if (!approveShortcutPending.value) {
    approveShortcutPending.value = true;

    // 启动 3 秒倒计时
    approveShortcutTimer = window.setTimeout(() => {
      approveShortcutPending.value = false;
      approveShortcutTimer = null;
    }, 3000);

    return;
  }

  // 第二次按下：执行提交
  if (approveShortcutTimer) {
    clearTimeout(approveShortcutTimer);
    approveShortcutTimer = null;
  }
  approveShortcutPending.value = false;

  // 执行提交
  onSubmitReview();
}

// 计算当前版本索引（用于方向键切换）
const currentVersionIndex = computed(() => {
  return versions.value.findIndex(v => v.versionHash === selectedVersion.value);
});

// 初始化快捷键
const { register, isMac: isMacKeyboard } = useKeyboard();

// 注册快捷键
const unregisterCallbacks: Array<() => void> = [];

onMounted(() => {
  // 全局 Approve 快捷键 (Cmd+Shift+P / Ctrl+Shift+P)
  unregisterCallbacks.push(register({
    key: 'p',
    modifiers: { mod: true, shift: true },
    handler: handleApproveShortcut,
    description: 'Approve / Submit Review',
    group: 'Review',
  }));

  // 评论快捷键 (C)
  unregisterCallbacks.push(register({
    key: 'c',
    handler: () => {
      if (hasTextSelection.value && selectionData.value && !isReadOnly.value) {
        onRequestComment(selectionData.value);
      }
    },
    description: 'Add comment to selected text',
    group: 'Comments',
  }));

  // 版本切换快捷键 (←)
  unregisterCallbacks.push(register({
    key: 'ArrowLeft',
    handler: () => {
      const idx = currentVersionIndex.value;
      if (idx > 0 && versions.value.length > 1) {
        onSelectVersion(versions.value[idx - 1].versionHash);
      }
    },
    description: 'Previous version',
    group: 'Navigation',
  }));

  // 版本切换快捷键 (→)
  unregisterCallbacks.push(register({
    key: 'ArrowRight',
    handler: () => {
      const idx = currentVersionIndex.value;
      if (idx < versions.value.length - 1) {
        onSelectVersion(versions.value[idx + 1].versionHash);
      }
    },
    description: 'Next version',
    group: 'Navigation',
  }));

  // 快捷键帮助 (?)
  unregisterCallbacks.push(register({
    key: '?',
    handler: () => { showKeyboardHelp.value = true; },
    description: 'Show keyboard shortcuts',
    group: 'General',
  }));

  // 快捷键帮助 (Cmd+/ / Ctrl+/)
  unregisterCallbacks.push(register({
    key: '/',
    modifiers: { mod: true },
    handler: () => { showKeyboardHelp.value = true; },
    description: 'Show keyboard shortcuts',
    group: 'General',
  }));

  // Escape 关闭弹窗
  unregisterCallbacks.push(register({
    key: 'Escape',
    handler: () => {
      if (showKeyboardHelp.value) {
        showKeyboardHelp.value = false;
      } else if (showCommentModal.value) {
        showCommentModal.value = false;
      } else if (showDiff.value) {
        showDiff.value = false;
        diffData.value = null;
      }
    },
    description: 'Close modal / dialog',
    group: 'General',
    enableInInput: true,
  }));
});

onUnmounted(() => {
  // 注销所有快捷键
  unregisterCallbacks.forEach(fn => fn());

  // 清理快捷键确认定时器
  if (approveShortcutTimer) {
    clearTimeout(approveShortcutTimer);
    approveShortcutTimer = null;
  }
});
</script>

<template>
  <!-- 设置页面 -->
  <SettingsPage v-if="isSettingsPage" />

  <!-- 主应用 -->
  <div v-else class="h-screen flex flex-col bg-app-bg-light dark:bg-app-bg-dark overflow-hidden transition-colors duration-200">
    <!-- Header -->
    <header class="bg-app-surface-light dark:bg-app-surface-dark border-b border-border-light dark:border-border-dark px-6 py-3 shadow-sm flex items-center justify-between transition-colors duration-200">
      <h1 class="font-bold text-lg text-text-primary-light dark:text-text-primary-dark">Claude Plan Review</h1>
      <div class="flex items-center gap-4">
        <!-- 设置按钮 -->
        <a
          href="/settings"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark"
          title="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </a>
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
        <div v-else-if="reviewStatus === 'changes_requested'" class="text-orange-500 font-medium flex items-center gap-2 animate-pulse">
          <span>⏳ Waiting for Agent...</span>
        </div>
        <div v-else-if="reviewStatus === 'discussing'" class="text-purple-600 font-medium flex items-center gap-2">
          <span>❓ Questions from Agent</span>
        </div>
        <div v-else-if="reviewStatus === 'updated'" class="text-blue-600 font-medium flex items-center gap-2">
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
        <p v-if="countdown > 0" class="text-lg font-medium text-claude-primary dark:text-claude-primary-dark">
          Window closing in {{ countdown }}s...
        </p>
        <p v-else class="text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Type "continue" in the chat.
        </p>
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
              :current-version="selectedVersion"
              @request-comment="onRequestComment"
              @highlight-click="onHighlightClick"
              @selection-change="onSelectionChange"
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
            v-model:approval-note="approvalNote"
            v-model:pass-through="passThrough"
            @update-comment="onUpdateComment"
            @delete-comment="onDeleteComment"
            @submit-review="onSubmitReview"
            @submit-with-note="onSubmitReview"
            @comment-click="onCommentClick"
            @answer-question="onAnswerQuestion"
          />
        </div>
      </template>
    </main>

    <!-- Add Comment Modal -->
    <div v-if="showCommentModal" class="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-center justify-center p-4 transition-colors duration-200">
      <div class="bg-app-surface-light dark:bg-app-surface-dark rounded-lg shadow-xl w-full max-w-md p-6 transition-colors duration-200">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">Add Comment</h3>
          <TemplateDropdown @select="onSelectTemplate" />
        </div>
        <div class="bg-app-surface-alt-light dark:bg-app-surface-alt-dark p-3 rounded border border-border-light dark:border-border-dark mb-4 text-sm italic text-text-secondary-light dark:text-text-secondary-dark max-h-32 overflow-y-auto transition-colors duration-200">
          "{{ currentQuote }}"
        </div>
        <textarea
          ref="commentTextareaRef"
          v-model="newCommentText"
          class="w-full border border-border-light dark:border-border-dark rounded p-3 mb-4 focus:ring-2 focus:ring-claude-primary dark:focus:ring-claude-primary-dark outline-none bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark transition-colors duration-200"
          rows="4"
          placeholder="Type your comment here..."
          @keydown="handleCommentKeydown"
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
            class="px-4 py-2 bg-claude-primary dark:bg-claude-primary-dark text-white rounded hover:bg-claude-primary-hover disabled:opacity-50 transition-colors flex items-center gap-2"
            :disabled="!newCommentText.trim()"
          >
            Add Comment
            <span class="text-xs opacity-70">{{ shortcutHint }}</span>
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

    <!-- Keyboard Help Modal -->
    <KeyboardHelpModal
      :visible="showKeyboardHelp"
      @close="showKeyboardHelp = false"
    />

    <!-- 快捷键 Approve 连击确认提示 -->
    <Transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div
        v-if="approveShortcutPending"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-pulse"
      >
        <span>Press</span>
        <Kbd keys="mod+shift+p" class="!bg-red-800 !border-red-500" />
        <span>again to confirm</span>
      </div>
    </Transition>
  </div>
</template>
