import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.brightwhitemobile.cart';
const WEB_KEY = 'bw_cart_state';

export type CartState = Record<string, number>;

let memoryStore: CartState = {};

export function parseCartState(raw: unknown): CartState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const clean: CartState = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof key === 'string' &&
      key.trim().length > 0 &&
      typeof val === 'number' &&
      Number.isFinite(val) &&
      val > 0
    ) {
      clean[key.trim()] = Math.min(Math.floor(val), 99);
    }
  }
  return clean;
}

export function readWebCartStorage(): CartState | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const item = window.localStorage.getItem(WEB_KEY);
      if (item) {
        return parseCartState(JSON.parse(item));
      }
    }
  } catch {
    // Ignore storage parse errors safely
  }
  if (Object.keys(memoryStore).length > 0) {
    return { ...memoryStore };
  }
  return null;
}

export function writeWebCartStorage(cart: CartState): void {
  memoryStore = { ...cart };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (Object.keys(cart).length === 0) {
        window.localStorage.removeItem(WEB_KEY);
      } else {
        window.localStorage.setItem(WEB_KEY, JSON.stringify(cart));
      }
    }
  } catch {
    // Ignore storage write errors safely
  }
}

export async function loadCartStorage(): Promise<CartState> {
  const web = readWebCartStorage();
  if (web && Object.keys(web).length > 0) return web;

  try {
    if (Keychain && typeof Keychain.getGenericPassword === 'function') {
      const credentials = await Keychain.getGenericPassword({ service: SERVICE });
      if (credentials && credentials.password) {
        return parseCartState(JSON.parse(credentials.password));
      }
    }
  } catch {
    // Ignore keychain read errors safely
  }
  return { ...memoryStore };
}

export async function saveCartStorage(cart: CartState): Promise<void> {
  writeWebCartStorage(cart);
  try {
    if (Keychain && typeof Keychain.setGenericPassword === 'function') {
      if (Object.keys(cart).length === 0) {
        await Keychain.resetGenericPassword({ service: SERVICE });
      } else {
        await Keychain.setGenericPassword('bright-white-cart', JSON.stringify(cart), {
          service: SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
    }
  } catch {
    // Ignore keychain write errors safely
  }
}

export async function clearCartStorage(): Promise<void> {
  memoryStore = {};
  writeWebCartStorage({});
  try {
    if (Keychain && typeof Keychain.resetGenericPassword === 'function') {
      await Keychain.resetGenericPassword({ service: SERVICE });
    }
  } catch {
    // Ignore keychain clear errors safely
  }
}
