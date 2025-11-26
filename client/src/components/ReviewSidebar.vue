<script setup lang="ts">
import { ref, computed } from 'vue';
import { Trash2, Edit2, Check, X, ChevronDown, ChevronUp } from 'lucide-vue-next';
import QuestionInput from './QuestionInput.vue';

type ReviewStatus = 'open' | 'changes_requested' | 'discussing' | 'approved' | 'updated';

interface CommentQuestion {
  type: 'clarification' | 'choice' | 'accepted';
  message: string;
  options?: string[];
}

interface Comment {
  id: string;
  quote: string;
  comment: string;
  isEditing?: boolean;
  tempText?: string;
  question?: CommentQuestion;
  answer?: string;
  resolved: boolean;
  isExpanded?: boolean;  // 查看模式下是否展开
}

const props = defineProps<{
  comments: Comment[];
  confirmPending?: boolean;
  reviewStatus?: ReviewStatus;
  isReadOnly?: boolean;
  hasQuestions?: boolean;
  approvalNote?: string;
}>();

const emit = defineEmits<{
  (e: 'update-comment', id: string, text: string): void;
  (e: 'delete-comment', id: string): void;
  (e: 'submit-review'): void;
  (e: 'submit-with-note'): void;
  (e: 'comment-click', id: string): void;
  (e: 'answer-question', commentId: string, answer: string): void;
  (e: 'update:approvalNote', value: string): void;
}>();

// 处理全局意见输入框的快捷键
function handleApprovalNoteKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    emit('submit-with-note');
  }
}

// 计算属性：未解决的 comments
const unresolvedComments = computed(() => props.comments.filter(c => !c.resolved));
const resolvedComments = computed(() => props.comments.filter(c => c.resolved));

// 计算属性：是否所有问题都已回答
const allQuestionsAnswered = computed(() => {
  if (!props.hasQuestions) return true;
  return unresolvedComments.value.every(c => {
    if (!c.question) return true;
    if (c.question.type === 'accepted') return true;
    return !!c.answer;
  });
});

// 计算按钮状态
const buttonText = computed(() => {
  if (props.confirmPending) return 'Click Again to Confirm';

  switch (props.reviewStatus) {
    case 'discussing':
      return allQuestionsAnswered.value ? 'Submit Answers' : 'Answer All Questions';
    case 'updated':
      return unresolvedComments.value.length > 0 ? 'Submit Feedback' : 'Approve';
    default:
      return unresolvedComments.value.length > 0 ? 'Submit Feedback' : 'Approve';
  }
});

const buttonDisabled = computed(() => {
  if (props.reviewStatus === 'discussing' && !allQuestionsAnswered.value) {
    return true;
  }
  return false;
});

function startEdit(c: Comment) {
  if (props.isReadOnly) return;
  c.isEditing = true;
  c.tempText = c.comment;
}

function cancelEdit(c: Comment) {
  c.isEditing = false;
}

function saveEdit(c: Comment) {
  if (c.tempText && c.tempText !== c.comment) {
    emit('update-comment', c.id, c.tempText);
  }
  c.isEditing = false;
}

function handleAnswerQuestion(commentId: string, answer: string) {
  emit('answer-question', commentId, answer);
}

// 处理编辑模式快捷键
function handleEditKeydown(e: KeyboardEvent, c: Comment) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    saveEdit(c);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit(c);
  }
}

