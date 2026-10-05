import React, { useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { requestPasswordReset } from '../services/authApi';

type ForgotPasswordScreenProps = {
  onBackToLogin: () => void;
  onBack: () => void;
};

export default function ForgotPasswordScreen({
  onBackToLogin,
  onBack,
}: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sentNotice, setSentNotice] = useState(false);

  const validate = (): string | null => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      return 'Please enter your email address';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return 'Please enter a valid email address';
    }
    return null;
  };

  const handleResetRequest = async () => {
    if (loading) return;
    setErrorMessage('');

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setLoading(true);
    try {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost:5173';
      const redirectTo = `${origin}/auth/reset-password`;
      await requestPasswordReset(email.trim().toLowerCase(), redirectTo);
      setSentNotice(true);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('connection') || msg.includes('network')) {
        setErrorMessage('Unable to connect. Please check your internet connection.');
      } else {
        setErrorMessage('Unable to process your request. Please try again.');
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

        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          Enter your registered email address and we will send you instructions to reset your password.
        </Text>

        {errorMessage ? (
          <View style={styles.errorContainer} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {sentNotice ? (
          <View style={styles.successContainer} accessibilityRole="alert">
            <Text style={styles.successTitle}>Check Your Email</Text>
            <Text style={styles.successText}>
              If an account exists for {email.trim().toLowerCase()}, password reset instructions have been sent.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={onBackToLogin}>
              <Text style={styles.secondaryButtonText}>Return to Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#888888"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={text => {
                setEmail(text);
                if (errorMessage) setErrorMessage('');
              }}
            />

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleResetRequest}
              disabled={loading}>
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={styles.buttonText}>Sending instructions...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onBackToLogin}>
                <Text style={styles.footerLink}>Remembered your password? Sign In</Text>
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
  input: {
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 17,
    color: '#111111',
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
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
