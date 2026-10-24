import {Alert, PermissionsAndroid, Platform} from 'react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  RemoteMessage,
  requestPermission,
} from '@react-native-firebase/messaging';
import {navigateSafely} from '../navigation/navigationRef';
import {
  deactivateDeviceToken,
  incrementUnreadNotificationsCount,
  registerDeviceToken,
} from './notificationsApi';
import {soundService} from './soundService';

export type PushNotificationRegistrationState = {
  token: string | null;
  registeredUserId: string | null;
  permissionGranted: boolean;
};

let currentToken: string | null = null;
let currentUserId: string | null = null;
let currentUserRole: string | null = null;
let isInitialized = false;
let unsubscribeOnMessage: (() => void) | null = null;
let unsubscribeOnTokenRefresh: (() => void) | null = null;
let unsubscribeOnNotificationOpenedApp: (() => void) | null = null;

/**
 * Safely request notification permission across Android (including Android 13+) and iOS.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  try {
    if (Platform.OS === 'android') {
      const sdkVersion =
        typeof Platform.Version === 'number'
          ? Platform.Version
          : parseInt(String(Platform.Version), 10);

      if (sdkVersion >= 33) {
        const permission =
          PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS ||
          ('android.permission.POST_NOTIFICATIONS' as any);
        const granted = await PermissionsAndroid.request(
          permission,
          {
            title: 'Notification Permission',
            message:
              'Bright & White needs notification permission to send you real-time order updates, driver arrivals, and pickup/delivery OTPs.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          return false;
        }
      }
    }

    const messagingInstance = getMessaging();
    const authStatus = await requestPermission(messagingInstance);
    const enabled =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    return enabled;
  } catch (error) {
    console.warn(
      '[pushNotificationService] Error requesting notification permission:',
      error,
    );
    return false;
  }
}

/**
 * Handle notification tap when opened from background or terminated state.
 */
export function handleNotificationTap(remoteMessage: RemoteMessage | null): void {
  if (!remoteMessage) return;

  const data = remoteMessage.data || {};
  const orderId =
    typeof data.orderId === 'string' && data.orderId.trim()
      ? data.orderId.trim()
      : null;
  const assignmentId =
    typeof data.assignmentId === 'string' && data.assignmentId.trim()
      ? data.assignmentId.trim()
      : null;

  const isDriver = currentUserRole === 'driver';

  if (isDriver) {
    if (assignmentId) {
      navigateSafely('DriverJobDetail', {assignmentId});
    } else {
      navigateSafely('DriverNotifications');
    }
  } else {
    if (orderId) {
      navigateSafely('OrderDetails', {orderId});
    } else {
      navigateSafely('Notifications');
    }
  }
}

/**
 * Handle incoming foreground push message.
 */
export async function handleForegroundMessage(
  remoteMessage: RemoteMessage,
): Promise<void> {
  if (!remoteMessage) return;

  const notification = remoteMessage.notification;
  const title = notification?.title || 'Bright & White';
  const body = notification?.body || '';

  // Increment unread count badge
  incrementUnreadNotificationsCount(1);

  // Trigger sound / haptic feedback
  soundService.playNotificationSound({
    id: remoteMessage.messageId,
    eventType:
      (remoteMessage.data?.eventType as string) ||
      (remoteMessage.data?.notificationType as string),
    orderId: remoteMessage.data?.orderId as string,
  });

  // Display user-friendly in-app alert for foreground notifications if body exists
  if (title || body) {
    Alert.alert(
      title,
      body,
      [
        {
          text: 'View',
          onPress: () => handleNotificationTap(remoteMessage),
        },
        {
          text: 'Dismiss',
          style: 'cancel',
        },
      ],
      {cancelable: true},
    );
  }
}

/**
 * Sync device token with backend for authenticated user.
 */
