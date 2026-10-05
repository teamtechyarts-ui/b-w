import {Platform} from 'react-native';
import Config from 'react-native-config';
import {resolveDevelopmentApiUrl} from './environment';

describe('resolveDevelopmentApiUrl', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    (Platform as any).OS = originalPlatform;
    delete (Config as any).BW_DEV_WEB_API_URL;
    delete (Config as any).BW_DEV_ANDROID_API_URL;
    delete (Config as any).BW_DEV_IOS_API_URL;
    delete (Config as any).BW_API_URL;
  });

  describe('Web platform', () => {
    beforeEach(() => {
      (Platform as any).OS = 'web';
    });

    it('resolves to BW_DEV_WEB_API_URL when set', () => {
      (Config as any).BW_DEV_WEB_API_URL = 'http://127.0.0.1:3000/v1';
      expect(resolveDevelopmentApiUrl()).toBe('http://127.0.0.1:3000/v1');
    });

    it('falls back to BW_API_URL if BW_DEV_WEB_API_URL is missing', () => {
      (Config as any).BW_API_URL = 'http://10.0.2.2:3000/v1';
      expect(resolveDevelopmentApiUrl()).toBe('http://10.0.2.2:3000/v1');
    });

    it('defaults to http://127.0.0.1:3000/v1 if no config is set', () => {
      expect(resolveDevelopmentApiUrl()).toBe('http://127.0.0.1:3000/v1');
    });

    it('never produces localhost:5173 or relative /v1', () => {
      (Config as any).BW_DEV_WEB_API_URL = 'http://127.0.0.1:3000/v1';
      const resolved = resolveDevelopmentApiUrl();
      expect(resolved).not.toContain('5173');
      expect(resolved.startsWith('http://')).toBe(true);
    });
  });

  describe('Android platform', () => {
    beforeEach(() => {
      (Platform as any).OS = 'android';
    });

    it('resolves to BW_DEV_ANDROID_API_URL when set', () => {
      (Config as any).BW_DEV_ANDROID_API_URL = 'http://10.0.2.2:3000/v1';
      expect(resolveDevelopmentApiUrl()).toBe('http://10.0.2.2:3000/v1');
    });

    it('falls back to BW_API_URL if BW_DEV_ANDROID_API_URL is missing', () => {
      (Config as any).BW_API_URL = 'http://10.0.2.2:3000/v1';
      expect(resolveDevelopmentApiUrl()).toBe('http://10.0.2.2:3000/v1');
    });

    it('defaults to http://10.0.2.2:3000/v1 if no config is set', () => {
      expect(resolveDevelopmentApiUrl()).toBe('http://10.0.2.2:3000/v1');
    });
  });

  describe('iOS platform', () => {
    beforeEach(() => {
      (Platform as any).OS = 'ios';
    });

    it('resolves to BW_DEV_IOS_API_URL when set', () => {
      (Config as any).BW_DEV_IOS_API_URL = 'http://127.0.0.1:3000/v1';
      expect(resolveDevelopmentApiUrl()).toBe('http://127.0.0.1:3000/v1');
    });

    it('falls back to BW_API_URL if BW_DEV_IOS_API_URL is missing', () => {
      (Config as any).BW_API_URL = 'http://127.0.0.1:3000/v1';
      expect(resolveDevelopmentApiUrl()).toBe('http://127.0.0.1:3000/v1');
    });

    it('defaults to http://127.0.0.1:3000/v1 if no config is set', () => {
      expect(resolveDevelopmentApiUrl()).toBe('http://127.0.0.1:3000/v1');
    });
  });
});
