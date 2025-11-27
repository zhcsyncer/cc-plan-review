<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { marked } from 'marked';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/core';
import Mark from 'mark.js';

// 导入常用语言支持
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';

// 注册语言
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);

interface Comment {
  id: string;
  quote: string;
  comment: string;
  position: {
    startOffset: number;
    endOffset: number;
  };
  documentVersion: string;
}

const props = defineProps<{
  content: string;
  comments: Comment[];
  activeCommentId: string | null;
  isHistoricalVersion?: boolean;  // 是否是历史版本（禁用评论）
  currentVersion: string;  // 当前查看的版本
}>();

interface CommentRequest {
  quote: string;
  position: {
    startOffset: number;
    endOffset: number;
  };
  boundingRect: DOMRect;
}

const emit = defineEmits<{
  (e: 'request-comment', data: CommentRequest): void;
  (e: 'highlight-click', id: string): void;
  (e: 'selection-change', data: CommentRequest | null): void;
}>();

// mark.js 实例
const markInstance = ref<Mark | null>(null);
const markdownBodyRef = ref<HTMLElement | null>(null);

// 高亮评论文本
function highlightComments() {
  if (!markInstance.value) return;

  const container = document.querySelector('.markdown-body');
  if (!container) return;

  // 获取 DOM 文本内容，用于计算位置
  const textContent = container.textContent || '';

  // 清除旧高亮
  markInstance.value.unmark({
    done: () => {
      // 仅高亮当前版本的评论
      props.comments
        .filter(comment => comment.documentVersion === props.currentVersion)
        .forEach(comment => {
          // 找出该文本在 DOM 中的所有出现位置
          const occurrences: number[] = [];
          let idx = 0;
          while ((idx = textContent.indexOf(comment.quote, idx)) !== -1) {
            occurrences.push(idx);
            idx += 1;
          }

          if (occurrences.length === 0) return;

          // 根据 markdown 位置确定应该高亮哪个出现
          let targetOccurrence = 0;
          if (occurrences.length > 1) {
            // 找到与 markdown 位置最接近的出现
            const mdOffset = comment.position.startOffset;
            let minDiff = Infinity;
            occurrences.forEach((domOffset, i) => {
              const diff = Math.abs(domOffset - mdOffset);
              if (diff < minDiff) {
                minDiff = diff;
                targetOccurrence = i;
              }
            });
          }

          let currentOccurrence = 0;
          markInstance.value?.mark(comment.quote, {
            className: 'comment-highlight',
            acrossElements: true,
            separateWordSearch: false,
            filter: () => {
              const shouldMark = currentOccurrence === targetOccurrence;
              currentOccurrence++;
              return shouldMark;
            },
            each: (element: HTMLElement) => {
              element.dataset.commentId = comment.id;
              // 添加点击事件
              element.addEventListener('click', () => {
                emit('highlight-click', comment.id);
              });
            }
          });
        });

      // 更新激活状态
      updateActiveHighlight();
    }
  });
}

// 更新激活状态
function updateActiveHighlight() {
  const highlights = document.querySelectorAll('.comment-highlight');
  highlights.forEach(el => {
    if (el instanceof HTMLElement) {
      if (props.activeCommentId && el.dataset.commentId === props.activeCommentId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });
}

// 配置 Marked 使用自定义渲染器
marked.setOptions({
  breaks: true,
  gfm: true,
});

// 自定义代码块渲染器
const renderer = new marked.Renderer();
const originalCodeRenderer = renderer.code.bind(renderer);

renderer.code = function(code, language, isEscaped) {
  // 检查是否是 Mermaid 图表
  if (language === 'mermaid') {
    return `<div class="mermaid">${code}</div>`;
  }

  // 使用 highlight.js 进行代码高亮
  if (language && hljs.getLanguage(language)) {
    try {
      const highlighted = hljs.highlight(code, { language }).value;
      return `<pre class="hljs"><code class="language-${language}">${highlighted}</code></pre>`;
    } catch (e) {
      console.error('Highlight error:', e);
    }
  }

  // 回退到默认渲染
  return originalCodeRenderer(code, language, isEscaped);
};

marked.use({ renderer });

const renderedContent = computed(() => marked.parse(props.content));

// 监听选区变化（当选区被清除时隐藏按钮）
function handleSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    selectionBtnStyle.value.display = 'none';
    selectedText.value = '';
    selectionRange.value = null;
  }
}

// 初始化 Mermaid 和 mark.js
onMounted(() => {
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    securityLevel: 'loose',
  });
  renderMermaidDiagrams();

  // 初始化 mark.js
  nextTick(() => {
    const container = document.querySelector('.markdown-body');
    if (container) {
      markInstance.value = new Mark(container);
      highlightComments();
    }
  });

  // 监听 selectionchange 事件
  document.addEventListener('selectionchange', handleSelectionChange);
});

onUnmounted(() => {
  document.removeEventListener('selectionchange', handleSelectionChange);
});