export async function syncDeviceToken(
  accessToken: string,
  userId: string,
  userRole?: string | null,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  currentUserId = userId;
  currentUserRole = userRole ?? null;

  try {
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      return null;
    }

    const messagingInstance = getMessaging();
    const token = await getToken(messagingInstance);
    if (!token) {
      return null;
    }

    currentToken = token;

    // Register token with backend
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerDeviceToken(accessToken, token, platform);

    return token;
  } catch (error) {
    // Fail safely without disrupting the user flow if offline or network unavailable
    console.warn(
      '[pushNotificationService] Device token registration failed:',
      error,
    );
    return null;
  }
}

/**
 * Deactivate device token on sign out.
 */
export async function unregisterDeviceToken(
  accessToken?: string | null,
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    if (accessToken && currentToken) {
      await deactivateDeviceToken(accessToken, currentToken);
    }
  } catch (error) {
    console.warn(
      '[pushNotificationService] Error deactivating device token:',
      error,
    );
  } finally {
    currentToken = null;
    currentUserId = null;
    currentUserRole = null;
  }
}

/**
 * Initialize mobile push notification listeners.
 */
export function initializePushNotifications(
  getLatestAccessToken?: () => string | null,
): () => void {
  if (Platform.OS === 'web' || isInitialized) {
    return () => {};
  }

  isInitialized = true;
  const messagingInstance = getMessaging();

  // 1. Check if app was opened from a terminated state via a notification tap
  getInitialNotification(messagingInstance)
    .then((remoteMessage: RemoteMessage | null) => {
      if (remoteMessage) {
        handleNotificationTap(remoteMessage);
      }
    })
    .catch((error: unknown) => {
      console.warn(
        '[pushNotificationService] Error retrieving initial notification:',
        error,
      );
    });

  // 2. Notification opened when app was in background
  unsubscribeOnNotificationOpenedApp = onNotificationOpenedApp(
    messagingInstance,
    (remoteMessage: RemoteMessage) => {
      handleNotificationTap(remoteMessage);
    },
  );

  // 3. Foreground message listener
  unsubscribeOnMessage = onMessage(
    messagingInstance,
    async (remoteMessage: RemoteMessage) => {
      await handleForegroundMessage(remoteMessage);
    },
  );

  // 4. Token refresh listener
  unsubscribeOnTokenRefresh = onTokenRefresh(
    messagingInstance,
    async (newToken: string) => {
      currentToken = newToken;
      const token = getLatestAccessToken ? getLatestAccessToken() : null;
      if (token && currentUserId) {
        try {
          const platform = Platform.OS === 'ios' ? 'ios' : 'android';
          await registerDeviceToken(token, newToken, platform);
        } catch (error) {
          console.warn(
            '[pushNotificationService] Error re-registering refreshed token:',
            error,
          );
        }
      }
    },
  );

  return () => {
    unsubscribeOnMessage?.();
    unsubscribeOnTokenRefresh?.();
    unsubscribeOnNotificationOpenedApp?.();
    unsubscribeOnMessage = null;
    unsubscribeOnTokenRefresh = null;
    unsubscribeOnNotificationOpenedApp = null;
    isInitialized = false;
  };
}

/**
 * Return current state for diagnostics or testing.
 */
export function getPushNotificationState(): PushNotificationRegistrationState {
  return {
    token: currentToken,
    registeredUserId: currentUserId,
    permissionGranted: Boolean(currentToken),
  };
}

/**
 * Reset service state (for unit testing).
 */
export function resetPushNotificationServiceForTesting(): void {
  currentToken = null;
  currentUserId = null;
  currentUserRole = null;
  isInitialized = false;
  unsubscribeOnMessage?.();
  unsubscribeOnTokenRefresh?.();
  unsubscribeOnNotificationOpenedApp?.();
  unsubscribeOnMessage = null;
  unsubscribeOnTokenRefresh = null;
  unsubscribeOnNotificationOpenedApp = null;
}
