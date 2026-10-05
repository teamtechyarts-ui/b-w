// Web shim for @react-native-firebase
// On web, push messaging via @react-native-firebase is unsupported; returns null token gracefully.
export const messaging = () => ({
  requestPermission: async () => 0,
  hasPermission: async () => 0,
  getToken: async () => null,
  onTokenRefresh: () => () => {},
  onMessage: () => () => {},
  setBackgroundMessageHandler: () => {},
});

export const firebase = {
  messaging,
  app: () => ({}),
  initializeApp: () => ({}),
};

export default firebase;
