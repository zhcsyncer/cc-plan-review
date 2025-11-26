<script setup lang="ts">
import { computed } from 'vue';
import { isMac } from '../composables/useKeyboard';

const props = defineProps<{
  keys: string;  // 格式: "mod+shift+p" 或 "c" 或 "arrowleft"
}>();

// 解析并转换快捷键
const parsedKeys = computed(() => {
  const parts = props.keys.toLowerCase().split('+');
  return parts.map(part => {
    switch (part) {
      case 'mod':
        return isMac.value ? '⌘' : 'Ctrl';
      case 'shift':
        return isMac.value ? '⇧' : 'Shift';
      case 'alt':
        return isMac.value ? '⌥' : 'Alt';
      case 'ctrl':
        return isMac.value ? '⌃' : 'Ctrl';
      case 'enter':
        return isMac.value ? '↵' : 'Enter';
      case 'space':
        return isMac.value ? '␣' : 'Space';
      case 'esc':
      case 'escape':
        return 'Esc';
      case 'arrowleft':
      case 'left':
        return '←';
      case 'arrowright':
      case 'right':
        return '→';
      case 'arrowup':
      case 'up':
        return '↑';
      case 'arrowdown':
      case 'down':
        return '↓';
      case 'backspace':
        return '⌫';
      case 'delete':
        return '⌦';
      case 'tab':
        return '⇥';
      default:
        return part.toUpperCase();
    }
  });
});

// Mac 上不需要 + 分隔符
const separator = computed(() => isMac.value ? '' : '+');
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <template v-for="(key, index) in parsedKeys" :key="index">
      <kbd
        class="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-sm text-text-secondary-light dark:text-text-secondary-dark"
      >
        {{ key }}
      </kbd>
      <span
        v-if="index < parsedKeys.length - 1 && separator"
        class="text-xs text-text-secondary-light dark:text-text-secondary-dark"
      >
        {{ separator }}
      </span>
    </template>
  </span>
</template>
