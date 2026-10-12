import { AppRegistry, NativeModules } from 'react-native';
import App from './App';
import appJson from './app.json';

// Global Web NativeModules polyfill
if (typeof NativeModules === 'object' && NativeModules !== null) {
  NativeModules.BWDriverTripLocation = {
    start: async () => console.log('[Web GPS] Trip tracking started'),
    stop: async () => console.log('[Web GPS] Trip tracking stopped'),
  };
  NativeModules.DriverTripLocation = {
    start: async () => console.log('[Web GPS] Trip tracking started'),
    stop: async () => console.log('[Web GPS] Trip tracking stopped'),
  };
  NativeModules.BWNotificationPermission = {
    requestPermission: async () => true,
  };
}

const appName = appJson.name || 'BrightWhiteMobile';

AppRegistry.registerComponent(appName, () => App);

const rootElement = document.getElementById('root');
if (rootElement) {
  AppRegistry.runApplication(appName, {
    initialProps: {},
    rootTag: rootElement as any,
  });
}
