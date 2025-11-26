/**
 * 配置管理 Composable
 * 管理评论模板和通知设置
 */

import { ref, onMounted } from 'vue';

// 评论模板接口
export interface CommentTemplate {
  id: string;
  name: string;
  content: string;
  isBuiltIn: boolean;
  createdAt?: number;
}

// 通知设置接口
export interface NotificationSettings {
  enabled: boolean;
  versionUpdated: boolean;
  questionsUpdated: boolean;
  timeoutWarning: boolean;
}

// 插件配置接口
export interface PluginConfig {
  version: string;
  templates: CommentTemplate[];
  notification: NotificationSettings;
}

// 单例状态
const config = ref<PluginConfig | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

export function useConfig() {
  /**
   * 加载配置
   */
  async function loadConfig(): Promise<PluginConfig> {
    if (config.value) {
      return config.value;
    }

    loading.value = true;
    error.value = null;

    try {
      const res = await fetch('/api/config');
      if (!res.ok) {
        throw new Error('Failed to load config');
      }
      config.value = await res.json();
      return config.value;
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 获取所有模板
   */
  function getTemplates(): CommentTemplate[] {
    return config.value?.templates || [];
  }

  /**
   * 添加自定义模板
   */
  async function addTemplate(template: { name: string; content: string }): Promise<CommentTemplate> {
    const res = await fetch('/api/config/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template)
    });

    if (!res.ok) {
      throw new Error('Failed to add template');
    }

    const result = await res.json();

    // 刷新配置
    await loadConfig();

    return result.template;
  }

  /**
   * 更新自定义模板列表
   */
  async function updateTemplates(templates: Omit<CommentTemplate, 'isBuiltIn'>[]): Promise<void> {
    const res = await fetch('/api/config/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates })
    });

    if (!res.ok) {
      throw new Error('Failed to update templates');
    }

    // 刷新配置
    config.value = null;
    await loadConfig();
  }

  /**
   * 删除模板
   */
  async function deleteTemplate(templateId: string): Promise<boolean> {
    const res = await fetch(`/api/config/templates/${templateId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      return false;
    }

    // 刷新配置
    config.value = null;
    await loadConfig();

    return true;
  }

  /**
   * 获取通知设置
   */
  function getNotificationSettings(): NotificationSettings {
    return config.value?.notification || {
      enabled: true,
      versionUpdated: true,
      questionsUpdated: true,
      timeoutWarning: true
    };
  }

  /**
   * 更新通知设置
   */
  async function updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const res = await fetch('/api/config/notification', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!res.ok) {
      throw new Error('Failed to update notification settings');
    }

    const result = await res.json();

    // 更新本地缓存
    if (config.value) {
      config.value.notification = result.notification;
    }

    return result.notification;
  }

  // 自动加载配置
  onMounted(() => {
    if (!config.value) {
      loadConfig().catch(() => {
        // 静默处理错误
      });
    }
  });

  return {
    config,
    loading,
    error,
    loadConfig,
    getTemplates,
    addTemplate,
    updateTemplates,
    deleteTemplate,
    getNotificationSettings,
    updateNotificationSettings
  };
}
