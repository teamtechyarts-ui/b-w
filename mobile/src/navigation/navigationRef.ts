import {createNavigationContainerRef} from '@react-navigation/native';
import type {RootStackParamList} from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingNavigation: (() => void) | null = null;

export function navigateSafely<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName],
): void {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as any)(name, params);
  } else {
    pendingNavigation = () => {
      if (navigationRef.isReady()) {
        (navigationRef.navigate as any)(name, params);
      }
    };
  }
}

export function flushPendingNavigation(): void {
  if (pendingNavigation && navigationRef.isReady()) {
    const action = pendingNavigation;
    pendingNavigation = null;
    action();
  }
}
