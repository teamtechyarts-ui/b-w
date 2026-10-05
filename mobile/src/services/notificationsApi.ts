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

export async function getNotifications(accessToken: string): Promise<CustomerNotification[]> {
  const result = await apiRequest<CustomerNotification[]>('/notifications', {
    accessToken,
  });
  if (!Array.isArray(result)) {
    throw new Error('Unable to load notifications.');
  }
  return result;
}

export async function markNotificationRead(accessToken: string, id: string): Promise<CustomerNotification> {
  return apiRequest<CustomerNotification>(`/notifications/${id}/read`, {
    method: 'POST',
    accessToken,
  });
}

export async function markAllNotificationsRead(accessToken: string): Promise<{updatedCount: number}> {
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
