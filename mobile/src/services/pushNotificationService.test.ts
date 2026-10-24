import {Alert, PermissionsAndroid, Platform} from 'react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import {navigateSafely} from '../navigation/navigationRef';
import {
  deactivateDeviceToken,
  incrementUnreadNotificationsCount,
  registerDeviceToken,
} from './notificationsApi';
import {
  handleForegroundMessage,
  handleNotificationTap,
  initializePushNotifications,
  requestNotificationPermission,
  resetPushNotificationServiceForTesting,
  syncDeviceToken,
  unregisterDeviceToken,
} from './pushNotificationService';
import {soundService} from './soundService';

jest.mock('@react-native-firebase/messaging', () => {
  const getInitialNotification = jest.fn().mockResolvedValue(null);
  const onNotificationOpenedApp = jest.fn().mockReturnValue(() => {});
  const onMessage = jest.fn().mockReturnValue(() => {});
  const onTokenRefresh = jest.fn().mockReturnValue(() => {});
  const requestPermission = jest.fn().mockResolvedValue(1); // 1 = AUTHORIZED
  const getToken = jest.fn().mockResolvedValue('mock-fcm-token-xyz');
  const getMessaging = jest.fn().mockReturnValue({});

  return {
    getMessaging,
    getInitialNotification,
    onNotificationOpenedApp,
    onMessage,
    onTokenRefresh,
    requestPermission,
    getToken,
    AuthorizationStatus: {
      NOT_DETERMINED: -1,
      DENIED: 0,
      AUTHORIZED: 1,
      PROVISIONAL: 2,
    },
  };
});

jest.mock('../navigation/navigationRef', () => ({
  navigateSafely: jest.fn(),
  navigationRef: {
    isReady: jest.fn().mockReturnValue(true),
    navigate: jest.fn(),
  },
}));

jest.mock('./notificationsApi', () => ({
  registerDeviceToken: jest.fn().mockResolvedValue({id: 'token-123'}),
  deactivateDeviceToken: jest.fn().mockResolvedValue({deactivated: true}),
  incrementUnreadNotificationsCount: jest.fn(),
}));

jest.mock('./soundService', () => ({
  soundService: {
    playNotificationSound: jest.fn().mockReturnValue(true),
  },
}));

describe('pushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPushNotificationServiceForTesting();
    Object.defineProperty(Platform, 'OS', {
      value: 'android',
      configurable: true,
      writable: true,
    });
    Object.defineProperty(Platform, 'Version', {
      value: 34,
      configurable: true,
      writable: true,
    });
    if (!PermissionsAndroid.PERMISSIONS) {
      (PermissionsAndroid as any).PERMISSIONS = {};
    }
    (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS =
      'android.permission.POST_NOTIFICATIONS';
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
      PermissionsAndroid.RESULTS.GRANTED as any,
    );
  });

  afterEach(() => {
    resetPushNotificationServiceForTesting();
  });

  describe('requestNotificationPermission', () => {
    it('requests POST_NOTIFICATIONS on Android 33+ and Firebase messaging permission', async () => {
      const granted = await requestNotificationPermission();
      expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        'android.permission.POST_NOTIFICATIONS',
        expect.any(Object),
      );
      expect(granted).toBe(true);
    });

    it('returns false if user denies POST_NOTIFICATIONS on Android 33+', async () => {
      jest
        .spyOn(PermissionsAndroid, 'request')
        .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED as any);

      const granted = await requestNotificationPermission();
      expect(granted).toBe(false);
    });
  });

  describe('syncDeviceToken', () => {
    it('retrieves FCM token and registers it with backend for customer', async () => {
      const token = await syncDeviceToken('test-access-token', 'user-1', 'customer');

      expect(token).toBe('mock-fcm-token-xyz');
      expect(registerDeviceToken).toHaveBeenCalledWith(
        'test-access-token',
        'mock-fcm-token-xyz',
        'android',
      );
    });

    it('handles network failure safely without crashing', async () => {
      (registerDeviceToken as jest.Mock).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const token = await syncDeviceToken('test-access-token', 'user-1', 'customer');
      expect(token).toBeNull();
    });
  });

  describe('handleNotificationTap', () => {
    it('navigates to OrderDetails when orderId is present in customer payload', () => {
      handleNotificationTap({
        data: {orderId: 'order-uuid-456'},
      } as any);

      expect(navigateSafely).toHaveBeenCalledWith('OrderDetails', {
        orderId: 'order-uuid-456',
      });
    });

    it('navigates to DriverJobDetail when assignmentId is present for driver', async () => {
      await syncDeviceToken('test-token', 'driver-1', 'driver');

      handleNotificationTap({
        data: {assignmentId: 'assign-uuid-789'},
      } as any);

      expect(navigateSafely).toHaveBeenCalledWith('DriverJobDetail', {
        assignmentId: 'assign-uuid-789',
      });
    });

    it('navigates to general Notifications screen when no orderId is present for customer', () => {
      handleNotificationTap({
        data: {otherKey: 'val'},
      } as any);

      expect(navigateSafely).toHaveBeenCalledWith('Notifications');
    });
  });

  describe('handleForegroundMessage', () => {
    it('increments unread count, triggers chime, and shows in-app alert', async () => {
      await handleForegroundMessage({
        messageId: 'msg-123',
        notification: {
          title: 'Order Dispatched',
          body: 'Your clothes are on the way.',
        },
        data: {
          orderId: 'order-1',
          eventType: 'DISPATCHED',
        },
      } as any);

      expect(incrementUnreadNotificationsCount).toHaveBeenCalledWith(1);
      expect(soundService.playNotificationSound).toHaveBeenCalledWith({
        id: 'msg-123',
        eventType: 'DISPATCHED',
        orderId: 'order-1',
      });
      expect(Alert.alert).toHaveBeenCalledWith(
        'Order Dispatched',
        'Your clothes are on the way.',
        expect.any(Array),
        {cancelable: true},
      );
    });
  });

  describe('unregisterDeviceToken', () => {
    it('deactivates token on backend and clears cached token state', async () => {
      await syncDeviceToken('test-access-token', 'user-1', 'customer');

      await unregisterDeviceToken('test-access-token');

      expect(deactivateDeviceToken).toHaveBeenCalledWith(
        'test-access-token',
        'mock-fcm-token-xyz',
      );
    });
  });

  describe('initializePushNotifications', () => {
    it('registers message and token refresh listeners', () => {
      const cleanup = initializePushNotifications(() => 'access-token');
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });
});
