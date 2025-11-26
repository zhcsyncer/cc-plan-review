<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { ArrowLeft, Plus, Trash2, Bell, BellOff, FileText, Settings } from 'lucide-vue-next';
import { useConfig, type CommentTemplate, type NotificationSettings } from '../composables/useConfig';

const {
  config,
  loading,
  loadConfig,
  getTemplates,
  addTemplate,
  deleteTemplate,
  getNotificationSettings,
  updateNotificationSettings
} = useConfig();

// 模板管理
const templates = computed(() => config.value?.templates || []);
const builtInTemplates = computed(() => templates.value.filter(t => t.isBuiltIn));
const customTemplates = computed(() => templates.value.filter(t => !t.isBuiltIn));

// 新增模板表单
const showAddForm = ref(false);
const newTemplateName = ref('');
const newTemplateContent = ref('');

// 通知设置
const notificationSettings = computed(() => config.value?.notification || {
  enabled: true,
  versionUpdated: true,
  questionsUpdated: true,
  timeoutWarning: true
});

const notificationPermission = ref<NotificationPermission>('default');

onMounted(async () => {
  await loadConfig();

  // 检查通知权限
  if ('Notification' in window) {
    notificationPermission.value = Notification.permission;
  }
});

// 请求通知权限
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;

  const permission = await Notification.requestPermission();
  notificationPermission.value = permission;
}

// 更新通知设置
async function toggleNotificationSetting(key: keyof NotificationSettings) {
  const current = notificationSettings.value[key];
  await updateNotificationSettings({ [key]: !current });
}

// 添加模板
async function handleAddTemplate() {
  if (!newTemplateName.value.trim() || !newTemplateContent.value.trim()) return;

  try {
    await addTemplate({
      name: newTemplateName.value.trim(),
      content: newTemplateContent.value.trim()
    });
    newTemplateName.value = '';
    newTemplateContent.value = '';
    showAddForm.value = false;
  } catch (e) {
    alert('添加模板失败');
  }
}

// 删除模板
async function handleDeleteTemplate(templateId: string) {
  if (!confirm('确定要删除这个模板吗？')) return;

  try {
    await deleteTemplate(templateId);
  } catch (e) {
    alert('删除模板失败');
  }
}

// 返回主页
function goBack() {
  window.history.back();
}
</script>

