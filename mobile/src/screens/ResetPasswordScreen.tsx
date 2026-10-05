import React, { useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PasswordInput from '../components/PasswordInput';
import { resetPassword } from '../services/authApi';

type ResetPasswordScreenProps = {
  accessToken?: string;
  onPasswordResetSuccess: () => void;
  onBackToLogin: () => void;
  onBack: () => void;
  onNavigateToForgotPassword?: () => void;
};

export default function ResetPasswordScreen({
  accessToken = '',
  onPasswordResetSuccess,
  onBackToLogin,
  onBack,
  onNavigateToForgotPassword,
}: ResetPasswordScreenProps) {
  // Resolve error from URL hash or query params (e.g. otp_expired, access_denied)
  const resolveUrlError = (): string => {
    if (typeof window !== 'undefined' && window.location) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const searchParams = new URLSearchParams(window.location.search.replace(/^\?/, ''));

      const errorCode = hashParams.get('error_code') || searchParams.get('error_code') || '';
      const errorDesc = hashParams.get('error_description') || searchParams.get('error_description') || '';
      const error = hashParams.get('error') || searchParams.get('error') || '';

      if (
        errorCode === 'otp_expired' ||
        errorDesc.toLowerCase().includes('expired') ||
        errorDesc.toLowerCase().includes('invalid')
      ) {
        return 'This password reset link is invalid or has expired. Please request a new password reset link.';
      }

      if (errorCode === 'access_denied' || error === 'access_denied') {
        return 'Access was denied. Please request a new password reset link.';
      }

      if (errorCode || error) {
        return errorDesc
          ? decodeURIComponent(errorDesc.replace(/\+/g, ' '))
          : 'Unable to verify reset link. Please request a new password reset link.';
      }
    }
    return '';
  };

  // Resolve recovery access token from props or URL
  const resolveToken = (): string => {
    if (accessToken) return accessToken;
    if (typeof window !== 'undefined' && window.location) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const searchParams = new URLSearchParams(window.location.search.replace(/^\?/, ''));
      return (
        hashParams.get('access_token') ||
        searchParams.get('access_token') ||
        searchParams.get('token') ||
        ''
      );
    }
    return '';
  };

  const initialUrlError = resolveUrlError();
  const initialToken = resolveToken();

  const [token, setToken] = useState<string>(initialToken);
  const [errorMessage, setErrorMessage] = useState<string>(() => {
    if (initialUrlError) return initialUrlError;
    if (typeof window !== 'undefined' && window.location && !initialToken && !accessToken) {
      return 'This password reset link is invalid or has expired. Please request a new password reset link.';
    }
    return '';
  });
  const [isLinkExpired, setIsLinkExpired] = useState<boolean>(() => {
    if (initialUrlError && initialUrlError.includes('invalid or has expired')) return true;
    if (typeof window !== 'undefined' && window.location && !initialToken && !accessToken) return true;
    return false;
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const validate = (): string | null => {
    if (!newPassword) {
      return 'Please enter a new password';
    }
    if (newPassword.length < 6) {
      return 'Password must be at least 6 characters long';
    }
    if (!confirmPassword) {
      return 'Please confirm your new password';
    }
    if (newPassword !== confirmPassword) {
      return 'Passwords do not match';
    }
    return null;
  };

  const handleReset = async () => {
    if (loading) return;
    setErrorMessage('');

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const activeToken = token || accessToken;
    if (!activeToken) {
      setErrorMessage('This password reset link is invalid or has expired. Please request a new password reset link.');
      setIsLinkExpired(true);
      return;
    }

    setLoading(true);
    try {
      await resetPassword(newPassword, activeToken);
      setSuccess(true);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('connection') || msg.includes('network') || msg.includes('Failed to fetch')) {
        setErrorMessage('Unable to connect. Please check your internet connection.');
      } else if (msg.includes('expired') || msg.includes('invalid') || msg.includes('session')) {
        setErrorMessage('This password reset link is invalid or has expired. Please request a new password reset link.');
        setIsLinkExpired(true);
      } else {
        setErrorMessage(msg || 'Unable to update your password right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          style={styles.backButton}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Set New Password</Text>
        <Text style={styles.subtitle}>
          Create a secure password for your Bright & White account
        </Text>

        {errorMessage ? (
          <View style={styles.errorContainer} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isLinkExpired ? (
          <View style={styles.expiredContainer}>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.button}
              onPress={onNavigateToForgotPassword || onBackToLogin}>
              <Text style={styles.buttonText}>Request New Reset Link</Text>
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onBackToLogin}>
                <Text style={styles.footerLink}>Return to Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : success ? (
          <View style={styles.successContainer} accessibilityRole="alert">
            <Text style={styles.successTitle}>Password Updated</Text>
            <Text style={styles.successText}>
              Your password has been successfully updated. You can now sign in with your new password.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => {
                onPasswordResetSuccess();
                onBackToLogin();
              }}>
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <PasswordInput
              placeholder="New Password"
              value={newPassword}
              onChangeText={text => {
                setNewPassword(text);
                if (errorMessage) setErrorMessage('');
              }}
            />

            <PasswordInput
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChangeText={text => {
                setConfirmPassword(text);
                if (errorMessage) setErrorMessage('');
              }}
            />

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleReset}
              disabled={loading}>
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={styles.buttonText}>Updating password...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Update Password</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onBackToLogin}>
                <Text style={styles.footerLink}>Return to Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 30,
    paddingTop: 40,
    paddingBottom: 40,
  },
  backButton: {
    marginBottom: 30,
    alignSelf: 'flex-start',
  },
  back: {
    fontSize: 16,
    color: '#111111',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#555555',
    marginBottom: 28,
  },
  form: {
    width: '100%',
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#FDE8E8',
    borderColor: '#F8B4B4',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  errorText: {
    color: '#9B1C1C',
    fontSize: 14,
    fontWeight: '500',
  },
  expiredContainer: {
    width: '100%',
    marginTop: 10,
  },
  successContainer: {
    backgroundColor: '#DEF7EC',
    borderColor: '#31C48D',
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginTop: 10,
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#03543F',
    marginBottom: 8,
  },
  successText: {
    color: '#03543F',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  secondaryButton: {
    backgroundColor: '#111111',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  footerRow: {
    alignItems: 'center',
    marginTop: 28,
  },
  footerLink: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
  },
});
