<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next';

defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();
</script>

<template>
  <div class="flex items-center justify-between py-2 px-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
    <div class="flex items-center gap-2">
      <span class="text-sm text-amber-800 dark:text-amber-200">
        直接通过模式
      </span>
      <div class="group relative">
        <HelpCircle :size="14" class="text-amber-600 dark:text-amber-400 cursor-help" />
        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          开启后，评论将作为建议传递给 Agent，<br/>但不会阻止计划通过
        </div>
      </div>
    </div>
    <button
      type="button"
      @click="emit('update:modelValue', !modelValue)"
      :disabled="disabled"
      :class="[
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2',
        modelValue ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600',
        disabled && 'opacity-50 cursor-not-allowed'
      ]"
    >
      <span
        :class="[
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          modelValue ? 'translate-x-4' : 'translate-x-0.5'
        ]"
      />
    </button>
  </div>
</template>
