// Extended react-native-web wrapper exporting missing native APIs
import * as RNWeb from 'react-native-web';

export * from 'react-native-web';

export const PermissionsAndroid = {
  PERMISSIONS: {
    ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
    ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
    POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
    CAMERA: 'android.permission.CAMERA',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  check: async (_permission: string) => true,
  request: async (_permission: string, _rationale?: any) => 'granted',
  requestMultiple: async (permissions: string[]) => {
    const results: Record<string, string> = {};
    for (const p of permissions) {
      results[p] = 'granted';
    }
    return results;
  },
};

export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  show: (message: string, _duration: number) => {
    console.log(`[Toast] ${message}`);
  },
  showWithGravity: (message: string, _duration: number, _gravity: number) => {
    console.log(`[Toast] ${message}`);
  },
};

// Polyfill BackHandler if missing
export const BackHandler = RNWeb.BackHandler || {
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
  exitApp: () => {},
};

// Polyfill Alert for web
export const Alert = {
  alert: (
    title?: string,
    message?: string,
    buttons?: Array<{
      text?: string;
      onPress?: () => void;
      style?: 'default' | 'cancel' | 'destructive';
    }>,
  ) => {
    const fullMsg = [title, message].filter(Boolean).join('\n\n');
    console.warn(`[Alert] ${fullMsg}`);
    if (buttons && buttons.length > 1) {
      const confirmed = window.confirm(fullMsg);
      if (confirmed) {
        const okBtn = buttons.find(b => b.style !== 'cancel') || buttons[0];
        okBtn?.onPress?.();
      } else {
        const cancelBtn = buttons.find(b => b.style === 'cancel');
        cancelBtn?.onPress?.();
      }
    } else {
      window.alert(fullMsg);
      if (buttons && buttons[0]?.onPress) {
        buttons[0].onPress();
      }
    }
  },
};

export default {
  ...RNWeb,
  Alert,
  PermissionsAndroid,
  ToastAndroid,
  BackHandler,
};