// 当内容变化时重新渲染 Mermaid 和高亮
watch(() => props.content, () => {
  nextTick(() => {
    renderMermaidDiagrams();
    // 重新初始化 mark.js（因为 DOM 变了）
    const container = document.querySelector('.markdown-body');
    if (container) {
      markInstance.value = new Mark(container);
      highlightComments();
    }
  });
});

// 监听评论变化，更新高亮
watch(() => props.comments, () => {
  nextTick(() => {
    highlightComments();
  });
}, { deep: true });

// 监听激活状态变化
watch(() => props.activeCommentId, () => {
  updateActiveHighlight();
});

// 监听版本变化，重新高亮
watch(() => props.currentVersion, () => {
  nextTick(() => {
    highlightComments();
  });
});

// 渲染 Mermaid 图表
async function renderMermaidDiagrams() {
  await nextTick();
  const mermaidElements = document.querySelectorAll('.mermaid');

  for (let i = 0; i < mermaidElements.length; i++) {
    const element = mermaidElements[i];
    const code = element.textContent || '';

    try {
      const { svg } = await mermaid.render(`mermaid-${i}-${Date.now()}`, code);
      element.innerHTML = svg;
    } catch (e) {
      console.error('Mermaid rendering error:', e);
      element.innerHTML = `<pre class="text-red-600">Error rendering diagram: ${e}</pre>`;
    }
  }
}

const selectionBtnStyle = ref({ top: '0px', left: '0px', display: 'none' });
const selectedText = ref('');
const selectionRange = ref<Range | null>(null);

// 计算节点在文档中的全局字符偏移量
function calculateGlobalOffset(container: Node, offset: number): number {
  // 获取根容器元素
  const rootContainer = document.querySelector('.markdown-body');
  if (!rootContainer) return 0;

  let globalOffset = 0;
  const walker = document.createTreeWalker(
    rootContainer,
    NodeFilter.SHOW_TEXT,
    null
  );

  let currentNode = walker.nextNode();

  // 遍历所有文本节点直到找到目标节点
  while (currentNode) {
    if (currentNode === container) {
      return globalOffset + offset;
    }
    globalOffset += currentNode.textContent?.length || 0;
    currentNode = walker.nextNode();
  }

  return globalOffset;
}

// 计算选区在原始 Markdown 中的偏移量（更精确的方法）
function calculateMarkdownOffset(quote: string): { startOffset: number; endOffset: number } {
  // 简单方法：在原始 content 中查找 quote
  // 注意：这个方法假设 quote 在文档中是唯一的或首次出现
  const startOffset = props.content.indexOf(quote);

  if (startOffset === -1) {
    // 如果直接查找失败，尝试规范化空白字符后再查找
    const normalizedQuote = quote.replace(/\s+/g, ' ');
    const normalizedContent = props.content.replace(/\s+/g, ' ');
    const normalizedStart = normalizedContent.indexOf(normalizedQuote);

    if (normalizedStart === -1) {
      // 如果仍然失败，返回 0（这种情况应该记录日志）
      console.warn('Could not find quote in content:', quote);
      return { startOffset: 0, endOffset: quote.length };
    }

    // 计算原始偏移量（考虑空白字符的差异）
    let realOffset = 0;
    let normalizedOffset = 0;
    while (normalizedOffset < normalizedStart && realOffset < props.content.length) {
      if (!/\s/.test(props.content[realOffset])) {
        normalizedOffset++;
      } else if (/\s/.test(props.content[realOffset])) {
        // 跳过原始内容中的空白字符
        while (realOffset < props.content.length && /\s/.test(props.content[realOffset])) {
          realOffset++;
        }
        normalizedOffset++; // 对应规范化内容中的一个空格
        continue;
      }
      realOffset++;
    }

    return {
      startOffset: realOffset,
      endOffset: realOffset + quote.length
    };
  }

  return {
    startOffset,
    endOffset: startOffset + quote.length
  };
}

function onMouseUp() {
  // 历史版本不允许添加评论
  if (props.isHistoricalVersion) {
    selectionBtnStyle.value.display = 'none';
    emit('selection-change', null);
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    selectionBtnStyle.value.display = 'none';
    emit('selection-change', null);
    return;
  }

  const text = selection.toString().trim();
  if (!text) {
    emit('selection-change', null);
    return;
  }

  const range = selection.getRangeAt(0);

  // 检查选中区域是否在已有高亮内，如果是则不显示评论按钮
  const container = range.commonAncestorContainer;
  const parentElement = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container as HTMLElement;

  if (parentElement?.closest('.comment-highlight')) {
    selectionBtnStyle.value.display = 'none';
    emit('selection-change', null);
    return;
  }

  const rect = range.getBoundingClientRect();

  selectionBtnStyle.value = {
    top: `${rect.top - 40}px`,
    left: `${rect.left}px`,
    display: 'block'
  };

  selectedText.value = text;
  selectionRange.value = range.cloneRange();

  // 发出选中状态变化事件
  const position = calculateMarkdownOffset(text);
  emit('selection-change', {
    quote: text,
    position,
    boundingRect: rect
  });
}

