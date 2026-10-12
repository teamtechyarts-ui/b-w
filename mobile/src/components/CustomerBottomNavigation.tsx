import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AppIcon, {IconName} from './AppIcon';
import {colors, spacing, typography} from '../theme/designSystem';

export type CustomerTab = 'home' | 'orders' | 'account';

type Props = {
  active: CustomerTab;
  onHome: () => void;
  onOrders: () => void;
  onAccount: () => void;
  onPackages?: () => void;
};

const tabs: {key: CustomerTab; label: string; icon: IconName}[] = [
  {key: 'home', label: 'Home', icon: 'home'},
  {key: 'orders', label: 'Orders', icon: 'box'},
  {key: 'account', label: 'Account', icon: 'user'},
];

export default function CustomerBottomNavigation({
  active,
  onHome,
  onOrders,
  onAccount,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets?.bottom ?? 0;

  const handlers = {
    home: onHome,
    orders: onOrders,
    account: onAccount,
  };

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          paddingBottom: bottomInset,
          height: 60 + bottomInset,
        },
      ]}>
      {tabs.map(tab => {
        const isSelected = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{selected: isSelected}}
            accessibilityLabel={tab.label}
            style={styles.tab}
            onPress={handlers[tab.key]}>
            <AppIcon
              name={tab.icon}
              size={20}
              color={isSelected ? colors.primary : colors.textMuted}
              strokeWidth={isSelected ? 2.5 : 1.75}
            />
            <Text style={[styles.label, isSelected && styles.active]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 60,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 44,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  active: {
    color: colors.primary,
    fontWeight: '800',
  },
});
