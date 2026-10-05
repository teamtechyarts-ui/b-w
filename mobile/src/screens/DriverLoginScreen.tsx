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
import IndianMobileInput from '../components/IndianMobileInput';
import { signInStaffPin } from '../services/authApi';
import type { AuthSessionResponse } from '../types/session';
import { toIndianE164, validateIndianMobile } from '../utils/indianMobile';

type DriverLoginScreenProps = {
  onSessionEstablished: (response: AuthSessionResponse) => void;
  onNavigateToCustomerLogin: () => void;
  onBack?: () => void;
};

export default function DriverLoginScreen({
  onSessionEstablished,
  onNavigateToCustomerLogin,
  onBack,
}: DriverLoginScreenProps) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const validate = (): string | null => {
    const phoneValidation = validateIndianMobile(phone);
    if (!phoneValidation.isValid) {
      return phoneValidation.error || 'Enter a valid 10-digit Indian mobile number.';
    }
    if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      return 'Please enter your 6-digit PIN';
    }
    return null;
  };

  const handleDriverLogin = async () => {
    if (loading) return;
    setErrorMessage('');

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await signInStaffPin({
        phone: toIndianE164(phone),
        pin: pin.trim(),
      });

      onSessionEstablished(response);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('connection') || msg.includes('network')) {
        setErrorMessage('Unable to connect. Please check your internet connection.');
      } else if (msg) {
        setErrorMessage(msg);
      } else {
        setErrorMessage('Incorrect mobile number or PIN.');
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
        {onBack ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={styles.backButton}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.header}>
          <Text style={styles.brandTitle}>Bright & White</Text>
          <Text style={styles.title}>Staff Login</Text>
          <Text style={styles.subtitle}>
            Sign in to your Bright & White staff account
          </Text>
        </View>

        {errorMessage ? (
          <View style={styles.errorContainer} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <IndianMobileInput
            label="Mobile Number"
            accessibilityLabel="Mobile number"
            placeholder="9876543210"
            value={phone}
            helperText="Enter 10-digit Indian mobile number. +91 is added automatically."
            onChangeText={(localDigits) => {
              setPhone(localDigits);
              if (errorMessage) setErrorMessage('');
            }}
          />

          <Text style={styles.label}>6-Digit PIN</Text>
          <TextInput
            accessibilityLabel="6-Digit PIN"
            style={[styles.input, styles.pinInput]}
            placeholder="••••••"
            placeholderTextColor="#888888"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={pin}
            onChangeText={text => {
              // Only allow numeric input
              const cleaned = text.replace(/\D/g, '').slice(0, 6);
              setPin(cleaned);
              if (errorMessage) setErrorMessage('');
            }}
          />

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Sign in to staff account"
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleDriverLogin}
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
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onNavigateToCustomerLogin}
              style={styles.switchButton}>
              <Text style={styles.footerLink}>Customer / Admin Login →</Text>
            </TouchableOpacity>
          </View>
        </View>
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
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  back: {
    fontSize: 16,
    color: '#111111',
  },
  header: {
    marginBottom: 28,
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0284C7',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#555555',
    lineHeight: 22,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111111',
    marginBottom: 20,
    backgroundColor: '#F9FAFB',
  },
  pinInput: {
    letterSpacing: 6,
    fontSize: 20,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    marginTop: 8,
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
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 32,
  },
  switchButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  footerLink: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0284C7',
  },
});
