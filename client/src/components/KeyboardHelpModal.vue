<script setup lang="ts">
import { computed } from 'vue';
import { X } from 'lucide-vue-next';
import { useKeyboard, type KeyBinding } from '../composables/useKeyboard';
import Kbd from './Kbd.vue';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { getBindingsByGroup, isMac } = useKeyboard();

const groupedBindings = computed(() => getBindingsByGroup());

// 将 binding 转换为 Kbd 组件需要的 keys 格式
function bindingToKeys(binding: KeyBinding): string {
  const parts: string[] = [];
  const modifiers = binding.modifiers || {};

  if (modifiers.mod) parts.push('mod');
  if (modifiers.ctrl && !modifiers.mod) parts.push('ctrl');
  if (modifiers.shift) parts.push('shift');
  if (modifiers.alt) parts.push('alt');
  parts.push(binding.key);

  return parts.join('+');
}

// 分组显示顺序
const groupOrder = ['General', 'Review', 'Comments', 'Navigation'];

const sortedGroups = computed(() => {
  const groups = groupedBindings.value;
  const result: Array<{ name: string; bindings: KeyBinding[] }> = [];

  // 按顺序添加已知分组
  for (const name of groupOrder) {
    if (groups[name]) {
      result.push({ name, bindings: groups[name] });
    }
  }

  // 添加其他分组
  for (const name of Object.keys(groups)) {
    if (!groupOrder.includes(name)) {
      result.push({ name, bindings: groups[name] });
    }
  }

  return result;
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4"
        @click.self="emit('close')"
        @keydown.escape="emit('close')"
      >
        <div
          class="bg-app-surface-light dark:bg-app-surface-dark rounded-lg shadow-xl w-full max-w-lg"
          @click.stop
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-border-light dark:border-border-dark">
            <h2 class="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
              Keyboard Shortcuts
            </h2>
            <button
              @click="emit('close')"
              class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary-light dark:text-text-secondary-dark transition-colors"
            >
              <X :size="20" />
            </button>
          </div>

          <!-- Content -->
          <div class="p-6 max-h-[70vh] overflow-y-auto">
            <div
              v-for="group in sortedGroups"
              :key="group.name"
              class="mb-6 last:mb-0"
            >
              <h3 class="text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark mb-3 uppercase tracking-wider">
                {{ group.name }}
              </h3>
              <div class="space-y-2">
                <div
                  v-for="binding in group.bindings"
                  :key="binding.id"
                  class="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <span class="text-text-primary-light dark:text-text-primary-dark">
                    {{ binding.description }}
                  </span>
                  <Kbd :keys="bindingToKeys(binding)" />
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div
              v-if="sortedGroups.length === 0"
              class="text-center text-text-secondary-light dark:text-text-secondary-dark py-8"
            >
              No keyboard shortcuts registered.
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-border-light dark:border-border-dark bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
            <p class="text-xs text-text-secondary-light dark:text-text-secondary-dark text-center">
              Press <Kbd keys="esc" /> to close this dialog
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
