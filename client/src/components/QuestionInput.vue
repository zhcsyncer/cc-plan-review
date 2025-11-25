<script setup lang="ts">
import { ref, computed } from 'vue';

interface CommentQuestion {
  type: 'clarification' | 'choice' | 'accepted';
  message: string;
  options?: string[];
}

const props = defineProps<{
  question: CommentQuestion;
  answer?: string;
  commentId: string;
}>();

const emit = defineEmits<{
  (e: 'answer', commentId: string, answer: string): void;
}>();

const inputValue = ref(props.answer || '');
const selectedOption = ref(props.answer || '');
const otherValue = ref('');
const showOther = ref(false);

const isAccepted = computed(() => props.question.type === 'accepted');
const isChoice = computed(() => props.question.type === 'choice');
const isClarification = computed(() => props.question.type === 'clarification');

function submitAnswer() {
  let answer = '';
  if (isChoice.value) {
    if (showOther.value && otherValue.value.trim()) {
      answer = `Other: ${otherValue.value.trim()}`;
    } else if (selectedOption.value) {
      answer = selectedOption.value;
    }
  } else if (isClarification.value) {
    answer = inputValue.value.trim();
  }

  if (answer) {
    emit('answer', props.commentId, answer);
  }
}

function selectOption(option: string) {
  selectedOption.value = option;
  showOther.value = false;
}

function selectOther() {
  selectedOption.value = '';
  showOther.value = true;
}
</script>

<template>
  <div class="question-input mt-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
    <!-- Agent's message -->
    <div class="text-sm text-purple-700 dark:text-purple-300 mb-2">
      <span class="font-medium">Agent:</span> {{ question.message }}
    </div>

    <!-- Accepted type: just show checkmark -->
    <div v-if="isAccepted" class="flex items-center gap-2 text-green-600 dark:text-green-400">
      <span>✓</span>
      <span class="text-sm">Accepted</span>
    </div>

    <!-- Clarification type: text input -->
    <div v-else-if="isClarification">
      <textarea
        v-model="inputValue"
        class="w-full border border-purple-300 dark:border-purple-700 rounded p-2 text-sm bg-white dark:bg-gray-800 text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-purple-500 outline-none"
        rows="2"
        placeholder="Type your clarification..."
        :disabled="!!answer"
      ></textarea>
      <button
        v-if="!answer"
        @click="submitAnswer"
        :disabled="!inputValue.trim()"
        class="mt-2 px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Submit Answer
      </button>
      <div v-else class="mt-2 text-sm text-green-600 dark:text-green-400">
        ✓ Answered: {{ answer }}
      </div>
    </div>

    <!-- Choice type: radio buttons -->
    <div v-else-if="isChoice && question.options">
      <div class="space-y-2">
        <label
          v-for="option in question.options"
          :key="option"
          class="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
          :class="{ 'bg-purple-100 dark:bg-purple-900/40': selectedOption === option }"
        >
          <input
            type="radio"
            :name="`question-${commentId}`"
            :value="option"
            :checked="selectedOption === option"
            @change="selectOption(option)"
            :disabled="!!answer"
            class="text-purple-600"
          />
          <span class="text-sm text-text-primary-light dark:text-text-primary-dark">{{ option }}</span>
        </label>

        <!-- Other option -->
        <label
          class="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
          :class="{ 'bg-purple-100 dark:bg-purple-900/40': showOther }"
        >
          <input
            type="radio"
            :name="`question-${commentId}`"
            :checked="showOther"
            @change="selectOther"
            :disabled="!!answer"
            class="text-purple-600"
          />
          <span class="text-sm text-text-primary-light dark:text-text-primary-dark">Other</span>
        </label>

        <!-- Other input -->
        <div v-if="showOther && !answer" class="ml-6">
          <input
            v-model="otherValue"
            type="text"
            class="w-full border border-purple-300 dark:border-purple-700 rounded p-2 text-sm bg-white dark:bg-gray-800 text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-purple-500 outline-none"
            placeholder="Specify your choice..."
          />
        </div>
      </div>

      <button
        v-if="!answer"
        @click="submitAnswer"
        :disabled="!selectedOption && (!showOther || !otherValue.trim())"
        class="mt-3 px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Submit Choice
      </button>
      <div v-else class="mt-2 text-sm text-green-600 dark:text-green-400">
        ✓ Selected: {{ answer }}
      </div>
    </div>
  </div>
</template>
