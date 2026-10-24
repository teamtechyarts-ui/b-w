import React from 'react';
import {
  NavigationContainerRefContext,
  NavigationContext,
} from '@react-navigation/native';

type EffectCallback = () => undefined | void | (() => void);

/**
 * Safe version of useFocusEffect that:
 * 1. Runs effect when screen is focused or regains focus in React Navigation.
 * 2. Safely degrades to a no-op when rendered outside NavigationContainer (e.g. in isolated unit tests).
 */
export function useSafeFocusEffect(effect: EffectCallback) {
  const root = React.useContext(NavigationContainerRefContext);
  const navigation = React.useContext(NavigationContext);
  const nav: any = navigation ?? root;

  React.useEffect(() => {
    if (!nav || typeof nav.isFocused !== 'function' || typeof nav.addListener !== 'function') {
      return;
    }

    let isFocused = false;
    let cleanup: undefined | void | (() => void);

    const callback = () => {
      const destroy = effect();
      if (typeof destroy === 'function') {
        return destroy;
      }
    };

    if (nav.isFocused()) {
      isFocused = true;
      cleanup = callback();
    }

    const unsubscribeFocus = nav.addListener('focus', () => {
      if (isFocused) {
        return;
      }
      if (cleanup !== undefined) {
        cleanup();
      }
      isFocused = true;
      cleanup = callback();
    });

    const unsubscribeBlur = nav.addListener('blur', () => {
      if (isFocused) {
        if (cleanup !== undefined) {
          cleanup();
        }
        isFocused = false;
        cleanup = undefined;
      }
    });

    return () => {
      if (cleanup !== undefined) {
        cleanup();
      }
      if (typeof unsubscribeFocus === 'function') {
        unsubscribeFocus();
      }
      if (typeof unsubscribeBlur === 'function') {
        unsubscribeBlur();
      }
    };
  }, [nav, effect]);
}
