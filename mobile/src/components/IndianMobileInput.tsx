import React, { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { borderRadius, colors, spacing, typography } from '../theme/designSystem';
import { normalizeIndianMobile, toIndianE164 } from '../utils/indianMobile';

export type IndianMobileInputProps = {
  value: string;
  onChangeText: (local10Digits: string, e164: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
  placeholder?: string;
  onBlur?: () => void;
  onFocus?: () => void;
  testID?: string;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType' | 'maxLength'>;

export default function IndianMobileInput({
  value,
  onChangeText,
  label = 'Mobile Number',
  required = false,
  error,
  helperText = 'Enter 10-digit Indian mobile number. +91 is added automatically.',
  disabled = false,
  accessibilityLabel = 'Mobile number',
  containerStyle,
  placeholder = '9876543210',
  onBlur,
  onFocus,
  testID,
  style: inputOverrideStyle,
  ...restProps
}: IndianMobileInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  // Normalize whatever input is given (whether E.164 or raw 10 digits)
  const localDigits = normalizeIndianMobile(value);

  const handleChangeText = (text: string) => {
    const cleaned = normalizeIndianMobile(text);
    const e164 = toIndianE164(cleaned);
    onChangeText(cleaned, e164);
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label} {required ? <Text style={styles.requiredAsterisk}>*</Text> : null}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputContainer,
          isFocused && styles.inputContainerFocused,
          error ? styles.inputContainerError : null,
          disabled && styles.inputContainerDisabled,
        ]}>
        {/* Fixed +91 Country Code Badge */}
        <View
          style={styles.prefixContainer}
          accessibilityRole="text"
          accessibilityLabel="Country code India plus nine one">
          <Text style={styles.prefixText}>+91</Text>
        </View>

        <View style={styles.prefixDivider} />

        {/* 10-Digit Editable Input */}
        <TextInput
          {...restProps}
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          keyboardType="number-pad"
          maxLength={10}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted || '#9CA3AF'}
          value={localDigits}
          onChangeText={handleChangeText}
          onFocus={e => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={e => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.textInput,
            disabled && styles.textInputDisabled,
            inputOverrideStyle,
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
      </View>

      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: spacing.md || 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary || '#111827',
    marginBottom: spacing.xs || 6,
  },
  requiredAsterisk: {
    color: colors.danger || '#EF4444',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border || '#D1D5DB',
    borderRadius: borderRadius.md || 10,
    backgroundColor: colors.surface || '#FFFFFF',
    minHeight: 48,
    overflow: 'hidden',
  },
  inputContainerFocused: {
    borderColor: colors.primary || '#111827',
  },
  inputContainerError: {
    borderColor: colors.danger || '#EF4444',
  },
  inputContainerDisabled: {
    backgroundColor: colors.surfaceSubtle || '#F3F4F6',
    borderColor: colors.border || '#E5E7EB',
  },
  prefixContainer: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle || '#F9FAFB',
    height: '100%',
    minHeight: 48,
  },
  prefixText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary || '#111827',
    letterSpacing: 0.5,
  },
  prefixDivider: {
    width: 1,
    height: '60%',
    backgroundColor: colors.border || '#E5E7EB',
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary || '#111827',
    letterSpacing: 1,
    height: '100%',
    minHeight: 48,
  },
  textInputDisabled: {
    color: colors.textMuted || '#9CA3AF',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.danger || '#EF4444',
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
    color: colors.textMuted || '#6B7280',
    marginTop: 4,
  },
});
