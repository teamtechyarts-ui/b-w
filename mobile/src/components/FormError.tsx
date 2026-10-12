import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import AppIcon from './AppIcon';
import { colors, typography, spacing, borderRadius } from '../theme/designSystem';

export type FieldErrorProps = {
  error?: string | null;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
};

/**
 * Renders a localized validation error directly below an input field.
 */
export function FieldError({
  error,
  style,
  containerStyle,
  testID,
  accessibilityLabel,
}: FieldErrorProps) {
  if (!error || !error.trim()) return null;

  return (
    <View
      testID={testID}
      style={[styles.fieldContainer, containerStyle]}
      accessibilityRole="alert"
      accessibilityLabel={accessibilityLabel || error}>
      <AppIcon name="alert" size={13} color={colors.danger} />
      <Text style={[styles.fieldErrorText, style]}>{error.trim()}</Text>
    </View>
  );
}

export type ActionErrorProps = {
  error?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * Renders a localized action error directly near an action button (above or below).
 */
export function ActionError({
  error,
  onRetry,
  retryLabel = 'Retry',
  style,
  textStyle,
  testID,
}: ActionErrorProps) {
  if (!error || !error.trim()) return null;

  return (
    <View
      testID={testID}
      style={[styles.actionContainer, style]}
      accessibilityRole="alert">
      <View style={styles.actionHeader}>
        <AppIcon name="alert" size={15} color={colors.danger} />
        <Text style={[styles.actionErrorText, textStyle]}>{error.trim()}</Text>
      </View>
      {onRetry ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          style={styles.retryButton}>
          <Text style={styles.retryText}>{retryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export type SectionErrorProps = {
  error?: string | null;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Renders a localized error card inside a specific section or card when data loading fails.
 */
export function SectionError({
  error,
  title,
  onRetry,
  retryLabel = 'Retry',
  style,
  testID,
}: SectionErrorProps) {
  if (!error || !error.trim()) return null;

  return (
    <View
      testID={testID}
      style={[styles.sectionContainer, style]}
      accessibilityRole="alert">
      <View style={styles.sectionIconCircle}>
        <AppIcon name="alert" size={18} color={colors.danger} />
      </View>
      <View style={styles.sectionTextContainer}>
        {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
        <Text style={styles.sectionMessage}>{error.trim()}</Text>
        {onRetry ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            onPress={onRetry}
            style={styles.sectionRetryBtn}>
            <Text style={styles.sectionRetryText}>{retryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: 2,
  },
  fieldErrorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  actionContainer: {
    backgroundColor: '#FDF2F2',
    borderColor: '#F8D7DA',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginVertical: spacing.sm,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  actionErrorText: {
    ...typography.small,
    color: colors.danger,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  retryText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  sectionContainer: {
    backgroundColor: '#FDF2F2',
    borderColor: '#F8D7DA',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  sectionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FDE8E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTextContainer: {
    flex: 1,
  },
  sectionTitle: {
    ...typography.small,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 2,
  },
  sectionMessage: {
    ...typography.caption,
    color: '#7F1D1D',
    lineHeight: 16,
  },
  sectionRetryBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: '#F8D7DA',
  },
  sectionRetryText: {
    ...typography.caption,
    color: '#991B1B',
    fontWeight: '700',
  },
});
