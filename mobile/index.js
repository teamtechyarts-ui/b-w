/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

if (Platform.OS !== 'web') {
  const messaging = getMessaging();
  setBackgroundMessageHandler(messaging, async remoteMessage => {
    // Background handler called when app is in background or quit state.
    // Firebase Android SDK automatically presents standard notifications with a notification payload.
    return Promise.resolve();
  });
}

AppRegistry.registerComponent(appName, () => App);

