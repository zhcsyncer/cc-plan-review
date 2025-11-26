/**
 * 配置文件管理器
 * 管理插件配置，包括评论模板和通知设置
 * 配置文件路径: ~/.claude/cc-plan-review/config.json
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

// 评论模板
export interface CommentTemplate {
  id: string;
  name: string;
  content: string;
  isBuiltIn: boolean;
  createdAt?: number;
}

// 通知设置
export interface NotificationSettings {
  enabled: boolean;
  versionUpdated: boolean;
  questionsUpdated: boolean;
  timeoutWarning: boolean;
}

// 插件配置
export interface PluginConfig {
  version: string;
  templates: CommentTemplate[];
  notification: NotificationSettings;
}

// 配置文件路径
const CONFIG_DIR = path.join(os.homedir(), '.claude', 'cc-plan-review');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// 内置模板
const BUILT_IN_TEMPLATES: CommentTemplate[] = [
  {
    id: 'builtin-boundary',
    name: '边界情况',
    content: '请考虑边界情况：',
    isBuiltIn: true
  },
  {
    id: 'builtin-detail',
    name: '方案详情',
    content: '这里的实现方案需要更详细说明',
    isBuiltIn: true
  },
  {
    id: 'builtin-rollback',
    name: '回滚方案',
    content: '是否考虑了回滚方案？',
    isBuiltIn: true
  },
  {
    id: 'builtin-performance',
    name: '性能评估',
    content: '性能影响评估？',
    isBuiltIn: true
  }
];

// 默认通知设置
const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  versionUpdated: true,
  questionsUpdated: true,
  timeoutWarning: true
};

// 默认配置
const DEFAULT_CONFIG: PluginConfig = {
  version: '1.0.0',
  templates: BUILT_IN_TEMPLATES,
  notification: DEFAULT_NOTIFICATION_SETTINGS
};

class ConfigManager {
  private config: PluginConfig | null = null;

  /**
   * 加载配置
   */
  async load(): Promise<PluginConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const data = await fs.readFile(CONFIG_PATH, 'utf-8');
      const loaded = JSON.parse(data) as PluginConfig;

      // 确保内置模板始终存在
      const builtInIds = BUILT_IN_TEMPLATES.map(t => t.id);
      const customTemplates = loaded.templates.filter(t => !t.isBuiltIn);
      loaded.templates = [...BUILT_IN_TEMPLATES, ...customTemplates];

      this.config = loaded;
      logger.info('Config loaded from file');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 配置文件不存在，创建默认配置
        this.config = { ...DEFAULT_CONFIG };
        await this.save();
        logger.info('Created default config file');
      } else {
        logger.error(`Failed to load config: ${error.message}`);
        this.config = { ...DEFAULT_CONFIG };
      }
    }

    return this.config;
  }

  /**
   * 保存配置
   */
  async save(): Promise<void> {
    if (!this.config) {
      return;
    }

    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info('Config saved to file');
    } catch (error: any) {
      logger.error(`Failed to save config: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取所有模板
   */
  async getTemplates(): Promise<CommentTemplate[]> {
    const config = await this.load();
    return config.templates;
  }

  /**
   * 更新自定义模板
   */
  async updateTemplates(customTemplates: Omit<CommentTemplate, 'isBuiltIn'>[]): Promise<void> {
    const config = await this.load();

    // 保留内置模板，更新自定义模板
    config.templates = [
      ...BUILT_IN_TEMPLATES,
      ...customTemplates.map(t => ({
        ...t,
        isBuiltIn: false,
        createdAt: t.createdAt || Date.now()
      }))
    ];

    await this.save();
  }

  /**
   * 添加自定义模板
   */
  async addTemplate(template: Omit<CommentTemplate, 'id' | 'isBuiltIn' | 'createdAt'>): Promise<CommentTemplate> {
    const config = await this.load();

    const newTemplate: CommentTemplate = {
      ...template,
      id: `custom-${Date.now()}`,
      isBuiltIn: false,
      createdAt: Date.now()
    };

    config.templates.push(newTemplate);
    await this.save();

    return newTemplate;
  }

  /**
   * 删除自定义模板
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    const config = await this.load();

    const template = config.templates.find(t => t.id === templateId);
    if (!template || template.isBuiltIn) {
      return false;
    }

    config.templates = config.templates.filter(t => t.id !== templateId);
    await this.save();

    return true;
  }

  /**
   * 获取通知设置
   */
  async getNotificationSettings(): Promise<NotificationSettings> {
    const config = await this.load();
    return config.notification;
  }

  /**
   * 更新通知设置
   */
  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const config = await this.load();
    config.notification = { ...config.notification, ...settings };
    await this.save();
    return config.notification;
  }

  /**
   * 获取完整配置
   */
  async getConfig(): Promise<PluginConfig> {
    return this.load();
  }
}

// 单例导出
export const configManager = new ConfigManager();
