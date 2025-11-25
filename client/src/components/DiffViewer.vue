<script setup lang="ts">
import { ref, computed } from 'vue';
import { X, Columns, AlignJustify, Plus, Minus, Equal } from 'lucide-vue-next';

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

const props = defineProps<{
  diff: DiffResult;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

type ViewMode = 'split' | 'unified';
const viewMode = ref<ViewMode>('split');

function shortHash(hash: string): string {
  return hash.substring(0, 8);
}

// 为并排视图准备数据
const splitViewData = computed(() => {
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];

  let i = 0;
  const lines = props.diff.lines;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'unchanged') {
      left.push(line);
      right.push(line);
      i++;
    } else if (line.type === 'removed') {
      // 查找下一个连续的 added 行进行配对
      const removedLines: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'removed') {
        removedLines.push(lines[i]);
        i++;
      }
      const addedLines: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'added') {
        addedLines.push(lines[i]);
        i++;
      }

      // 配对 removed 和 added
      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        left.push(j < removedLines.length ? removedLines[j] : null);
        right.push(j < addedLines.length ? addedLines[j] : null);
      }
    } else if (line.type === 'added') {
      left.push(null);
      right.push(line);
      i++;
    }
  }

  return { left, right };
});
</script>

<template>
  <div class="diff-viewer fixed inset-0 z-50 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4">
    <div class="bg-app-surface-light dark:bg-app-surface-dark rounded-lg shadow-2xl w-full max-w-[90vw] max-h-[90vh] flex flex-col transition-colors duration-200">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border-light dark:border-border-dark">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
            Version Comparison
          </h2>
          <div class="flex items-center gap-2 text-sm">
            <code class="px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-mono">
              {{ shortHash(diff.fromVersion) }}
            </code>
            <span class="text-text-secondary-light dark:text-text-secondary-dark">→</span>
            <code class="px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-mono">
              {{ shortHash(diff.toVersion) }}
            </code>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <!-- 统计信息 -->
          <div class="flex items-center gap-3 text-sm">
            <span class="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Plus :size="14" />
              {{ diff.stats.additions }}
            </span>
            <span class="flex items-center gap-1 text-red-600 dark:text-red-400">
              <Minus :size="14" />
              {{ diff.stats.deletions }}
            </span>
            <span class="flex items-center gap-1 text-text-secondary-light dark:text-text-secondary-dark">
              <Equal :size="14" />
              {{ diff.stats.unchanged }}
            </span>
          </div>

          <!-- 视图切换 -->
          <div class="flex items-center rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
            <button
              @click="viewMode = 'unified'"
              :class="[
                'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
                viewMode === 'unified'
                  ? 'bg-claude-primary text-white'
                  : 'bg-transparent text-text-secondary-light dark:text-text-secondary-dark hover:bg-gray-100 dark:hover:bg-gray-800'
              ]"
            >
              <AlignJustify :size="14" />
              Unified
            </button>
            <button
              @click="viewMode = 'split'"
              :class="[
                'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
                viewMode === 'split'
                  ? 'bg-claude-primary text-white'
                  : 'bg-transparent text-text-secondary-light dark:text-text-secondary-dark hover:bg-gray-100 dark:hover:bg-gray-800'
              ]"
            >
              <Columns :size="14" />
              Split
            </button>
          </div>

          <!-- 关闭按钮 -->
          <button
            @click="emit('close')"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary-light dark:text-text-secondary-dark transition-colors"
          >
            <X :size="20" />
          </button>
        </div>
      </div>

      <!-- Diff Content -->
      <div class="flex-1 overflow-auto">
        <!-- Unified View -->
        <div v-if="viewMode === 'unified'" class="font-mono text-sm">
          <div
            v-for="(line, index) in diff.lines"
            :key="index"
            :class="[
              'flex border-b border-border-light/50 dark:border-border-dark/50',
              line.type === 'added' ? 'bg-green-50 dark:bg-green-900/20' : '',
              line.type === 'removed' ? 'bg-red-50 dark:bg-red-900/20' : ''
            ]"
          >
            <!-- 行号 -->
            <div class="flex-shrink-0 w-20 flex text-text-secondary-light dark:text-text-secondary-dark text-xs select-none">
              <span class="w-10 px-2 py-1 text-right border-r border-border-light dark:border-border-dark">
                {{ line.oldLineNumber || '' }}
              </span>
              <span class="w-10 px-2 py-1 text-right border-r border-border-light dark:border-border-dark">
                {{ line.newLineNumber || '' }}
              </span>
            </div>

            <!-- 符号 -->
            <div
              :class="[
                'flex-shrink-0 w-6 text-center py-1 select-none',
                line.type === 'added' ? 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40' : '',
                line.type === 'removed' ? 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40' : ''
              ]"
            >
              {{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}
            </div>

            <!-- 内容 -->
            <pre
              :class="[
                'flex-1 py-1 px-4 whitespace-pre-wrap break-all',
                line.type === 'added' ? 'text-green-800 dark:text-green-200' : '',
                line.type === 'removed' ? 'text-red-800 dark:text-red-200' : 'text-text-primary-light dark:text-text-primary-dark'
              ]"
            >{{ line.content }}</pre>
          </div>
        </div>

        <!-- Split View -->
        <div v-else class="flex font-mono text-sm h-full">
          <!-- 左侧（旧版本） -->
          <div class="flex-1 border-r border-border-light dark:border-border-dark overflow-auto">
            <div class="sticky top-0 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-border-light dark:border-border-dark text-xs text-red-700 dark:text-red-400 font-medium">
              {{ shortHash(diff.fromVersion) }} (Base)
            </div>
            <div
              v-for="(line, index) in splitViewData.left"
              :key="'left-' + index"
              :class="[
                'flex border-b border-border-light/50 dark:border-border-dark/50 min-h-[28px]',
                line?.type === 'removed' ? 'bg-red-50 dark:bg-red-900/20' : ''
              ]"
            >
              <template v-if="line">
                <span class="flex-shrink-0 w-12 px-2 py-1 text-right text-xs text-text-secondary-light dark:text-text-secondary-dark border-r border-border-light dark:border-border-dark select-none">
                  {{ line.oldLineNumber || '' }}
                </span>
                <pre
                  :class="[
                    'flex-1 py-1 px-4 whitespace-pre-wrap break-all',
                    line.type === 'removed' ? 'text-red-800 dark:text-red-200' : 'text-text-primary-light dark:text-text-primary-dark'
                  ]"
                >{{ line.content }}</pre>
              </template>
              <template v-else>
                <span class="flex-shrink-0 w-12 px-2 py-1 border-r border-border-light dark:border-border-dark"></span>
                <span class="flex-1 py-1 px-4 bg-gray-50 dark:bg-gray-800/50"></span>
              </template>
            </div>
          </div>

          <!-- 右侧（新版本） -->
          <div class="flex-1 overflow-auto">
            <div class="sticky top-0 px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-border-light dark:border-border-dark text-xs text-green-700 dark:text-green-400 font-medium">
              {{ shortHash(diff.toVersion) }} (Target)
            </div>
            <div
              v-for="(line, index) in splitViewData.right"
              :key="'right-' + index"
              :class="[
                'flex border-b border-border-light/50 dark:border-border-dark/50 min-h-[28px]',
                line?.type === 'added' ? 'bg-green-50 dark:bg-green-900/20' : ''
              ]"
            >
              <template v-if="line">
                <span class="flex-shrink-0 w-12 px-2 py-1 text-right text-xs text-text-secondary-light dark:text-text-secondary-dark border-r border-border-light dark:border-border-dark select-none">
                  {{ line.newLineNumber || '' }}
                </span>
                <pre
                  :class="[
                    'flex-1 py-1 px-4 whitespace-pre-wrap break-all',
                    line.type === 'added' ? 'text-green-800 dark:text-green-200' : 'text-text-primary-light dark:text-text-primary-dark'
                  ]"
                >{{ line.content }}</pre>
              </template>
              <template v-else>
                <span class="flex-shrink-0 w-12 px-2 py-1 border-r border-border-light dark:border-border-dark"></span>
                <span class="flex-1 py-1 px-4 bg-gray-50 dark:bg-gray-800/50"></span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-3 border-t border-border-light dark:border-border-dark flex justify-end">
        <button
          @click="emit('close')"
          class="px-4 py-2 bg-claude-primary dark:bg-claude-primary-dark text-white rounded-lg hover:bg-claude-primary-hover transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
