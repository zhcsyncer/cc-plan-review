<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { FileText, ChevronDown } from 'lucide-vue-next';
import { useConfig, type CommentTemplate } from '../composables/useConfig';

const emit = defineEmits<{
  (e: 'select', template: CommentTemplate): void;
}>();

const { loadConfig, getTemplates } = useConfig();

const isOpen = ref(false);
const templates = ref<CommentTemplate[]>([]);
const dropdownRef = ref<HTMLElement | null>(null);

// 加载模板
onMounted(async () => {
  try {
    await loadConfig();
    templates.value = getTemplates();
  } catch {
    // 静默处理
  }
});

// 点击外部关闭下拉
function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

function selectTemplate(template: CommentTemplate) {
  emit('select', template);
  isOpen.value = false;
}
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block">
    <button
      type="button"
      @click.stop="isOpen = !isOpen"
      class="flex items-center gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark hover:text-claude-primary dark:hover:text-claude-primary-dark transition-colors"
    >
      <FileText :size="12" />
      <span>模板</span>
      <ChevronDown :size="12" :class="{ 'rotate-180': isOpen }" class="transition-transform" />
    </button>

    <!-- 下拉菜单 -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute left-0 bottom-full mb-1 w-56 bg-app-surface-light dark:bg-app-surface-dark rounded-lg shadow-lg border border-border-light dark:border-border-dark z-50 overflow-hidden"
      >
        <div class="py-1 max-h-48 overflow-y-auto">
          <!-- 内置模板 -->
          <div v-if="templates.filter(t => t.isBuiltIn).length > 0">
            <div class="px-3 py-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark font-medium">
              内置模板
            </div>
            <button
              v-for="template in templates.filter(t => t.isBuiltIn)"
              :key="template.id"
              @click="selectTemplate(template)"
              class="w-full text-left px-3 py-2 text-sm text-text-primary-light dark:text-text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div class="font-medium">{{ template.name }}</div>
              <div class="text-xs text-text-secondary-light dark:text-text-secondary-dark truncate">
                {{ template.content }}
              </div>
            </button>
          </div>

          <!-- 自定义模板 -->
          <div v-if="templates.filter(t => !t.isBuiltIn).length > 0">
            <div class="px-3 py-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark font-medium border-t border-border-light dark:border-border-dark mt-1 pt-2">
              自定义模板
            </div>
            <button
              v-for="template in templates.filter(t => !t.isBuiltIn)"
              :key="template.id"
              @click="selectTemplate(template)"
              class="w-full text-left px-3 py-2 text-sm text-text-primary-light dark:text-text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div class="font-medium">{{ template.name }}</div>
              <div class="text-xs text-text-secondary-light dark:text-text-secondary-dark truncate">
                {{ template.content }}
              </div>
            </button>
          </div>

          <!-- 空状态 -->
          <div v-if="templates.length === 0" class="px-3 py-4 text-sm text-center text-text-secondary-light dark:text-text-secondary-dark">
            暂无模板
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
