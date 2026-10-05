import React from 'react';
import {
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, borderRadius, shadows, spacing } from '../theme/designSystem';

type ClickableCardProps = {
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export default function ClickableCard({
  onPress,
  disabled = false,
  selected = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  children,
}: ClickableCardProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      style={[
        styles.card,
        selected && styles.selected,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}>
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  selected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceElevated,
    ...shadows.md,
  },
  disabled: {
    opacity: 0.6,
  },
});
