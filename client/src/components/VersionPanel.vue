<script setup lang="ts">
import { ref, computed } from 'vue';
import { History, GitCompare, RotateCcw, ChevronDown, ChevronUp, Clock, Bot, User } from 'lucide-vue-next';

interface VersionSummary {
  versionHash: string;
  createdAt: number;
  changeDescription?: string;
  author?: 'human' | 'agent';
  isCurrent: boolean;
  hasSameContent: boolean;
}

const props = defineProps<{
  versions: VersionSummary[];
  currentVersion: string;
  selectedVersion?: string;
}>();

const emit = defineEmits<{
  (e: 'select-version', hash: string): void;
  (e: 'compare-versions', from: string, to: string): void;
  (e: 'rollback', hash: string): void;
}>();

const isExpanded = ref(false);

// 按创建时间倒序排列（最新的在前）
const sortedVersions = computed(() => {
  return [...props.versions].sort((a, b) => b.createdAt - a.createdAt);
});

const latestVersion = computed(() => sortedVersions.value[0]);

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;

  // 小于 1 分钟
  if (diff < 60000) {
    return 'Just now';
  }
  // 小于 1 小时
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }
  // 小于 24 小时
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }
  // 超过 24 小时
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function shortHash(hash: string): string {
  return hash.substring(0, 8);
}

function handleVersionClick(version: VersionSummary) {
  emit('select-version', version.versionHash);
}

// 对比版本：以当前版本为 base，点击的版本为 target
function handleCompare(version: VersionSummary) {
  emit('compare-versions', version.versionHash, props.currentVersion);
}

function handleRollback(version: VersionSummary) {
  if (confirm(`Rollback to version ${shortHash(version.versionHash)}?`)) {
    emit('rollback', version.versionHash);
  }
}
</script>

<template>
  <div class="version-panel bg-app-surface-light dark:bg-app-surface-dark border border-border-light dark:border-border-dark rounded-lg shadow-sm transition-colors duration-200">
    <!-- Header - 始终显示 -->
    <div
      class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-t-lg transition-colors"
      @click="isExpanded = !isExpanded"
    >
      <div class="flex items-center gap-2">
        <History :size="18" class="text-claude-primary dark:text-claude-primary-dark" />
        <span class="font-medium text-text-primary-light dark:text-text-primary-dark">
          Version History
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full bg-claude-primary-light dark:bg-claude-primary-dark/20 text-claude-primary dark:text-claude-primary-dark">
          {{ versions.length }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <!-- 当前版本标签 -->
        <span v-if="latestVersion" class="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {{ shortHash(latestVersion.versionHash) }}
        </span>
        <component
          :is="isExpanded ? ChevronUp : ChevronDown"
          :size="18"
          class="text-text-secondary-light dark:text-text-secondary-dark"
        />
      </div>
    </div>

    <!-- 展开的版本列表 -->
    <div v-if="isExpanded" class="border-t border-border-light dark:border-border-dark">
      <!-- 版本列表 -->
      <div class="max-h-64 overflow-y-auto">
        <div
          v-for="(version, index) in sortedVersions"
          :key="version.versionHash"
          :class="[
            'px-4 py-3 border-b border-border-light dark:border-border-dark last:border-b-0 cursor-pointer transition-colors',
            version.versionHash === selectedVersion
              ? 'bg-claude-primary-light dark:bg-claude-primary-dark/20'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
          ]"
          @click="handleVersionClick(version)"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <!-- 版本信息 -->
              <div class="flex items-center gap-2 mb-1">
                <code class="text-xs font-mono text-claude-primary dark:text-claude-primary-dark">
                  {{ shortHash(version.versionHash) }}
                </code>
                <span v-if="version.isCurrent" class="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                  Current
                </span>
                <span v-if="index === 0 && !version.isCurrent" class="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                  Latest
                </span>
              </div>

              <!-- 变更描述 -->
              <div v-if="version.changeDescription" class="text-sm text-text-primary-light dark:text-text-primary-dark truncate mb-1">
                {{ version.changeDescription }}
              </div>

              <!-- 元信息 -->
              <div class="flex items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <span class="flex items-center gap-1">
                  <Clock :size="12" />
                  {{ formatTime(version.createdAt) }}
                </span>
                <span v-if="version.author" class="flex items-center gap-1">
                  <Bot v-if="version.author === 'agent'" :size="12" />
                  <User v-else :size="12" />
                  {{ version.author === 'agent' ? 'Agent' : 'Human' }}
                </span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div v-if="!version.isCurrent" class="flex items-center gap-1 ml-2">
              <button
                @click.stop="handleCompare(version)"
                class="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-text-secondary-light dark:text-text-secondary-dark hover:text-claude-primary dark:hover:text-claude-primary-dark transition-colors"
                title="Compare with current version"
              >
                <GitCompare :size="14" />
              </button>
              <button
                v-if="!version.hasSameContent"
                @click.stop="handleRollback(version)"
                class="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-text-secondary-light dark:text-text-secondary-dark hover:text-claude-primary dark:hover:text-claude-primary-dark transition-colors"
                title="Rollback to this version"
              >
                <RotateCcw :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
