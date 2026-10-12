import { useCallback, useRef } from 'react';
import { ScrollView, TextInput, findNodeHandle, UIManager, Platform } from 'react-native';

export function useScrollToError() {
  const scrollViewRef = useRef<ScrollView>(null);
  const fieldRefs = useRef<Map<string, any>>(new Map());
  const fieldLayouts = useRef<Map<string, number>>(new Map());

  const registerField = useCallback((name: string, ref: any) => {
    if (ref) {
      fieldRefs.current.set(name, ref);
    } else {
      fieldRefs.current.delete(name);
    }
  }, []);

  const recordLayout = useCallback((name: string, yPosition: number) => {
    fieldLayouts.current.set(name, yPosition);
  }, []);

  const scrollToField = useCallback(
    (name: string, options: { focus?: boolean; offset?: number } = {}) => {
      const { focus = true, offset = 40 } = options;
      const ref = fieldRefs.current.get(name);
      const recordedY = fieldLayouts.current.get(name);

      if (focus && ref && typeof ref.focus === 'function') {
        try {
          ref.focus();
        } catch {}
      }

      if (recordedY !== undefined && scrollViewRef.current) {
        (scrollViewRef.current as any).scrollTo({
          y: Math.max(0, recordedY - offset),
          animated: true,
        });
        return;
      }

      if (scrollViewRef.current && ref) {
        const node = findNodeHandle(ref);
        const scrollNode = findNodeHandle(scrollViewRef.current);
        if (node && scrollNode) {
          UIManager.measureLayout(
            node,
            scrollNode,
            () => {},
            (_x, y) => {
              (scrollViewRef.current as any)?.scrollTo({
                y: Math.max(0, y - offset),
                animated: true,
              });
            },
          );
        }
      }
    },
    [],
  );

  return {
    scrollViewRef,
    registerField,
    recordLayout,
    scrollToField,
  };
}
