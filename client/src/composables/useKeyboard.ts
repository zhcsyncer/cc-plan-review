import { ref, computed, onMounted, onUnmounted } from 'vue';

// 快捷键绑定配置
export interface KeyBinding {
  id: string;
  key: string;
  modifiers?: {
    mod?: boolean;    // Cmd (Mac) / Ctrl (Win)
    shift?: boolean;
    alt?: boolean;
    ctrl?: boolean;   // 强制 Ctrl，两平台通用
  };
  handler: () => void;
  description: string;
  group: string;
  enableInInput?: boolean;  // 是否在输入框内也触发，默认 false
}

// 全局快捷键注册表（单例）
const globalBindings = ref<Map<string, KeyBinding>>(new Map());
let isListenerAttached = false;

// 平台检测
const isMac = computed(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));

// 符号映射
const symbols = {
  mod: computed(() => isMac.value ? '⌘' : 'Ctrl'),
  shift: computed(() => isMac.value ? '⇧' : 'Shift'),
  alt: computed(() => isMac.value ? '⌥' : 'Alt'),
  ctrl: computed(() => isMac.value ? '⌃' : 'Ctrl'),
  enter: computed(() => isMac.value ? '↵' : 'Enter'),
  space: computed(() => isMac.value ? '␣' : 'Space'),
  esc: 'Esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
};

// 检查是否在输入框内
function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tagName = el.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' ||
         (el as HTMLElement).isContentEditable;
}

// 生成快捷键 ID
function generateBindingKey(key: string, modifiers?: KeyBinding['modifiers']): string {
  const parts: string[] = [];
  if (modifiers?.mod) parts.push('mod');
  if (modifiers?.ctrl) parts.push('ctrl');
  if (modifiers?.shift) parts.push('shift');
  if (modifiers?.alt) parts.push('alt');
  parts.push(key.toLowerCase());
  return parts.join('+');
}

// 全局键盘事件处理
function handleGlobalKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase();

  // 遍历所有绑定，查找匹配的
  for (const binding of globalBindings.value.values()) {
    const bindingKey = binding.key.toLowerCase();

    // 检查按键是否匹配
    if (key !== bindingKey && e.code.toLowerCase() !== bindingKey) continue;

    // 检查修饰键
    const modifiers = binding.modifiers || {};
    const modMatch = modifiers.mod
      ? (isMac.value ? e.metaKey : e.ctrlKey)
      : !(isMac.value ? e.metaKey : e.ctrlKey) || modifiers.ctrl;
    const ctrlMatch = modifiers.ctrl ? e.ctrlKey : !e.ctrlKey || modifiers.mod;
    const shiftMatch = modifiers.shift ? e.shiftKey : !e.shiftKey;
    const altMatch = modifiers.alt ? e.altKey : !e.altKey;

    if (!modMatch || !shiftMatch || !altMatch) continue;
    // ctrl 检查需要特殊处理（Mac 上 mod=Cmd，不需要 Ctrl）
    if (modifiers.ctrl && !e.ctrlKey) continue;

    // 检查是否在输入框内
    if (!binding.enableInInput && isInputFocused()) continue;

    // 匹配成功，执行处理器
    e.preventDefault();
    binding.handler();
    return;
  }
}

// 注册全局事件监听器
function attachGlobalListener() {
  if (isListenerAttached) return;
  window.addEventListener('keydown', handleGlobalKeydown);
  isListenerAttached = true;
}

// 移除全局事件监听器
function detachGlobalListener() {
  if (!isListenerAttached) return;
  window.removeEventListener('keydown', handleGlobalKeydown);
  isListenerAttached = false;
}

export function useKeyboard() {
  // 注册快捷键
  function register(binding: Omit<KeyBinding, 'id'>): () => void {
    const id = generateBindingKey(binding.key, binding.modifiers);
    const fullBinding: KeyBinding = { ...binding, id };

    globalBindings.value.set(id, fullBinding);
    attachGlobalListener();

    // 返回注销函数
    return () => unregister(id);
  }

  // 注销快捷键
  function unregister(id: string): void {
    globalBindings.value.delete(id);

    // 如果没有绑定了，移除监听器
    if (globalBindings.value.size === 0) {
      detachGlobalListener();
    }
  }

  // 按分组获取所有快捷键
  function getBindingsByGroup(): Record<string, KeyBinding[]> {
    const groups: Record<string, KeyBinding[]> = {};

    for (const binding of globalBindings.value.values()) {
      if (!groups[binding.group]) {
        groups[binding.group] = [];
      }
      groups[binding.group].push(binding);
    }

    return groups;
  }

  // 格式化快捷键为显示字符串
  function formatKeys(binding: KeyBinding): string {
    const parts: string[] = [];
    const modifiers = binding.modifiers || {};

    if (modifiers.mod) parts.push(isMac.value ? '⌘' : 'Ctrl');
    if (modifiers.ctrl && !modifiers.mod) parts.push(isMac.value ? '⌃' : 'Ctrl');
    if (modifiers.shift) parts.push(isMac.value ? '⇧' : 'Shift');
    if (modifiers.alt) parts.push(isMac.value ? '⌥' : 'Alt');

    // 格式化按键名称
    const keyMap: Record<string, string> = {
      'enter': isMac.value ? '↵' : 'Enter',
      'escape': 'Esc',
      'arrowleft': '←',
      'arrowright': '→',
      'arrowup': '↑',
      'arrowdown': '↓',
      'space': isMac.value ? '␣' : 'Space',
      '/': '/',
      '?': '?',
    };

    const keyDisplay = keyMap[binding.key.toLowerCase()] || binding.key.toUpperCase();
    parts.push(keyDisplay);

    return parts.join(isMac.value ? '' : '+');
  }

  // 组件卸载时清理
  onUnmounted(() => {
    // 不在这里清理，因为可能有多个组件使用
    // 全局监听器会在所有绑定被移除后自动清理
  });

  return {
    isMac,
    symbols,
    register,
    unregister,
    getBindingsByGroup,
    formatKeys,
    bindings: globalBindings,
    isInputFocused,
  };
}

// 导出单例符号
export { isMac, symbols };
