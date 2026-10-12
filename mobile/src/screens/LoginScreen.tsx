import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import BrandLogo from '../components/BrandLogo';
import PasswordInput from '../components/PasswordInput';
import { ActionError, FieldError } from '../components/FormError';
import { signInCustomer } from '../services/authApi';
import type { AuthSessionResponse } from '../types/session';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';

type LoginScreenProps = {
  onSessionEstablished: (response: AuthSessionResponse) => void;
  onNavigateToSignUp: () => void;
  onNavigateToForgotPassword: () => void;
  onNavigateToDriverLogin?: () => void;
  onNavigateToPrivacyPolicy?: () => void;
  onBack: () => void;
};

export default function LoginScreen({
  onSessionEstablished,
  onNavigateToSignUp,
  onNavigateToForgotPassword,
  onNavigateToDriverLogin,
  onNavigateToPrivacyPolicy,
  onBack,
}: LoginScreenProps) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [actionError, setActionError] = useState('');

  const emailInputRef = useRef<any>(null);
  const passwordInputRef = useRef<any>(null);

  const clearErrors = () => {
    setEmailError('');
    setPasswordError('');
    setActionError('');
  };

  const handleSignIn = async () => {
    if (loading) return;
    clearErrors();

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setEmailError('Please enter your email address');
      emailInputRef.current?.focus();
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setEmailError('Please enter a valid email address');
      emailInputRef.current?.focus();
      return;
    }
    if (!password) {
      setPasswordError('Please enter your password');
      passwordInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const response = await signInCustomer({
        email: cleanEmail,
        password,
      });

      onSessionEstablished(response);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('verify your email')) {
        setActionError('Please verify your email before signing in.');
      } else if (msg.includes('Invalid') || msg.includes('credentials') || msg.includes('password')) {
        setActionError('Invalid email or password.');
      } else if (msg.includes('connection') || msg.includes('network')) {
        setActionError('Unable to connect. Please check your internet connection.');
      } else if (msg) {
        setActionError(msg);
      } else {
        setActionError('Unable to sign in right now. Please try again.');
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

        <BrandLogo width={160} containerStyle={styles.logoContainer} />

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>
          Sign in to your Bright & White account
        </Text>

        <View style={styles.form}>
          <TextInput
            ref={emailInputRef}
            style={[styles.input, emailError ? styles.inputError : null]}
            placeholder="Email"
            placeholderTextColor="#888888"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={text => {
              setEmail(text);
              if (emailError) setEmailError('');
              if (actionError) setActionError('');
            }}
          />
          <FieldError error={emailError} />

          <PasswordInput
            placeholder="Password"
            value={password}
            onChangeText={text => {
              setPassword(text);
              if (passwordError) setPasswordError('');
              if (actionError) setActionError('');
            }}
          />
          <FieldError error={passwordError} />

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
          <ActionError error={actionError} />

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

          <View style={styles.privacyRow}>
            <TouchableOpacity
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
              onPress={() =>
                onNavigateToPrivacyPolicy
                  ? onNavigateToPrivacyPolicy()
                  : setShowPrivacy(true)
              }
              style={styles.privacyButton}>
              <Text style={styles.privacyLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      <PrivacyPolicyModal
        visible={showPrivacy}
        onClose={() => setShowPrivacy(false)}
      />
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
  privacyRow: {
    alignItems: 'center',
    marginTop: 16,
  },
  privacyButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  privacyLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textDecorationLine: 'underline',
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
  logoContainer: {
    marginBottom: 20,
    alignSelf: 'center',
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
  inputError: {
    borderColor: '#C53030',
    backgroundColor: '#FFF5F5',
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