/* global jest */
// @ts-ignore
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native-config', () => ({}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const defaultInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  const defaultFrame = { x: 0, y: 0, width: 375, height: 812 };
  const SafeAreaInsetsContext = React.createContext(defaultInsets);
  const SafeAreaFrameContext = React.createContext(defaultFrame);
  return {
    SafeAreaProvider: ({ children }: any) =>
      React.createElement(
        SafeAreaInsetsContext.Provider,
        { value: defaultInsets },
        React.createElement(
          SafeAreaFrameContext.Provider,
          { value: defaultFrame },
          children
        )
      ),
    SafeAreaView: ({ children, style }: any) => React.createElement('View', { style }, children),
    useSafeAreaInsets: () => defaultInsets,
    useSafeAreaFrame: () => defaultFrame,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    initialWindowMetrics: { insets: defaultInsets, frame: defaultFrame },
  };
});


