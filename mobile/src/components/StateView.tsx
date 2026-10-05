import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AppIcon, { IconName } from './AppIcon';
import { colors, typography, spacing, borderRadius } from '../theme/designSystem';

type StateViewProps = {
  type: 'loading' | 'empty' | 'error';
  title?: string;
  message: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
};

export default function StateView({
  type,
  title,
  message,
  icon,
  actionLabel,
  onAction,
  actionDisabled = false,
}: StateViewProps) {
  if (type === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>{message || 'Loading...'}</Text>
      </View>
    );
  }

  const defaultIcon: IconName = type === 'error' ? 'alert' : 'info';
  const iconName = icon || defaultIcon;
  const isError = type === 'error';

  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, isError && styles.errorIconContainer]}>
        <AppIcon
          name={iconName}
          size={24}
          color={isError ? colors.danger : colors.textMuted}
        />
      </View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.message}>{message}</Text>

      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          disabled={actionDisabled}
          style={[styles.actionButton, actionDisabled && styles.buttonDisabled]}
          onPress={onAction}>
          <Text style={styles.actionButtonText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  errorIconContainer: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  title: {
    ...typography.h3,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 20,
  },
  actionButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    ...typography.bodyStrong,
    color: colors.textInverse,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