<template>
  <div class="min-h-screen bg-app-bg-light dark:bg-app-bg-dark transition-colors duration-200">
    <!-- Header -->
    <header class="bg-app-surface-light dark:bg-app-surface-dark border-b border-border-light dark:border-border-dark p-4">
      <div class="max-w-2xl mx-auto flex items-center gap-4">
        <button
          @click="goBack"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft :size="20" class="text-text-primary-light dark:text-text-primary-dark" />
        </button>
        <div class="flex items-center gap-2">
          <Settings :size="24" class="text-claude-primary" />
          <h1 class="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Settings</h1>
        </div>
      </div>
    </header>

    <main class="max-w-2xl mx-auto p-6 space-y-8">
      <!-- 通知设置 -->
      <section class="bg-app-surface-light dark:bg-app-surface-dark rounded-lg border border-border-light dark:border-border-dark p-6">
        <div class="flex items-center gap-2 mb-4">
          <Bell :size="20" class="text-claude-primary" />
          <h2 class="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">通知设置</h2>
        </div>

        <!-- 权限状态 -->
        <div class="flex items-center justify-between py-3 border-b border-border-light dark:border-border-dark">
          <span class="text-text-primary-light dark:text-text-primary-dark">浏览器通知权限</span>
          <div class="flex items-center gap-2">
            <span
              :class="[
                'px-2 py-1 text-xs rounded',
                notificationPermission === 'granted' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                notificationPermission === 'denied' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
              ]"
            >
              {{ notificationPermission === 'granted' ? '已授权' : notificationPermission === 'denied' ? '已拒绝' : '未设置' }}
            </span>
            <button
              v-if="notificationPermission !== 'granted'"
              @click="requestNotificationPermission"
              class="px-3 py-1 text-sm bg-claude-primary text-white rounded hover:bg-claude-primary-hover transition-colors"
            >
              申请权限
            </button>
          </div>
        </div>

        <!-- 通知开关列表 -->
        <div class="space-y-3 pt-3">
          <div class="flex items-center justify-between py-2">
            <span class="text-text-primary-light dark:text-text-primary-dark">启用通知</span>
            <button
              @click="toggleNotificationSetting('enabled')"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                notificationSettings.enabled ? 'bg-claude-primary' : 'bg-gray-300 dark:bg-gray-600'
              ]"
            >
              <span
                :class="[
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  notificationSettings.enabled ? 'translate-x-5' : 'translate-x-0.5'
                ]"
              />
            </button>
          </div>

          <div class="pl-4 space-y-3" :class="{ 'opacity-50': !notificationSettings.enabled }">
            <div class="flex items-center justify-between py-1">
              <span class="text-sm text-text-secondary-light dark:text-text-secondary-dark">新版本提交通知</span>
              <button
                @click="toggleNotificationSetting('versionUpdated')"
                :disabled="!notificationSettings.enabled"
                :class="[
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  notificationSettings.versionUpdated ? 'bg-claude-primary' : 'bg-gray-300 dark:bg-gray-600',
                  !notificationSettings.enabled && 'cursor-not-allowed'
                ]"
              >
                <span
                  :class="[
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                    notificationSettings.versionUpdated ? 'translate-x-4' : 'translate-x-0.5'
                  ]"
                />
              </button>
            </div>

            <div class="flex items-center justify-between py-1">
              <span class="text-sm text-text-secondary-light dark:text-text-secondary-dark">Agent 问题通知</span>
              <button
                @click="toggleNotificationSetting('questionsUpdated')"
                :disabled="!notificationSettings.enabled"
                :class="[
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  notificationSettings.questionsUpdated ? 'bg-claude-primary' : 'bg-gray-300 dark:bg-gray-600',
                  !notificationSettings.enabled && 'cursor-not-allowed'
                ]"
              >
                <span
                  :class="[
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                    notificationSettings.questionsUpdated ? 'translate-x-4' : 'translate-x-0.5'
                  ]"
                />
              </button>
            </div>

            <div class="flex items-center justify-between py-1">
              <span class="text-sm text-text-secondary-light dark:text-text-secondary-dark">超时预警通知</span>
              <button
                @click="toggleNotificationSetting('timeoutWarning')"
                :disabled="!notificationSettings.enabled"
                :class="[
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  notificationSettings.timeoutWarning ? 'bg-claude-primary' : 'bg-gray-300 dark:bg-gray-600',
                  !notificationSettings.enabled && 'cursor-not-allowed'
                ]"
              >
                <span
                  :class="[
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                    notificationSettings.timeoutWarning ? 'translate-x-4' : 'translate-x-0.5'
                  ]"
                />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 模板管理 -->
      <section class="bg-app-surface-light dark:bg-app-surface-dark rounded-lg border border-border-light dark:border-border-dark p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <FileText :size="20" class="text-claude-primary" />
            <h2 class="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">评论模板</h2>
          </div>
          <button
            @click="showAddForm = true"
            class="flex items-center gap-1 px-3 py-1.5 text-sm bg-claude-primary text-white rounded hover:bg-claude-primary-hover transition-colors"
          >
            <Plus :size="16" />
            <span>添加模板</span>
          </button>
        </div>

        <!-- 添加模板表单 -->
        <div v-if="showAddForm" class="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div class="space-y-3">
            <input
              v-model="newTemplateName"
              type="text"
              placeholder="模板名称"
              class="w-full px-3 py-2 border border-border-light dark:border-border-dark rounded-lg bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-claude-primary outline-none"
            />
            <textarea
              v-model="newTemplateContent"
              placeholder="模板内容"
              rows="3"
              class="w-full px-3 py-2 border border-border-light dark:border-border-dark rounded-lg bg-app-surface-light dark:bg-app-surface-dark text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-claude-primary outline-none resize-none"
            ></textarea>
            <div class="flex justify-end gap-2">
              <button
                @click="showAddForm = false; newTemplateName = ''; newTemplateContent = ''"
                class="px-4 py-2 text-text-secondary-light dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              >
                取消
              </button>
              <button
                @click="handleAddTemplate"
                :disabled="!newTemplateName.trim() || !newTemplateContent.trim()"
                class="px-4 py-2 bg-claude-primary text-white rounded hover:bg-claude-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>

        <!-- 内置模板 -->
        <div v-if="builtInTemplates.length > 0" class="mb-4">
          <h3 class="text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">内置模板</h3>
          <div class="space-y-2">
            <div
              v-for="template in builtInTemplates"
              :key="template.id"
              class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
            >
              <div class="font-medium text-text-primary-light dark:text-text-primary-dark">{{ template.name }}</div>
              <div class="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">{{ template.content }}</div>
            </div>
          </div>
        </div>

        <!-- 自定义模板 -->
        <div>
          <h3 class="text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">自定义模板</h3>
          <div v-if="customTemplates.length === 0" class="text-center py-4 text-text-secondary-light dark:text-text-secondary-dark">
            暂无自定义模板
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="template in customTemplates"
              :key="template.id"
              class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-start justify-between gap-4"
            >
              <div class="flex-1">
                <div class="font-medium text-text-primary-light dark:text-text-primary-dark">{{ template.name }}</div>
                <div class="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">{{ template.content }}</div>
              </div>
              <button
                @click="handleDeleteTemplate(template.id)"
                class="p-1 text-red-500 hover:text-red-600 transition-colors"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
