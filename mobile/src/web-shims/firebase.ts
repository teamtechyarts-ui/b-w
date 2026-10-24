// Web shim for @react-native-firebase
// On web, push messaging via @react-native-firebase is unsupported; returns null token gracefully.

export enum AuthorizationStatus {
  NOT_DETERMINED = -1,
  DENIED = 0,
  AUTHORIZED = 1,
  PROVISIONAL = 2,
  EPHEMERAL = 3,
}

export interface RemoteMessage {
  messageId?: string;
  category?: string;
  collapseKey?: string;
  contentAvailable?: boolean;
  data?: {[key: string]: string | object};
  from?: string;
  notification?: {
    title?: string;
    body?: string;
    android?: any;
    ios?: any;
  };
  sentTime?: number;
  threadId?: string;
  ttl?: number;
}

export const getMessaging = () => ({
  requestPermission: async () => AuthorizationStatus.DENIED,
  hasPermission: async () => AuthorizationStatus.DENIED,
  getToken: async () => null,
  getInitialNotification: async () => null,
  onTokenRefresh: () => () => {},
  onMessage: () => () => {},
  onNotificationOpenedApp: () => () => {},
  setBackgroundMessageHandler: () => {},
  deleteToken: async () => {},
});

export const requestPermission = async (_messaging?: any) => AuthorizationStatus.DENIED;
export const hasPermission = async (_messaging?: any) => AuthorizationStatus.DENIED;
export const getToken = async (_messaging?: any) => null;
export const getInitialNotification = async (_messaging?: any) => null;
export const onMessage = (_messaging?: any, _listener?: any) => () => {};
export const onNotificationOpenedApp = (_messaging?: any, _listener?: any) => () => {};
export const onTokenRefresh = (_messaging?: any, _listener?: any) => () => {};
export const setBackgroundMessageHandler = (_messaging?: any, _handler?: any) => {};
export const deleteToken = async (_messaging?: any) => {};

export const messaging = () => ({
  requestPermission: async () => AuthorizationStatus.DENIED,
  hasPermission: async () => AuthorizationStatus.DENIED,
  getToken: async () => null,
  getInitialNotification: async () => null,
  onTokenRefresh: () => () => {},
  onMessage: () => () => {},
  onNotificationOpenedApp: () => () => {},
  setBackgroundMessageHandler: () => {},
  deleteToken: async () => {},
});

export const getApp = () => ({});
export const initializeApp = () => ({});

export const firebase = {
  messaging,
  app: () => ({}),
  initializeApp: () => ({}),
};

export default firebase;

