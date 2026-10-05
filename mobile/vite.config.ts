import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function reactNativeWebPlatformPlugin(): Plugin {
  const webExtensions = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js'];

  return {
    name: 'react-native-web-platform',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;

      // Handle relative imports
      if (source.startsWith('.')) {
        const dir = path.dirname(importer);
        const resolvedPath = path.resolve(dir, source);

        for (const ext of webExtensions) {
          if (fs.existsSync(resolvedPath + ext)) {
            return resolvedPath + ext;
          }
        }
      }

      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');

  return {
    envPrefix: ['VITE_', 'BW_'],
    plugins: [reactNativeWebPlatformPlugin(), react()],
    define: {
      __DEV__: JSON.stringify(true),
      global: 'window',
      __BW_CONFIG__: JSON.stringify(env),
    },
    resolve: {
      extensions: [
        '.web.tsx',
        '.web.ts',
        '.web.jsx',
        '.web.js',
        '.tsx',
        '.ts',
        '.jsx',
        '.js',
        '.json',
      ],
      alias: {
        'react-native/Libraries/Utilities/codegenNativeComponent': path.resolve(__dirname, 'src/web-shims/codegenNativeComponent.ts'),
        'react-native-safe-area-context': path.resolve(__dirname, 'src/web-shims/safeAreaContext.tsx'),
        'react-native': path.resolve(__dirname, 'src/web-shims/react-native.ts'),
        'react-native-keychain': path.resolve(__dirname, 'src/web-shims/keychain.ts'),
        'react-native-config': path.resolve(__dirname, 'src/web-shims/nativeConfig.ts'),
        'react-native-maps': path.resolve(__dirname, 'src/web-shims/maps.tsx'),
        'react-native-image-picker': path.resolve(__dirname, 'src/web-shims/imagePicker.ts'),
        'react-native-razorpay': path.resolve(__dirname, 'src/web-shims/razorpay.ts'),
        '@react-native-community/geolocation': path.resolve(__dirname, 'src/web-shims/geolocation.ts'),
        'react-native-data-scanner': path.resolve(__dirname, 'src/web-shims/dataScanner.ts'),
        '@react-native-firebase/messaging': path.resolve(__dirname, 'src/web-shims/firebase.ts'),
        '@react-native-firebase/app': path.resolve(__dirname, 'src/web-shims/firebase.ts'),
      },
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; script-src-elem * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; style-src * 'unsafe-inline'; img-src * data: blob:;",
      },
    },
  };
});