function addComment() {
  if (!selectedText.value || !selectionRange.value) return;

  // 计算位置信息
  const position = calculateMarkdownOffset(selectedText.value);
  const rect = selectionRange.value.getBoundingClientRect();

  emit('request-comment', {
    quote: selectedText.value,
    position,
    boundingRect: rect
  });

  selectionBtnStyle.value.display = 'none';
  window.getSelection()?.removeAllRanges();
  selectedText.value = '';
  selectionRange.value = null;
  emit('selection-change', null);
}
</script>

<template>
  <div class="relative">
    <div
      :class="[
        'markdown-body p-10 lg:p-12 bg-app-surface-light dark:bg-app-surface-dark shadow-md rounded-xl min-h-[80vh] transition-colors duration-200',
        isHistoricalVersion ? 'select-none cursor-default' : ''
      ]"
      v-html="renderedContent"
      @mouseup="onMouseUp"
    ></div>

    <!-- Floating Button (仅在当前版本显示) -->
    <button
      v-if="!isHistoricalVersion && selectionBtnStyle.display !== 'none'"
      :style="{ top: selectionBtnStyle.top, left: selectionBtnStyle.left }"
      class="fixed z-50 bg-claude-primary dark:bg-claude-primary-dark text-white px-4 py-2 rounded-full shadow-lg hover:bg-claude-primary-hover transition-colors text-sm font-medium flex items-center gap-2"
      @click="addComment"
    >
      <span>💬 Comment</span>
    </button>
  </div>
</template>

<style scoped>
/* Enhanced Markdown Styles with Theme Support and Breathing Space */
:deep(h1) {
  @apply text-4xl font-bold mb-6 mt-10 text-text-primary-light dark:text-text-primary-dark;
  line-height: 1.2;
}
:deep(h2) {
  @apply text-3xl font-bold mb-5 mt-8 text-text-primary-light dark:text-text-primary-dark;
  line-height: 1.3;
}
:deep(h3) {
  @apply text-2xl font-bold mb-4 mt-6 text-text-primary-light dark:text-text-primary-dark;
  line-height: 1.4;
}
:deep(h4) { @apply text-xl font-bold mb-3 mt-5 text-text-primary-light dark:text-text-primary-dark; }
:deep(h5) { @apply text-lg font-bold mb-2 mt-4 text-text-primary-light dark:text-text-primary-dark; }
:deep(h6) { @apply text-base font-bold mb-2 mt-3 text-text-primary-light dark:text-text-primary-dark; }

:deep(p) {
  @apply mb-6 leading-relaxed text-text-primary-light dark:text-text-primary-dark;
  font-size: 1.0625rem; /* 17px */
  line-height: 1.75;
}

:deep(ul), :deep(ol) {
  @apply mb-6 text-text-primary-light dark:text-text-primary-dark;
  padding-left: 1.75rem;
}
:deep(ul) { @apply list-disc; }
:deep(ol) { @apply list-decimal; }
:deep(li) {
  @apply mb-2;
  line-height: 1.75;
}
:deep(li > ul), :deep(li > ol) { @apply mt-2 mb-2; }

:deep(pre) {
  @apply bg-app-surface-alt-light dark:bg-app-surface-alt-dark p-5 rounded-lg overflow-x-auto mb-6 border border-border-light dark:border-border-dark;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}
:deep(code) {
  @apply bg-app-surface-alt-light dark:bg-app-surface-alt-dark px-2 py-0.5 rounded text-sm font-mono text-text-primary-light dark:text-text-primary-dark;
}
:deep(pre code) {
  @apply bg-transparent px-0 py-0;
}

:deep(blockquote) {
  @apply border-l-4 border-claude-primary dark:border-claude-primary-dark pl-5 italic text-text-secondary-light dark:text-text-secondary-dark my-6;
  background-color: rgba(124, 58, 237, 0.03);
  padding: 1rem 1.25rem;
  border-radius: 0.375rem;
}

:deep(a) {
  @apply text-claude-primary dark:text-claude-primary-dark hover:underline;
  font-weight: 500;
}
:deep(strong) { @apply font-bold text-text-primary-light dark:text-text-primary-dark; }
:deep(em) { @apply italic; }
:deep(hr) {
  @apply border-border-light dark:border-border-dark my-10;
  border-width: 1px;
}

:deep(table) {
  @apply w-full mb-6 border-collapse;
}
:deep(th), :deep(td) {
  @apply border border-border-light dark:border-border-dark px-4 py-2 text-left text-text-primary-light dark:text-text-primary-dark;
}
:deep(th) {
  @apply bg-app-surface-alt-light dark:bg-app-surface-alt-dark font-semibold;
}

/* 增加首段的上边距 */
:deep(h1:first-child), :deep(h2:first-child), :deep(h3:first-child) {
  @apply mt-0;
}
</style>
