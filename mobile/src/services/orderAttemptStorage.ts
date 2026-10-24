import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.brightwhitemobile.order-attempt';

export type StoredOrderAttempt = {fingerprint: string; key: string};

export async function loadOrderAttempt(): Promise<StoredOrderAttempt | null> {
  let credentials: Keychain.UserCredentials | false | null = null;
  try {
    credentials = await Keychain.getGenericPassword({service: SERVICE});
  } catch (error) {
    console.warn('[orderAttemptStorage] Failed to read order attempt:', error);
    return null;
  }
  if (!credentials) return null;
  try {
    const attempt: unknown = JSON.parse(credentials.password);
    if (typeof attempt === 'object' && attempt !== null &&
      'fingerprint' in attempt && typeof attempt.fingerprint === 'string' &&
      'key' in attempt && typeof attempt.key === 'string') {
      return attempt as StoredOrderAttempt;
    }
  } catch {
    // Remove invalid local retry state below.
  }
  try {
    await clearOrderAttempt();
  } catch {
    // Safe clear
  }
  return null;
}

export async function saveOrderAttempt(attempt: StoredOrderAttempt): Promise<void> {
  try {
    await Keychain.setGenericPassword('bright-white-order-attempt', JSON.stringify(attempt), {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    console.warn('[orderAttemptStorage] Failed to save order attempt:', error);
  }
}

export async function clearOrderAttempt(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service: SERVICE});
  } catch (error) {
    console.warn('[orderAttemptStorage] Failed to clear order attempt:', error);
  }
}
