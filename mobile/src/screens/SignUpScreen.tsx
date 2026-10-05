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
import IndianMobileInput from '../components/IndianMobileInput';
import { signUpCustomer } from '../services/authApi';
import type { SignUpCustomerResponse } from '../services/authApi';
import { toIndianE164, validateIndianMobile } from '../utils/indianMobile';

type SignUpScreenProps = {
  onSessionEstablished: (response: SignUpCustomerResponse) => void;
  onNavigateToLogin: () => void;
  onBack: () => void;
};

export default function SignUpScreen({
  onSessionEstablished,
  onNavigateToLogin,
  onBack,
}: SignUpScreenProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  const validate = (): string | null => {
    if (!fullName.trim()) {
      return 'Please enter your full name';
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      return 'Please enter a valid email address';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return 'Please enter a valid email address';
    }
    const phoneValidation = validateIndianMobile(phone);
    if (!phoneValidation.isValid) {
      return phoneValidation.error || 'Enter a valid 10-digit Indian mobile number.';
    }
    if (!password) {
      return 'Password is required';
    }
    if (password.length < 6) {
      return 'Password must be at least 6 characters long';
    }
    if (!confirmPassword) {
      return 'Please confirm your password';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match';
    }
    return null;
  };

  const handleSignUp = async () => {
    if (loading) return;
    setErrorMessage('');
    setSuccessNotice('');

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await signUpCustomer({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
        phone: toIndianE164(phone),
      });

      if (response.requiresEmailConfirmation || !response.session) {
        setSuccessNotice(
          response.message ||
            'Account created successfully. Please check your email to verify your account.',
        );
      } else {
        onSessionEstablished(response);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('already exists') || msg.includes('already registered')) {
        setErrorMessage('An account with this email already exists.');
      } else if (msg.includes('connection') || msg.includes('network')) {
        setErrorMessage('Unable to connect. Please check your internet connection.');
      } else if (msg) {
        setErrorMessage(msg);
      } else {
        setErrorMessage('Unable to create your account right now. Please try again.');
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

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>
          Sign up for premium Bright & White laundry care
        </Text>

        {errorMessage ? (
          <View style={styles.errorContainer} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {successNotice ? (
          <View style={styles.successContainer} accessibilityRole="alert">
            <Text style={styles.successText}>{successNotice}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onNavigateToLogin}>
              <Text style={styles.secondaryButtonText}>Go to Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Full Name"
              placeholderTextColor="#888888"
              value={fullName}
              onChangeText={text => {
                setFullName(text);
                if (errorMessage) setErrorMessage('');
              }}
              autoCapitalize="words"
            />

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

            <IndianMobileInput
              label=""
              placeholder="Mobile Number"
              value={phone}
              accessibilityLabel="Mobile Number"
              helperText=""
              onChangeText={(localDigits) => {
                setPhone(localDigits);
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

            <PasswordInput
              placeholder="Confirm Password"
              value={confirmPassword}
              onChangeText={text => {
                setConfirmPassword(text);
                if (errorMessage) setErrorMessage('');
              }}
            />

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignUp}
              disabled={loading}>
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={styles.buttonText}>Creating account...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Sign Up</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onNavigateToLogin}>
                <Text style={styles.footerLink}>Sign In</Text>
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
    paddingTop: 30,
    paddingBottom: 40,
  },
  backButton: {
    marginBottom: 20,
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
    marginBottom: 24,
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
  successContainer: {
    backgroundColor: '#DEF7EC',
    borderColor: '#31C48D',
    borderWidth: 1,
    borderRadius: 12,
    padding: 18,
    marginTop: 10,
    alignItems: 'center',
  },
  successText: {
    color: '#03543F',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 16,
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
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
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
