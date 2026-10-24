/**
 * Web implementation of PushNotificationService.
 * In browser environments, native push notification mechanisms are unsupported.
 * All functions fail safely and return graceful defaults without calling native Firebase APIs.
 */

export type PushNotificationRegistrationState = {
  token: string | null;
  registeredUserId: string | null;
  permissionGranted: boolean;
};

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export function handleNotificationTap(_remoteMessage: any): void {
  // Safe no-op on web
}

export async function handleForegroundMessage(_remoteMessage: any): Promise<void> {
  // Safe no-op on web
}

export async function syncDeviceToken(
  _accessToken: string,
  _userId: string,
  _userRole?: string | null,
): Promise<string | null> {
  return null;
}

export async function unregisterDeviceToken(_accessToken?: string | null): Promise<void> {
  // Safe no-op on web
}

export function initializePushNotifications(
  _getLatestAccessToken?: () => string | null,
): () => void {
  // Safe no-op on web
  return () => {};
}

export function getPushNotificationState(): PushNotificationRegistrationState {
  return {
    token: null,
    registeredUserId: null,
    permissionGranted: false,
  };
}

export function resetPushNotificationServiceForTesting(): void {
  // Safe no-op on web
}
