import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

/**
 * Sanitize markdown content using remark to fix common rendering issues:
 * - Normalizes code block fences (converts ``` to ~~~ to avoid nesting conflicts)
 * - Ensures proper spacing around code blocks
 * - Fixes ambiguous block boundaries
 */
export async function sanitizeMarkdown(raw: string): Promise<string> {
  try {
    const file = await unified()
      .use(remarkParse)
      .use(remarkStringify, {
        fence: '~',           // Use ~~~ instead of ``` to avoid nesting issues
        fences: true,         // Always use fenced code blocks
        bullet: '-',          // Consistent list markers
        emphasis: '*',        // Consistent emphasis
        strong: '*',          // Consistent strong
        rule: '-',            // Consistent horizontal rules
      })
      .process(raw);

    return String(file);
  } catch (error) {
    console.warn('Failed to sanitize markdown, using original:', error);
    return raw;
  }
}

/**
 * Synchronous version using a pre-initialized processor
 * Note: This creates the processor once and reuses it
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkStringify, {
    fence: '~',
    fences: true,
    bullet: '-',
    emphasis: '*',
    strong: '*',
    rule: '-',
  });

export function sanitizeMarkdownSync(raw: string): string {
  try {
    const file = processor.processSync(raw);
    return String(file);
  } catch (error) {
    console.warn('Failed to sanitize markdown, using original:', error);
    return raw;
  }
}

/**
 * Vue composable for markdown sanitization
 */
export function useMarkdownSanitizer() {
  return {
    sanitize: sanitizeMarkdown,
    sanitizeSync: sanitizeMarkdownSync,
  };
}
