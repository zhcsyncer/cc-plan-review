<script setup lang="ts">
import { ref } from 'vue';
import { Trash2, Edit2, Check, X } from 'lucide-vue-next';

interface Comment {
  id: string;
  quote: string;
  comment: string;
  isEditing?: boolean;
  tempText?: string;
}

const props = defineProps<{
  comments: Comment[];
  confirmPending?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update-comment', id: string, text: string): void;
  (e: 'delete-comment', id: string): void;
  (e: 'submit-review'): void;
  (e: 'comment-click', id: string): void;
}>();

function startEdit(c: Comment) {
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
</script>

<template>
  <div class="review-sidebar flex flex-col h-full bg-app-bg-light dark:bg-app-bg-dark border-l border-border-light dark:border-border-dark transition-colors duration-200">
    <div class="p-4 border-b border-border-light dark:border-border-dark bg-app-surface-light dark:bg-app-surface-dark transition-colors duration-200">
      <h2 class="font-semibold text-text-primary-light dark:text-text-primary-dark">Review Comments ({{ comments.length }})</h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-if="comments.length === 0" class="text-center text-text-secondary-light dark:text-text-secondary-dark py-8">
        Select text in the plan to add comments.
      </div>

      <div
        v-for="c in comments"
        :key="c.id"
        :data-comment-id="c.id"
        class="bg-app-surface-light dark:bg-app-surface-dark p-3 rounded-lg shadow-sm border border-border-light dark:border-border-dark group hover:border-claude-primary dark:hover:border-claude-primary-dark transition-colors cursor-pointer"
        @click="emit('comment-click', c.id)"
      >
        <!-- Quote -->
        <div class="text-xs text-text-secondary-light dark:text-text-secondary-dark border-l-2 border-claude-primary dark:border-claude-primary-dark pl-2 mb-2 italic truncate">
          "{{ c.quote }}"
        </div>

        <!-- Content -->
        <div v-if="!c.isEditing">
          <div class="text-sm text-text-primary-light dark:text-text-primary-dark mb-2">{{ c.comment }}</div>
          <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button @click.stop="startEdit(c)" class="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-claude-primary dark:hover:text-claude-primary-dark">
              <Edit2 :size="14" />
            </button>
            <button @click.stop="emit('delete-comment', c.id)" class="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-red-600">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <!-- Edit Mode -->
        <div v-else @click.stop>
          <textarea
            v-model="c.tempText"
            class="w-full text-sm border border-border-light dark:border-border-dark rounded p-2 mb-2 focus:ring-2 focus:ring-claude-primary dark:focus:ring-claude-primary-dark outline-none bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark transition-colors duration-200"
            rows="3"
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
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-border-light dark:border-border-dark bg-app-surface-light dark:bg-app-surface-dark transition-colors duration-200">
      <button
        @click="emit('submit-review')"
        :class="[
          'w-full text-white py-2 px-4 rounded-lg font-medium transition-all',
          confirmPending
            ? 'bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-800 animate-pulse'
            : 'bg-claude-primary dark:bg-claude-primary-dark hover:bg-claude-primary-hover'
        ]"
      >
        {{ confirmPending ? 'Click Again to Confirm' : 'Finish Review' }}
      </button>
    </div>
  </div>
</template>
