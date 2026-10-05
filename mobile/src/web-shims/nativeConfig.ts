// Browser environment shim for react-native-config
const viteEnv: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? (import.meta as any).env
    : {};

const globalConfig: Record<string, string | undefined> =
  typeof window !== 'undefined' && (window as any).__BW_CONFIG__
    ? (window as any).__BW_CONFIG__
    : {};

const Config: Record<string, string> = {
  BW_API_URL:
    globalConfig.BW_API_URL ||
    viteEnv.BW_API_URL ||
    'http://10.0.2.2:3000/v1',
  BW_DEV_WEB_API_URL:
    globalConfig.BW_DEV_WEB_API_URL ||
    viteEnv.BW_DEV_WEB_API_URL ||
    'http://127.0.0.1:3000/v1',
  BW_DEV_IOS_API_URL:
    globalConfig.BW_DEV_IOS_API_URL ||
    viteEnv.BW_DEV_IOS_API_URL ||
    'http://127.0.0.1:3000/v1',
  BW_DEV_ANDROID_API_URL:
    globalConfig.BW_DEV_ANDROID_API_URL ||
    viteEnv.BW_DEV_ANDROID_API_URL ||
    'http://10.0.2.2:3000/v1',
  BW_DEV_IOS_STORAGE_ORIGIN:
    globalConfig.BW_DEV_IOS_STORAGE_ORIGIN ||
    viteEnv.BW_DEV_IOS_STORAGE_ORIGIN ||
    'http://localhost:54321',
  BW_DEV_ANDROID_STORAGE_ORIGIN:
    globalConfig.BW_DEV_ANDROID_STORAGE_ORIGIN ||
    viteEnv.BW_DEV_ANDROID_STORAGE_ORIGIN ||
    'http://localhost:54321',
  BW_RELEASE_CHANNEL:
    globalConfig.BW_RELEASE_CHANNEL ||
    viteEnv.BW_RELEASE_CHANNEL ||
    'development',
  BW_PRODUCTION_API_URL:
    globalConfig.BW_PRODUCTION_API_URL ||
    viteEnv.BW_PRODUCTION_API_URL ||
    '',
  BW_UAT_API_URL:
    globalConfig.BW_UAT_API_URL ||
    viteEnv.BW_UAT_API_URL ||
    '',
};

// Allow runtime overrides from window.__BW_CONFIG__
if (typeof window !== 'undefined' && (window as any).__BW_CONFIG__) {
  Object.assign(Config, (window as any).__BW_CONFIG__);
}

export default Config;
