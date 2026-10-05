// Browser localStorage shim for react-native-keychain
export const ACCESSIBLE = {
  WHEN_UNLOCKED: 'WhenUnlocked',
  AFTER_FIRST_UNLOCK: 'AfterFirstUnlock',
  ALWAYS: 'Always',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WhenPasscodeSetThisDeviceOnly',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
  ALWAYS_THIS_DEVICE_ONLY: 'AlwaysThisDeviceOnly',
};

export const AUTHENTICATION_TYPE = {
  DEVICE_PASSCODE_OR_BIOMETRICS: 'DevicePasscodeOrBiometrics',
  BIOMETRICS: 'Biometrics',
};

export const ACCESS_CONTROL = {
  USER_PRESENCE: 'UserPresence',
  BIOMETRY_ANY: 'BiometryAny',
  BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
  DEVICE_PASSCODE: 'DevicePasscode',
  APPLICATION_PASSWORD: 'ApplicationPassword',
  BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
  BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BiometryCurrentSetOrDevicePasscode',
};

export const SECURITY_LEVEL = {
  ANY: 'ANY',
  SECURE_SOFTWARE: 'SECURE_SOFTWARE',
  SECURE_HARDWARE: 'SECURE_HARDWARE',
};

type KeychainOptions = {
  service?: string;
  [key: string]: any;
};

function getKey(options?: KeychainOptions): string {
  const service = options?.service || 'com.brightwhitemobile.session';
  return `bw_keychain_${service}`;
}

export async function setGenericPassword(
  username: string,
  password: string,
  options?: KeychainOptions,
): Promise<boolean> {
  try {
    const key = getKey(options);
    const data = JSON.stringify({ username, password });
    localStorage.setItem(key, data);
    return true;
  } catch (err) {
    console.error('[Web Keychain] Error saving session to localStorage:', err);
    return false;
  }
}

export async function getGenericPassword(
  options?: KeychainOptions,
): Promise<{ username: string; password: string; service: string } | false> {
  try {
    const key = getKey(options);
    const data = localStorage.getItem(key);
    if (!data) return false;
    const parsed = JSON.parse(data);
    return {
      username: parsed.username,
      password: parsed.password,
      service: options?.service || 'com.brightwhitemobile.session',
    };
  } catch (err) {
    console.error('[Web Keychain] Error reading session from localStorage:', err);
    return false;
  }
}

export async function resetGenericPassword(
  options?: KeychainOptions,
): Promise<boolean> {
  try {
    const key = getKey(options);
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.error('[Web Keychain] Error clearing session from localStorage:', err);
    return false;
  }
}

export default {
  ACCESSIBLE,
  AUTHENTICATION_TYPE,
  ACCESS_CONTROL,
  SECURITY_LEVEL,
  setGenericPassword,
  getGenericPassword,
  resetGenericPassword,
};
