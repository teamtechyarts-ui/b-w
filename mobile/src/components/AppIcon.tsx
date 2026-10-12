import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

export type IconName =
  | 'cart'
  | 'search'
  | 'check'
  | 'circle-check'
  | 'close'
  | 'x'
  | 'location'
  | 'pin'
  | 'calendar'
  | 'clock'
  | 'card'
  | 'cash'
  | 'wallet'
  | 'lock'
  | 'truck'
  | 'delivery'
  | 'facility'
  | 'building-2'
  | 'wash'
  | 'washing-machine'
  | 'dry'
  | 'iron'
  | 'fold'
  | 'pack'
  | 'qc'
  | 'package'
  | 'box'
  | 'orders'
  | 'clipboard-list'
  | 'alert'
  | 'circle-alert'
  | 'warning'
  | 'triangle-alert'
  | 'user'
  | 'user-circle'
  | 'users'
  | 'gear'
  | 'settings'
  | 'phone'
  | 'tag'
  | 'info'
  | 'refresh'
  | 'refresh-cw'
  | 'arrow-right'
  | 'arrow-left'
  | 'back'
  | 'arrow-up'
  | 'arrow-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'shield'
  | 'shield-check'
  | 'sparkles'
  | 'plus'
  | 'add'
  | 'minus'
  | 'edit'
  | 'pencil'
  | 'trash'
  | 'delete'
  | 'save'
  | 'play'
  | 'pause'
  | 'home'
  | 'house'
  | 'bell'
  | 'notifications'
  | 'hanger'
  | 'shoe'
  | 'bed'
  | 'chart'
  | 'analytics'
  | 'hand'
  | 'pickup'
  | 'more-vertical';

type AppIconProps = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  accessibilityLabel?: string;
};

const SVG_PATHS: Record<IconName, string> = {
  home: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
  house: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
  bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0',
  notifications: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0',
  hanger: 'M12 2a3 3 0 00-3 3c0 1.3.8 2.4 2 2.8V10l-8.6 6.4A2 2 0 003.6 20H20.4a2 2 0 001.2-3.6L13 10V7.8c1.2-.4 2-1.5 2-2.8a3 3 0 00-3-3z',
  shoe: 'M2 17h20v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2z M2 17l2.5-7.5A2 2 0 016.4 8H11v3h4l2 3h5v3',
  bed: 'M2 4v16 M2 8h18a2 2 0 012 2v10 M2 17h20 M6 8v9',
  chart: 'M18 20V10 M12 20V4 M6 20v-6',
  analytics: 'M18 20V10 M12 20V4 M6 20v-6',
  'clipboard-list': 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2 M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z M9 11h6 M9 15h4',
  'circle-check': 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
  'circle-alert': 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 8v4 M12 16h.01',
  'triangle-alert': 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01',
  'shield-check': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  save: 'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z M17 21v-8H7v8 M7 3v5h8',
  'building-2': 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18 M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2 M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2 M10 6h4 M10 10h4 M10 14h4 M10 18h4',
  hand: 'M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0 M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v6 M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8 M6 14.5v0a4.5 4.5 0 004.5 4.5h3a5.5 5.5 0 005.5-5.5V11a2 2 0 00-2-2v0a2 2 0 00-2 2',
  pickup: 'M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0 M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v6 M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8 M6 14.5v0a4.5 4.5 0 004.5 4.5h3a5.5 5.5 0 005.5-5.5V11a2 2 0 00-2-2v0a2 2 0 00-2 2',
  'more-vertical': 'M12 12h.01 M12 5h.01 M12 19h.01',
  'chevron-down': 'M19 9l-7 7-7-7',
  'chevron-up': 'M5 15l7-7 7 7',
  back: 'M10 19l-7-7m0 0l7-7m-7 7h18',
  x: 'M6 18L18 6M6 6l12 12',
  add: 'M12 4v16m8-8H4',
  pencil: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  delete: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  'refresh-cw': 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  'washing-machine': 'M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z M6 8h12 M8 5.5h.01 M16 5.5h.01 M12 15a4 4 0 100-8 4 4 0 000 8z',
  orders: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  delivery: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10h10zm0 0h3.586a1 1 0 00.707-.293l2.414-2.414A1 1 0 0020 12.586V10a1 1 0 00-1-1h-6v7z',
  wallet: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  'user-circle': 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a3 3 0 110 6 3 3 0 010-6zm0 14.2a7.2 7.2 0 01-5.2-2.2c.03-1.73 3.47-2.67 5.2-2.67s5.17.94 5.2 2.67a7.2 7.2 0 01-5.2 2.2z',
  cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  check: 'M5 13l4 4L19 7',
  close: 'M6 18L18 6M6 6l12 12',
  location: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  pin: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  card: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  cash: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  lock: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  truck: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10h10zm0 0h3.586a1 1 0 00.707-.293l2.414-2.414A1 1 0 0020 12.586V10a1 1 0 00-1-1h-6v7z',
  facility: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  wash: 'M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z M6 8h12 M8 5.5h.01 M16 5.5h.01 M12 15a4 4 0 100-8 4 4 0 000 8z',
  dry: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  iron: 'M3 15h14a4 4 0 004-4V9a2 2 0 00-2-2H7a4 4 0 00-4 4v4zm0 0v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  fold: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  pack: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  qc: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  package: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  box: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  phone: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  tag: 'M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  'arrow-right': 'M14 5l7 7m0 0l-7 7m7-7H3',
  'arrow-left': 'M10 19l-7-7m0 0l7-7m-7 7h18',
  'arrow-up': 'M5 10l7-7m0 0l7 7m-7-7v18',
  'arrow-down': 'M19 14l-7 7m0 0l-7-7m7 7V3',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-left': 'M15 19l-7-7 7-7',
  shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  sparkles: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  plus: 'M12 4v16m8-8H4',
  minus: 'M20 12H4',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  play: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  pause: 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z',
};

