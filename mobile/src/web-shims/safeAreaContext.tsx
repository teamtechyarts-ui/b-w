import React from 'react';
import { View } from 'react-native';

export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Metrics = {
  insets: EdgeInsets;
  frame: Rect;
};

const defaultInsets: EdgeInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const defaultFrame: Rect = {
  x: 0,
  y: 0,
  width: typeof window !== 'undefined' ? window.innerWidth : 375,
  height: typeof window !== 'undefined' ? window.innerHeight : 812,
};

export const initialWindowMetrics: Metrics = {
  insets: defaultInsets,
  frame: defaultFrame,
};

export const SafeAreaInsetsContext = React.createContext<EdgeInsets | null>(defaultInsets);
export const SafeAreaFrameContext = React.createContext<Rect | null>(defaultFrame);

export const SafeAreaProvider: React.FC<any> = ({ children, style, ...props }) => {
  return (
    <SafeAreaInsetsContext.Provider value={defaultInsets}>
      <SafeAreaFrameContext.Provider value={defaultFrame}>
        <View style={[{ flex: 1 }, style]} {...props}>
          {children}
        </View>
      </SafeAreaFrameContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
};

export const NativeSafeAreaProvider = SafeAreaProvider;

export const SafeAreaView = React.forwardRef<any, any>(({ children, style, ...props }, ref) => {
  return (
    <View ref={ref} style={[{ flex: 1 }, style]} {...props}>
      {children}
    </View>
  );
});

export function useSafeAreaInsets(): EdgeInsets {
  const insets = React.useContext(SafeAreaInsetsContext);
  return insets || defaultInsets;
}

export function useSafeAreaFrame(): Rect {
  const frame = React.useContext(SafeAreaFrameContext);
  return frame || defaultFrame;
}

export function withSafeAreaInsets(WrappedComponent: any) {
  return React.forwardRef((props: any, ref: any) => {
    const insets = useSafeAreaInsets();
    return <WrappedComponent {...props} insets={insets} ref={ref} />;
  });
}

export default {
  SafeAreaProvider,
  NativeSafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
  useSafeAreaFrame,
  SafeAreaInsetsContext,
  SafeAreaFrameContext,
  initialWindowMetrics,
  withSafeAreaInsets,
};
