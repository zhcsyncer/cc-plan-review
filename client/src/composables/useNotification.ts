/**
 * 浏览器通知 Composable
 * 管理 Web Notification API
 */

import { ref, onMounted } from 'vue';
import { useConfig, type NotificationSettings } from './useConfig';

const isSupported = 'Notification' in window;
const permission = ref<NotificationPermission>('default');

export function useNotification() {
  const { getNotificationSettings } = useConfig();

  /**
   * 请求通知权限
   */
  async function requestPermission(): Promise<boolean> {
    if (!isSupported) return false;

    const result = await Notification.requestPermission();
    permission.value = result;
    return result === 'granted';
  }

  /**
   * 发送通知
   */
  function notify(title: string, options?: NotificationOptions): Notification | null {
    if (!isSupported || permission.value !== 'granted') {
      return null;
    }

    const settings = getNotificationSettings();
    if (!settings.enabled) {
      return null;
    }

    const notification = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    return notification;
  }

  /**
   * 新版本提交通知
   */
  function notifyVersionUpdated(versionHash: string) {
    const settings = getNotificationSettings();
    if (!settings.versionUpdated) return;

    notify('Plan Review: 新版本已提交', {
      body: `Agent 提交了修订版本 (${versionHash.substring(0, 8)}...)`,
      tag: 'version-updated'
    });
  }

  /**
   * Agent 问题通知
   */
  function notifyQuestionsUpdated(count: number) {
    const settings = getNotificationSettings();
    if (!settings.questionsUpdated) return;

    notify('Plan Review: Agent 有问题', {
      body: `Agent 对 ${count} 条评论提出了问题，请回复`,
      tag: 'questions-updated'
    });
  }

  /**
   * 超时预警通知
   */
  function notifyTimeoutWarning(remainingMinutes: number) {
    const settings = getNotificationSettings();
    if (!settings.timeoutWarning) return;

    notify('Plan Review: 即将超时', {
      body: `审核将在 ${remainingMinutes} 分钟后超时，请尽快完成`,
      tag: 'timeout-warning',
      requireInteraction: true
    });
  }

  // 初始化权限状态
  onMounted(() => {
    if (isSupported) {
      permission.value = Notification.permission;
    }
  });

  return {
    isSupported,
    permission,
    requestPermission,
    notify,
    notifyVersionUpdated,
    notifyQuestionsUpdated,
    notifyTimeoutWarning
  };
}
