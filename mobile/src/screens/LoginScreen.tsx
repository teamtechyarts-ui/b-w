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
import PasswordInput from '../components/PasswordInput';
import { signInCustomer } from '../services/authApi';
import type { AuthSessionResponse } from '../types/session';

type LoginScreenProps = {
  onSessionEstablished: (response: AuthSessionResponse) => void;
  onNavigateToSignUp: () => void;
  onNavigateToForgotPassword: () => void;
  onNavigateToDriverLogin?: () => void;
  onBack: () => void;
};

export default function LoginScreen({
  onSessionEstablished,
  onNavigateToSignUp,
  onNavigateToForgotPassword,
  onNavigateToDriverLogin,
  onBack,
}: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const validate = (): string | null => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      return 'Please enter your email address';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return 'Please enter a valid email address';
    }
    if (!password) {
      return 'Please enter your password';
    }
    return null;
  };

  const handleSignIn = async () => {
    if (loading) return;
    setErrorMessage('');

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await signInCustomer({
        email: email.trim().toLowerCase(),
        password,
      });

      onSessionEstablished(response);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('verify your email')) {
        setErrorMessage('Please verify your email before signing in.');
      } else if (msg.includes('Invalid') || msg.includes('credentials') || msg.includes('password')) {
        setErrorMessage('Invalid email or password.');
      } else if (msg.includes('connection') || msg.includes('network')) {
        setErrorMessage('Unable to connect. Please check your internet connection.');
      } else if (msg) {
        setErrorMessage(msg);
      } else {
        setErrorMessage('Unable to sign in right now. Please try again.');
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

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>
          Sign in to your Bright & White account
        </Text>

        {errorMessage ? (
          <View style={styles.errorContainer} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

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

          <PasswordInput
            placeholder="Password"
            value={password}
            onChangeText={text => {
              setPassword(text);
              if (errorMessage) setErrorMessage('');
            }}
          />

          <View style={styles.forgotRow}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onNavigateToForgotPassword}>
              <Text style={styles.forgotLink}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={loading}>
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.buttonText}>Signing in...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onNavigateToSignUp}>
              <Text style={styles.footerLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {onNavigateToDriverLogin ? (
            <View style={styles.driverRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Staff Login"
                onPress={onNavigateToDriverLogin}
                style={styles.driverButton}>
                <Text style={styles.driverLink}>Staff Login →</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  driverRow: {
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  driverButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  driverLink: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0284C7',
  },
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
  forgotRow: {
    alignItems: 'flex-end',
    marginBottom: 24,
    marginTop: -8,
  },
  forgotLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444444',
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
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },
  footerText: {
    fontSize: 15,
    color: '#666666',
  },
  footerLink: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
});