export default function AppIcon({
  name,
  size = 20,
  color = '#111827',
  strokeWidth = 2,
  accessibilityLabel,
}: AppIconProps) {
  const pathD = SVG_PATHS[name] || SVG_PATHS.info;

  if (Platform.OS === 'web') {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel || name}
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'block' }}>
          <path d={pathD} />
        </svg>
      </View>
    );
  }

  // React Native native vector renderer for Android/iOS
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || name}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {renderNativeIcon(name, size, color, strokeWidth)}
    </View>
  );
}

function renderNativeIcon(
  name: IconName,
  size: number,
  color: string,
  strokeWidth: number,
) {
  const sw = Math.max(1, Math.round(strokeWidth));
  const s = size;

  switch (name) {
    case 'check':
      return (
        <View
          style={{
            width: s * 0.45,
            height: s * 0.7,
            borderBottomWidth: sw,
            borderRightWidth: sw,
            borderColor: color,
            transform: [{ rotate: '45deg' }, { translateY: -s * 0.1 }],
          }}
        />
      );

    case 'close':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              position: 'absolute',
              width: s * 0.75,
              height: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
              transform: [{ rotate: '45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: s * 0.75,
              height: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      );

    case 'plus':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              position: 'absolute',
              width: s * 0.75,
              height: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: sw,
              height: s * 0.75,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
        </View>
      );

    case 'minus':
      return (
        <View
          style={{
            width: s * 0.75,
            height: sw,
            backgroundColor: color,
            borderRadius: sw / 2,
          }}
        />
      );

    case 'chevron-right':
      return (
        <View
          style={{
            width: s * 0.38,
            height: s * 0.38,
            borderTopWidth: sw,
            borderRightWidth: sw,
            borderColor: color,
            transform: [{ rotate: '45deg' }, { translateX: -s * 0.06 }],
          }}
        />
      );

    case 'chevron-left':
      return (
        <View
          style={{
            width: s * 0.38,
            height: s * 0.38,
            borderBottomWidth: sw,
            borderLeftWidth: sw,
            borderColor: color,
            transform: [{ rotate: '45deg' }, { translateX: s * 0.06 }],
          }}
        />
      );

    case 'arrow-right':
      return (
        <View style={{ width: s * 0.85, height: s * 0.6, justifyContent: 'center', alignItems: 'flex-end' }}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: s * 0.15,
              height: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View
            style={{
              width: s * 0.35,
              height: s * 0.35,
              borderTopWidth: sw,
              borderRightWidth: sw,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateX: -s * 0.04 }],
            }}
          />
        </View>
      );

    case 'arrow-left':
      return (
        <View style={{ width: s * 0.85, height: s * 0.6, justifyContent: 'center', alignItems: 'flex-start' }}>
          <View
            style={{
              position: 'absolute',
              left: s * 0.15,
              right: 0,
              height: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View
            style={{
              width: s * 0.35,
              height: s * 0.35,
              borderBottomWidth: sw,
              borderLeftWidth: sw,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateX: s * 0.04 }],
            }}
          />
        </View>
      );

    case 'arrow-up':
      return (
        <View style={{ width: s * 0.6, height: s * 0.85, alignItems: 'center', justifyContent: 'flex-start' }}>
          <View
            style={{
              position: 'absolute',
              top: s * 0.15,
              bottom: 0,
              width: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View
            style={{
              width: s * 0.35,
              height: s * 0.35,
              borderTopWidth: sw,
              borderLeftWidth: sw,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateY: s * 0.04 }],
            }}
          />
        </View>
      );

    case 'arrow-down':
      return (
        <View style={{ width: s * 0.6, height: s * 0.85, alignItems: 'center', justifyContent: 'flex-end' }}>
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: s * 0.15,
              width: sw,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View
            style={{
              width: s * 0.35,
              height: s * 0.35,
              borderBottomWidth: sw,
              borderRightWidth: sw,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateY: -s * 0.04 }],
            }}
          />
        </View>
      );

    case 'cart':
      return (
        <View style={{ width: s * 0.85, height: s * 0.8, justifyContent: 'space-between' }}>
          {/* Top handle and basket */}
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ width: s * 0.15, height: sw, backgroundColor: color, marginTop: s * 0.08 }} />
            <View
              style={{
                flex: 1,
                borderLeftWidth: sw,
                borderBottomWidth: sw,
                borderRightWidth: sw,
                borderTopWidth: sw * 0.7,
                borderColor: color,
                borderBottomLeftRadius: 3,
                borderBottomRightRadius: 3,
              }}
            />
          </View>
          {/* Wheels */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: s * 0.12 }}>
            <View style={{ width: s * 0.14, height: s * 0.14, borderRadius: 99, backgroundColor: color }} />
            <View style={{ width: s * 0.14, height: s * 0.14, borderRadius: 99, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'search':
      return (
        <View style={{ width: s * 0.85, height: s * 0.85 }}>
          <View
            style={{
              width: s * 0.58,
              height: s * 0.58,
              borderRadius: 99,
              borderWidth: sw,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: s * 0.04,
              bottom: s * 0.04,
              width: s * 0.35,
              height: sw + 0.5,
              backgroundColor: color,
              borderRadius: sw / 2,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      );

    case 'location':
    case 'pin':
      return (
        <View style={{ width: s * 0.7, height: s * 0.85, alignItems: 'center' }}>
          <View
            style={{
              width: s * 0.55,
              height: s * 0.55,
              borderRadius: s * 0.275,
              borderTopRightRadius: 0,
              borderWidth: sw,
              borderColor: color,
              transform: [{ rotate: '-45deg' }],
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: s * 0.05,
            }}>
            <View
              style={{
                width: s * 0.16,
                height: s * 0.16,
                borderRadius: 99,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );

    case 'calendar':
      return (
        <View
          style={{
            width: s * 0.8,
            height: s * 0.8,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 4,
            paddingTop: s * 0.2,
          }}>
          {/* Header tabs */}
          <View
            style={{
              position: 'absolute',
              top: -s * 0.1,
              left: s * 0.15,
              width: sw,
              height: s * 0.16,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: -s * 0.1,
              right: s * 0.15,
              width: sw,
              height: s * 0.16,
              backgroundColor: color,
            }}
          />
          {/* Calendar top line */}
          <View style={{ height: sw * 0.8, backgroundColor: color, width: '100%' }} />
          {/* Grid dots */}
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', alignItems: 'center', padding: 2 }}>
            <View style={{ width: sw * 1.5, height: sw * 1.5, backgroundColor: color, borderRadius: 1 }} />
            <View style={{ width: sw * 1.5, height: sw * 1.5, backgroundColor: color, borderRadius: 1 }} />
            <View style={{ width: sw * 1.5, height: sw * 1.5, backgroundColor: color, borderRadius: 1 }} />
          </View>
        </View>
      );

    case 'clock':
      return (
        <View
          style={{
            width: s * 0.8,
            height: s * 0.8,
            borderRadius: 99,
            borderWidth: sw,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              position: 'absolute',
              top: s * 0.16,
              width: sw,
              height: s * 0.24,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: s * 0.16,
              height: sw,
              width: s * 0.22,
              backgroundColor: color,
              borderRadius: sw / 2,
            }}
          />
          <View style={{ width: sw * 1.4, height: sw * 1.4, borderRadius: 99, backgroundColor: color }} />
        </View>
      );

    case 'card':
      return (
        <View
          style={{
            width: s * 0.85,
            height: s * 0.62,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 3,
            justifyContent: 'space-between',
            paddingVertical: s * 0.08,
          }}>
          <View style={{ height: s * 0.12, backgroundColor: color, width: '100%' }} />
          <View style={{ flexDirection: 'row', paddingHorizontal: s * 0.08, justifyContent: 'space-between' }}>
            <View style={{ width: s * 0.14, height: s * 0.1, backgroundColor: color, borderRadius: 1 }} />
            <View style={{ width: s * 0.25, height: sw * 0.8, backgroundColor: color, borderRadius: 1 }} />
          </View>
        </View>
      );

    case 'cash':
      return (
        <View
          style={{
            width: s * 0.85,
            height: s * 0.58,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 3,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              width: s * 0.26,
              height: s * 0.26,
              borderRadius: 99,
              borderWidth: sw * 0.8,
              borderColor: color,
            }}
          />
        </View>
      );

    case 'lock':
      return (
        <View style={{ width: s * 0.65, height: s * 0.8, alignItems: 'center' }}>
          {/* Shackle */}
          <View
            style={{
              width: s * 0.42,
              height: s * 0.38,
              borderTopWidth: sw,
              borderLeftWidth: sw,
              borderRightWidth: sw,
              borderColor: color,
              borderTopLeftRadius: s * 0.21,
              borderTopRightRadius: s * 0.21,
            }}
          />
          {/* Body */}
          <View
            style={{
              width: s * 0.65,
              height: s * 0.44,
              borderWidth: sw,
              borderColor: color,
              borderRadius: 3,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: -sw * 0.5,
            }}>
            <View style={{ width: sw * 1.5, height: s * 0.16, backgroundColor: color, borderRadius: 1 }} />
          </View>
        </View>
      );

    case 'truck':
      return (
        <View style={{ width: s * 0.9, height: s * 0.65, justifyContent: 'flex-end' }}>
          {/* Cab & Cargo */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: s * 0.48 }}>
            <View
              style={{
                width: s * 0.52,
                height: s * 0.44,
                borderWidth: sw,
                borderColor: color,
                borderTopLeftRadius: 2,
              }}
            />
            <View
              style={{
                width: s * 0.32,
                height: s * 0.34,
                borderWidth: sw,
                borderColor: color,
                borderTopRightRadius: 6,
                borderLeftWidth: 0,
              }}
            />
          </View>
          {/* Wheels */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: s * 0.1, marginTop: -s * 0.06 }}>
            <View style={{ width: s * 0.16, height: s * 0.16, borderRadius: 99, backgroundColor: color }} />
            <View style={{ width: s * 0.16, height: s * 0.16, borderRadius: 99, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'facility':
      return (
        <View style={{ width: s * 0.8, height: s * 0.8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {/* Building Frame */}
          <View
            style={{
              width: s * 0.75,
              height: s * 0.72,
              borderWidth: sw,
              borderColor: color,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: s * 0.08,
            }}>
            {/* Windows */}
            <View style={{ flexDirection: 'row', gap: s * 0.08 }}>
              <View style={{ width: s * 0.12, height: s * 0.12, backgroundColor: color, borderRadius: 1 }} />
              <View style={{ width: s * 0.12, height: s * 0.12, backgroundColor: color, borderRadius: 1 }} />
            </View>
            {/* Door */}
            <View
              style={{
                width: s * 0.22,
                height: s * 0.24,
                borderTopWidth: sw,
                borderLeftWidth: sw,
                borderRightWidth: sw,
                borderColor: color,
                borderTopLeftRadius: 2,
                borderTopRightRadius: 2,
              }}
            />
          </View>
        </View>
      );

    case 'wash':
      return (
        <View
          style={{
            width: s * 0.78,
            height: s * 0.84,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 4,
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: s * 0.06,
          }}>
          {/* Top knobs */}
          <View style={{ flexDirection: 'row', width: '80%', justifyContent: 'flex-end', gap: 3 }}>
            <View style={{ width: sw * 1.5, height: sw * 1.5, borderRadius: 99, backgroundColor: color }} />
            <View style={{ width: sw * 1.5, height: sw * 1.5, borderRadius: 99, backgroundColor: color }} />
          </View>
          {/* Center Drum */}
          <View
            style={{
              width: s * 0.44,
              height: s * 0.44,
              borderRadius: 99,
              borderWidth: sw,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: s * 0.2,
                height: s * 0.1,
                borderBottomWidth: sw * 0.8,
                borderColor: color,
                borderRadius: 99,
              }}
            />
          </View>
          <View style={{ height: 2 }} />
        </View>
      );

    case 'dry':
      return (
        <View
          style={{
            width: s * 0.78,
            height: s * 0.84,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 4,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              width: s * 0.44,
              height: s * 0.44,
              borderRadius: 99,
              borderWidth: sw,
              borderStyle: 'dashed',
              borderColor: color,
            }}
          />
        </View>
      );

    case 'iron':
      return (
        <View style={{ width: s * 0.85, height: s * 0.65, justifyContent: 'flex-end' }}>
          {/* Handle */}
          <View
            style={{
              width: s * 0.5,
              height: s * 0.2,
              borderTopWidth: sw,
              borderLeftWidth: sw,
              borderColor: color,
              borderTopLeftRadius: 4,
              marginLeft: s * 0.1,
            }}
          />
          {/* Soleplate */}
          <View
            style={{
              width: s * 0.85,
              height: s * 0.32,
              borderWidth: sw,
              borderColor: color,
              borderTopRightRadius: s * 0.2,
              borderBottomLeftRadius: 2,
              borderBottomRightRadius: 2,
            }}
          />
        </View>
      );

    case 'fold':
      return (
        <View style={{ width: s * 0.8, height: s * 0.65, justifyContent: 'space-around' }}>
          <View style={{ height: sw, backgroundColor: color, borderRadius: sw / 2, width: '100%' }} />
          <View style={{ height: sw, backgroundColor: color, borderRadius: sw / 2, width: '85%', alignSelf: 'center' }} />
          <View style={{ height: sw, backgroundColor: color, borderRadius: sw / 2, width: '100%' }} />
        </View>
      );

    case 'pack':
    case 'package':
    case 'box':
      return (
        <View
          style={{
            width: s * 0.75,
            height: s * 0.75,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 3,
            alignItems: 'center',
          }}>
          {/* Center tape band */}
          <View style={{ width: sw, height: '100%', backgroundColor: color }} />
          <View
            style={{
              position: 'absolute',
              top: s * 0.22,
              width: '100%',
              height: sw * 0.8,
              backgroundColor: color,
            }}
          />
        </View>
      );

    case 'qc':
    case 'shield':
      return (
        <View
          style={{
            width: s * 0.72,
            height: s * 0.85,
            borderWidth: sw,
            borderColor: color,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            borderBottomLeftRadius: s * 0.36,
            borderBottomRightRadius: s * 0.36,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {name === 'qc' ? (
            <View
              style={{
                width: s * 0.24,
                height: s * 0.38,
                borderBottomWidth: sw,
                borderRightWidth: sw,
                borderColor: color,
                transform: [{ rotate: '45deg' }, { translateY: -s * 0.04 }],
              }}
            />
          ) : null}
        </View>
      );

    case 'alert':
    case 'warning':
      return (
        <View
          style={{
            width: s * 0.82,
            height: s * 0.82,
            borderRadius: 99,
            borderWidth: sw,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: s * 0.12,
          }}>
          <View style={{ width: sw * 1.2, height: s * 0.3, backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: sw * 1.2, height: sw * 1.2, backgroundColor: color, borderRadius: 99, marginTop: s * 0.08 }} />
        </View>
      );

    case 'user':
      return (
        <View style={{ width: s * 0.75, height: s * 0.8, alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Head */}
          <View
            style={{
              width: s * 0.36,
              height: s * 0.36,
              borderRadius: 99,
              borderWidth: sw,
              borderColor: color,
            }}
          />
          {/* Shoulders */}
          <View
            style={{
              width: s * 0.75,
              height: s * 0.34,
              borderTopLeftRadius: s * 0.375,
              borderTopRightRadius: s * 0.375,
              borderTopWidth: sw,
              borderLeftWidth: sw,
              borderRightWidth: sw,
              borderColor: color,
            }}
          />
        </View>
      );

    case 'users':
      return (
        <View style={{ width: s * 0.85, height: s * 0.8 }}>
          {/* Background user */}
          <View style={{ position: 'absolute', right: 0, top: 0, opacity: 0.75 }}>
            <View style={{ width: s * 0.28, height: s * 0.28, borderRadius: 99, borderWidth: sw * 0.8, borderColor: color }} />
          </View>
          {/* Foreground user */}
          <View style={{ width: s * 0.6, height: s * 0.75, alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ width: s * 0.32, height: s * 0.32, borderRadius: 99, borderWidth: sw, borderColor: color }} />
            <View
              style={{
                width: s * 0.6,
                height: s * 0.3,
                borderTopLeftRadius: s * 0.3,
                borderTopRightRadius: s * 0.3,
                borderTopWidth: sw,
                borderLeftWidth: sw,
                borderRightWidth: sw,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );

    case 'gear':
    case 'settings':
      return (
        <View
          style={{
            width: s * 0.8,
            height: s * 0.8,
            borderRadius: 99,
            borderWidth: sw * 1.2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              position: 'absolute',
              width: s * 0.8,
              height: sw * 1.2,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: sw * 1.2,
              height: s * 0.8,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: s * 0.8,
              height: sw * 1.2,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: '45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: s * 0.8,
              height: sw * 1.2,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: '-45deg' }],
            }}
          />
          {/* Center cutout */}
          <View style={{ width: s * 0.32, height: s * 0.32, borderRadius: 99, backgroundColor: '#FFFFFF', borderWidth: sw * 0.8, borderColor: color }} />
        </View>
      );

    case 'phone':
      return (
        <View
          style={{
            width: s * 0.6,
            height: s * 0.8,
            borderWidth: sw,
            borderColor: color,
            borderRadius: 4,
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: s * 0.06,
          }}>
          <View style={{ width: s * 0.2, height: sw * 0.7, backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: s * 0.12, height: s * 0.12, borderRadius: 99, borderWidth: sw * 0.7, borderColor: color }} />
        </View>
      );

    case 'tag':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: s * 0.6,
              height: s * 0.6,
              borderWidth: sw,
              borderColor: color,
              borderTopLeftRadius: 6,
              alignItems: 'flex-start',
              padding: s * 0.08,
            }}>
            <View style={{ width: s * 0.12, height: s * 0.12, borderRadius: 99, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'info':
      return (
        <View
          style={{
            width: s * 0.8,
            height: s * 0.8,
            borderRadius: 99,
            borderWidth: sw,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View style={{ width: sw * 1.2, height: sw * 1.2, borderRadius: 99, backgroundColor: color, marginBottom: s * 0.06 }} />
          <View style={{ width: sw * 1.2, height: s * 0.28, backgroundColor: color, borderRadius: 1 }} />
        </View>
      );

    case 'refresh':
      return (
        <View
          style={{
            width: s * 0.78,
            height: s * 0.78,
            borderRadius: 99,
            borderWidth: sw,
            borderTopColor: 'transparent',
            borderColor: color,
            transform: [{ rotate: '45deg' }],
            alignItems: 'flex-end',
          }}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: sw * 2,
              borderRightWidth: sw * 2,
              borderBottomWidth: sw * 3,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
              transform: [{ rotate: '90deg' }, { translateX: -sw * 0.5 }],
            }}
          />
        </View>
      );

    case 'sparkles':
      return (
        <View style={{ width: s * 0.85, height: s * 0.85 }}>
          {/* Big diamond */}
          <View
            style={{
              position: 'absolute',
              left: s * 0.1,
              top: s * 0.1,
              width: s * 0.45,
              height: s * 0.45,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }],
              borderRadius: 2,
            }}
          />
          {/* Small diamond */}
          <View
            style={{
              position: 'absolute',
              right: s * 0.05,
              bottom: s * 0.05,
              width: s * 0.25,
              height: s * 0.25,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }],
              borderRadius: 1,
            }}
          />
        </View>
      );

    case 'edit':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, transform: [{ rotate: '45deg' }], alignItems: 'center' }}>
          {/* Pencil body */}
          <View
            style={{
              width: s * 0.24,
              height: s * 0.55,
              borderWidth: sw,
              borderColor: color,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
            }}
          />
          {/* Tip */}
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: s * 0.12,
              borderRightWidth: s * 0.12,
              borderTopWidth: s * 0.18,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: color,
            }}
          />
        </View>
      );

    case 'trash':
      return (
        <View style={{ width: s * 0.75, height: s * 0.85, alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Lid */}
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: s * 0.2, height: sw, backgroundColor: color, borderRadius: 1 }} />
            <View style={{ width: s * 0.75, height: sw, backgroundColor: color, borderRadius: 1, marginTop: 1 }} />
          </View>
          {/* Bin */}
          <View
            style={{
              width: s * 0.6,
              height: s * 0.58,
              borderWidth: sw,
              borderTopWidth: 0,
              borderColor: color,
              borderBottomLeftRadius: 3,
              borderBottomRightRadius: 3,
              flexDirection: 'row',
              justifyContent: 'space-evenly',
              paddingVertical: 2,
            }}>
            <View style={{ width: sw * 0.8, height: '75%', backgroundColor: color }} />
            <View style={{ width: sw * 0.8, height: '75%', backgroundColor: color }} />
          </View>
        </View>
      );

    case 'play':
      return (
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: s * 0.35,
            borderBottomWidth: s * 0.35,
            borderLeftWidth: s * 0.6,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
            marginLeft: s * 0.1,
          }}
        />
      );

    case 'pause':
      return (
        <View style={{ width: s * 0.5, height: s * 0.65, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ width: sw * 1.5, height: '100%', backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: sw * 1.5, height: '100%', backgroundColor: color, borderRadius: 1 }} />
        </View>
      );

    case 'home':
    case 'house':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, alignItems: 'center' }}>
          <View
            style={{
              width: s * 0.52,
              height: s * 0.52,
              borderTopWidth: sw,
              borderLeftWidth: sw,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              marginTop: s * 0.05,
            }}
          />
          <View
            style={{
              width: s * 0.55,
              height: s * 0.45,
              borderWidth: sw,
              borderTopWidth: 0,
              borderColor: color,
              marginTop: -s * 0.22,
            }}
          />
        </View>
      );

    case 'bell':
    case 'notifications':
      return (
        <View style={{ width: s * 0.65, height: s * 0.75, alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: s * 0.15, height: sw, backgroundColor: color, borderRadius: 1 }} />
          <View
            style={{
              width: s * 0.6,
              height: s * 0.52,
              borderWidth: sw,
              borderBottomWidth: 0,
              borderColor: color,
              borderTopLeftRadius: s * 0.3,
              borderTopRightRadius: s * 0.3,
            }}
          />
          <View style={{ width: s * 0.68, height: sw, backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: s * 0.2, height: sw * 1.2, backgroundColor: color, borderRadius: 1 }} />
        </View>
      );

    case 'hanger':
      return (
        <View style={{ width: s * 0.8, height: s * 0.65, alignItems: 'center' }}>
          <View
            style={{
              width: s * 0.2,
              height: s * 0.2,
              borderWidth: sw,
              borderBottomWidth: 0,
              borderRightWidth: 0,
              borderColor: color,
              borderRadius: s * 0.1,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: s * 0.38,
              borderRightWidth: s * 0.38,
              borderBottomWidth: s * 0.35,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: s * 0.22,
              width: 0,
              height: 0,
              borderLeftWidth: s * 0.38 - sw * 1.5,
              borderRightWidth: s * 0.38 - sw * 1.5,
              borderBottomWidth: s * 0.35 - sw * 1.5,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: '#FFF',
            }}
          />
        </View>
      );

    case 'shoe':
      return (
        <View style={{ width: s * 0.8, height: s * 0.45, justifyContent: 'flex-end' }}>
          <View
            style={{
              width: s * 0.78,
              height: s * 0.35,
              borderWidth: sw,
              borderColor: color,
              borderBottomLeftRadius: 4,
              borderBottomRightRadius: 6,
              borderTopRightRadius: 8,
              borderTopLeftRadius: 2,
            }}
          />
        </View>
      );

    case 'bed':
      return (
        <View style={{ width: s * 0.75, height: s * 0.6, justifyContent: 'space-between' }}>
          <View
            style={{
              width: '100%',
              height: s * 0.35,
              borderWidth: sw,
              borderColor: color,
              borderTopLeftRadius: 3,
              borderTopRightRadius: 3,
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ width: sw, height: s * 0.18, backgroundColor: color }} />
            <View style={{ width: sw, height: s * 0.18, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'chart':
    case 'analytics':
      return (
        <View style={{ width: s * 0.7, height: s * 0.7, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 2 }}>
          <View style={{ width: s * 0.15, height: '40%', backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: s * 0.15, height: '90%', backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: s * 0.15, height: '65%', backgroundColor: color, borderRadius: 1 }} />
        </View>
      );

    case 'clipboard-list':
      return (
        <View style={{ width: s * 0.65, height: s * 0.8, borderWidth: sw, borderColor: color, borderRadius: 3, alignItems: 'center', paddingTop: 4 }}>
          <View style={{ width: s * 0.3, height: sw * 1.5, backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: '70%', height: sw, backgroundColor: color, marginTop: 4 }} />
          <View style={{ width: '70%', height: sw, backgroundColor: color, marginTop: 3 }} />
        </View>
      );

    case 'save':
      return (
        <View style={{ width: s * 0.7, height: s * 0.7, borderWidth: sw, borderColor: color, borderRadius: 3, justifyContent: 'space-between', padding: 2 }}>
          <View style={{ width: '60%', height: sw * 2, backgroundColor: color, alignSelf: 'center' }} />
          <View style={{ width: '80%', height: sw * 3, borderWidth: sw, borderColor: color, alignSelf: 'center' }} />
        </View>
      );

    case 'circle-check':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, borderRadius: 99, borderWidth: sw, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: s * 0.22,
              height: s * 0.38,
              borderBottomWidth: sw,
              borderRightWidth: sw,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateY: -s * 0.04 }],
            }}
          />
        </View>
      );

    case 'circle-alert':
      return (
        <View style={{ width: s * 0.75, height: s * 0.75, borderRadius: 99, borderWidth: sw, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: sw, height: s * 0.28, backgroundColor: color, borderRadius: 1 }} />
          <View style={{ width: sw * 1.2, height: sw * 1.2, backgroundColor: color, borderRadius: 99, marginTop: 2 }} />
        </View>
      );

    case 'back':
      return renderNativeIcon('arrow-left', size, color, strokeWidth);

    case 'chevron-down':
      return renderNativeIcon('arrow-down', size, color, strokeWidth);

    case 'chevron-up':
      return renderNativeIcon('arrow-up', size, color, strokeWidth);

    case 'x':
      return renderNativeIcon('close', size, color, strokeWidth);


    case 'add':
      return renderNativeIcon('plus', size, color, strokeWidth);

    case 'pencil':
      return renderNativeIcon('edit', size, color, strokeWidth);

    case 'delete':
      return renderNativeIcon('trash', size, color, strokeWidth);

    case 'refresh-cw':
      return renderNativeIcon('refresh', size, color, strokeWidth);

    case 'building-2':
      return renderNativeIcon('facility', size, color, strokeWidth);

    case 'delivery':
      return renderNativeIcon('truck', size, color, strokeWidth);

    case 'orders':
      return renderNativeIcon('box', size, color, strokeWidth);

    case 'wallet':
      return renderNativeIcon('card', size, color, strokeWidth);

    case 'hand':
    case 'pickup':
      return renderNativeIcon('package', size, color, strokeWidth);

    case 'shield-check':
      return renderNativeIcon('shield', size, color, strokeWidth);

    case 'more-vertical':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'space-around', paddingVertical: s * 0.15 }}>
          <View style={{ width: sw * 1.5, height: sw * 1.5, borderRadius: 99, backgroundColor: color }} />
          <View style={{ width: sw * 1.5, height: sw * 1.5, borderRadius: 99, backgroundColor: color }} />
          <View style={{ width: sw * 1.5, height: sw * 1.5, borderRadius: 99, backgroundColor: color }} />
        </View>
      );

    default:
      return (
        <View
          style={{
            width: s * 0.6,
            height: s * 0.6,
            borderRadius: 99,
            borderWidth: sw,
            borderColor: color,
          }}
        />
      );
  }
}

