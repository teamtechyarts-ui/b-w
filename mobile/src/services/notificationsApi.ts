import {apiRequest} from './api';

export type CustomerNotification = {
  id: string;
  notification_type: string | null;
  event_type: string | null;
  title: string;
  body: string | null;
  message: string | null;
  data: {
    orderId?: string;
    orderNumber?: string;
    assignmentId?: string;
    assignmentType?: string;
    action?: string;
    status?: string;
    facilityId?: string;
    [key: string]: unknown;
  } | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

let currentUnreadCount = 0;
const unreadListeners = new Set<(count: number) => void>();

export function getUnreadNotificationsCount(): number {
  return currentUnreadCount;
}

export function setUnreadNotificationsCount(count: number): void {
  const safeCount = Math.max(0, count);
  if (currentUnreadCount !== safeCount) {
    currentUnreadCount = safeCount;
    unreadListeners.forEach(listener => {
      try {
        listener(safeCount);
      } catch (err) {
        console.warn('[notificationsApi] unread listener error:', err);
      }
    });
  }
}

export function subscribeToUnreadNotificationsCount(listener: (count: number) => void): () => void {
  unreadListeners.add(listener);
  listener(currentUnreadCount);
  return () => {
    unreadListeners.delete(listener);
  };
}

export function incrementUnreadNotificationsCount(delta = 1): void {
  setUnreadNotificationsCount(currentUnreadCount + delta);
}

export function decrementUnreadNotificationsCount(delta = 1): void {
  setUnreadNotificationsCount(Math.max(0, currentUnreadCount - delta));
}

export async function refreshUnreadNotificationsCount(accessToken: string): Promise<number> {
  try {
    const items = await getNotifications(accessToken);
    const count = items.filter(item => !item.is_read).length;
    setUnreadNotificationsCount(count);
    return count;
  } catch {
    return currentUnreadCount;
  }
}

export async function getNotifications(accessToken: string): Promise<CustomerNotification[]> {
  const result = await apiRequest<CustomerNotification[]>('/notifications', {
    accessToken,
  });
  if (!Array.isArray(result)) {
    throw new Error('Unable to load notifications.');
  }
  const unread = result.filter(item => !item.is_read).length;
  setUnreadNotificationsCount(unread);
  return result;
}

export async function markNotificationRead(accessToken: string, id: string): Promise<CustomerNotification> {
  decrementUnreadNotificationsCount();
  return apiRequest<CustomerNotification>(`/notifications/${id}/read`, {
    method: 'POST',
    accessToken,
  });
}

export async function markAllNotificationsRead(accessToken: string): Promise<{updatedCount: number}> {
  setUnreadNotificationsCount(0);
  return apiRequest<{updatedCount: number}>('/notifications/read-all', {
    method: 'POST',
    accessToken,
  });
}

export function notificationOrderId(notification: CustomerNotification): string | null {
  const orderId = notification.data?.orderId;
  return typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null;
}

export function notificationOrderNumber(notification: CustomerNotification): string | null {
  const explicitNumber = notification.data?.orderNumber;
  if (typeof explicitNumber === 'string' && explicitNumber.trim()) {
    return explicitNumber.trim();
  }
  const text = `${notification.title} ${notification.body || ''} ${notification.message || ''}`;
  const match = text.match(/Order\s+([A-Za-z0-9-_]+)/i);
  return match ? match[1] : null;
}

export async function registerDeviceToken(
  accessToken: string,
  token: string,
  platform: 'android' | 'ios' = 'android',
): Promise<{id: string}> {
  return apiRequest<{id: string}>('/notifications/devices', {
    method: 'POST',
    accessToken,
    body: {
      token,
      platform,
    },
  });
}

export async function deactivateDeviceToken(
  accessToken: string,
  token: string,
): Promise<{deactivated: boolean}> {
  return apiRequest<{deactivated: boolean}>('/notifications/devices', {
    method: 'DELETE',
    accessToken,
    body: {
      token,
    },
  });
}

export async function sendDevTestNotification(
  accessToken: string,
  options?: {title?: string; body?: string},
): Promise<{
  ok: boolean;
  notificationId?: string;
  status: string;
  attemptedDeviceCount: number;
  sentCount: number;
  failedCount: number;
  reason?: string;
  acceptanceNote?: string;
}> {
  return apiRequest('/notifications/test', {
    method: 'POST',
    accessToken,
    body: options || {},
  });
}

