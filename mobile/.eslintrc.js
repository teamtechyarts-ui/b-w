module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'react-native/no-inline-styles': 'off',
  },
  ignorePatterns: [
    'dist/**',
    'ios/Pods/**',
    'ios/build/**',
    'android/.gradle/**',
    'android/build/**',
    'android/app/build/**',
    'node_modules/**',
  ],
};