// textarea 高度自适应
function autoResize(e: Event) {
  const textarea = e.target as HTMLTextAreaElement;
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

// 切换评论展开/收起状态
function toggleExpand(c: Comment) {
  c.isExpanded = !c.isExpanded;
}
</script>

<template>
  <div class="review-sidebar flex flex-col h-full bg-app-bg-light dark:bg-app-bg-dark border-l border-border-light dark:border-border-dark transition-colors duration-200">
    <div class="p-4 border-b border-border-light dark:border-border-dark bg-app-surface-light dark:bg-app-surface-dark transition-colors duration-200">
      <h2 class="font-semibold text-text-primary-light dark:text-text-primary-dark">
        Review Comments
        <span v-if="unresolvedComments.length > 0" class="text-sm font-normal text-text-secondary-light dark:text-text-secondary-dark">
          ({{ unresolvedComments.length }} active)
        </span>
      </h2>
      <!-- 状态提示 -->
      <div v-if="hasQuestions" class="mt-2 text-sm text-purple-600 dark:text-purple-400">
        Agent has questions for you. Please answer below.
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- 空状态提示 -->
      <div v-if="comments.length === 0" class="text-center text-text-secondary-light dark:text-text-secondary-dark py-8">
        Select text in the plan to add comments.
      </div>

      <!-- 未解决的 Comments -->
      <div
        v-for="c in unresolvedComments"
        :key="c.id"
        :data-comment-id="c.id"
        class="bg-app-surface-light dark:bg-app-surface-dark p-3 rounded-lg shadow-sm border border-border-light dark:border-border-dark group hover:border-claude-primary dark:hover:border-claude-primary-dark transition-colors"
        :class="{ 'cursor-pointer': !isReadOnly }"
        @click="emit('comment-click', c.id)"
      >
        <!-- Quote -->
        <div class="text-xs text-text-secondary-light dark:text-text-secondary-dark border-l-2 border-claude-primary dark:border-claude-primary-dark pl-2 mb-2 italic truncate">
          "{{ c.quote }}"
        </div>

        <!-- Content -->
        <div v-if="!c.isEditing">
          <div
            class="text-sm text-text-primary-light dark:text-text-primary-dark mb-2 cursor-pointer"
            :class="{ 'line-clamp-2': !c.isExpanded }"
            @click.stop="toggleExpand(c)"
          >
            {{ c.comment }}
            <component
              :is="c.isExpanded ? ChevronUp : ChevronDown"
              :size="14"
              class="inline-block ml-1 text-text-secondary-light dark:text-text-secondary-dark align-middle"
            />
          </div>

          <!-- 编辑/删除按钮（仅非只读模式显示） -->
          <div v-if="!isReadOnly && !c.question" class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button @click.stop="startEdit(c)" class="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-claude-primary dark:hover:text-claude-primary-dark">
              <Edit2 :size="14" />
            </button>
            <button @click.stop="emit('delete-comment', c.id)" class="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-red-600">
              <Trash2 :size="14" />
            </button>
          </div>

          <!-- Question UI -->
          <QuestionInput
            v-if="c.question"
            :question="c.question"
            :answer="c.answer"
            :comment-id="c.id"
            @answer="handleAnswerQuestion"
          />
        </div>

        <!-- Edit Mode -->
        <div v-else @click.stop>
          <textarea
            v-model="c.tempText"
            class="w-full text-sm border border-border-light dark:border-border-dark rounded p-2 mb-2 focus:ring-2 focus:ring-claude-primary dark:focus:ring-claude-primary-dark outline-none bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark transition-colors duration-200 min-h-[60px] resize-none"
            placeholder="Enter comment... (⌘↵ to save, Esc to cancel)"
            @keydown="handleEditKeydown($event, c)"
            @input="autoResize"
          ></textarea>
          <div class="flex justify-end gap-2">
             <button @click="cancelEdit(c)" class="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark">
              <X :size="16" />
            </button>
            <button @click="saveEdit(c)" class="p-1 text-green-600 hover:text-green-700">
              <Check :size="16" />
            </button>
          </div>
        </div>
      </div>

      <!-- 已解决的 Comments（折叠显示） -->
      <details v-if="resolvedComments.length > 0" class="mt-4">
        <summary class="text-sm text-text-secondary-light dark:text-text-secondary-dark cursor-pointer hover:text-text-primary-light dark:hover:text-text-primary-dark">
          {{ resolvedComments.length }} resolved comment{{ resolvedComments.length > 1 ? 's' : '' }}
        </summary>
        <div class="mt-2 space-y-3">
          <div
            v-for="c in resolvedComments"
            :key="c.id"
            class="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800 opacity-75"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="text-green-600 dark:text-green-400">✓</span>
              <span class="text-xs text-green-700 dark:text-green-300">Resolved</span>
            </div>
            <div class="text-xs text-text-secondary-light dark:text-text-secondary-dark border-l-2 border-green-400 pl-2 mb-2 italic truncate">
              "{{ c.quote }}"
            </div>
            <div class="text-sm text-text-primary-light dark:text-text-primary-dark line-through">{{ c.comment }}</div>
          </div>
        </div>
      </details>
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-border-light dark:border-border-dark bg-app-surface-light dark:bg-app-surface-dark transition-colors duration-200">
      <!-- 折叠式全局意见输入框（始终显示，除了 Agent 提问时） -->
      <details v-if="!hasQuestions" class="mb-3">
        <summary class="text-sm text-text-secondary-light dark:text-text-secondary-dark cursor-pointer hover:text-text-primary-light dark:hover:text-text-primary-dark select-none">
          Add a global note (optional)
        </summary>
        <textarea
          :value="approvalNote"
          @input="emit('update:approvalNote', ($event.target as HTMLTextAreaElement).value)"
          @keydown="handleApprovalNoteKeydown"
          class="w-full mt-2 text-sm border border-border-light dark:border-border-dark rounded-lg p-2 focus:ring-2 focus:ring-claude-primary dark:focus:ring-claude-primary-dark outline-none bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark transition-colors duration-200 resize-none"
          rows="2"
          placeholder="Global review note (Cmd+Enter to submit)..."
        ></textarea>
      </details>

      <button
        @click="emit('submit-review')"
        :disabled="buttonDisabled"
        :class="[
          'w-full text-white py-2 px-4 rounded-lg font-medium transition-all',
          confirmPending
            ? 'bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-800 animate-pulse'
            : buttonDisabled
              ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
              : 'bg-claude-primary dark:bg-claude-primary-dark hover:bg-claude-primary-hover'
        ]"
      >
        {{ buttonText }}
      </button>
      <p v-if="hasQuestions && !allQuestionsAnswered" class="mt-2 text-xs text-center text-orange-600 dark:text-orange-400">
        Please answer all questions before submitting.
      </p>
    </div>
  </div>
</template>
