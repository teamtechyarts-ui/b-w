import React, { useEffect, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandLogo from '../components/BrandLogo';
import PasswordInput from '../components/PasswordInput';
import IndianMobileInput from '../components/IndianMobileInput';
import { ActionError, FieldError } from '../components/FormError';
import {
  resendEmailOtp,
  signInCustomer,
  signUpCustomer,
  verifyEmailOtp,
} from '../services/authApi';
import type { SignUpCustomerResponse } from '../services/authApi';
import { toIndianE164, validateIndianMobile } from '../utils/indianMobile';
import TermsAndConditionsModal from '../components/TermsAndConditionsModal';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';


type Step = 'FORM' | 'VERIFY_OTP' | 'SUCCESS';

type SignUpScreenProps = {
  onSessionEstablished: (response: SignUpCustomerResponse) => void;
  onNavigateToLogin: () => void;
  onNavigateToPrivacyPolicy?: () => void;
  onBack: () => void;
};

export default function SignUpScreen({
  onSessionEstablished,
  onNavigateToLogin,
  onNavigateToPrivacyPolicy,
  onBack,
}: SignUpScreenProps) {
  const [step, setStep] = useState<Step>('FORM');
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Registration form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Verification OTP state
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);

  // Common UI states
  const [loading, setLoading] = useState(false);
  const [fullNameError, setFullNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [actionError, setActionError] = useState('');
  const [infoBanner, setInfoBanner] = useState('');

  const fullNameInputRef = useRef<any>(null);
  const emailInputRef = useRef<any>(null);
  const passwordInputRef = useRef<any>(null);
  const confirmPasswordInputRef = useRef<any>(null);
  const otpInputRef = useRef<any>(null);

  // 60-second cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const clearErrors = () => {
    setFullNameError('');
    setEmailError('');
    setPhoneError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setOtpError('');
    setActionError('');
  };

  const maskEmail = (raw: string) => {
    const parts = raw.trim().toLowerCase().split('@');
    if (parts.length !== 2) return raw;
    const user = parts[0];
    const maskedUser =
      user.length <= 2 ? `${user[0]}*` : `${user.slice(0, 2)}***${user.slice(-1)}`;
    return `${maskedUser}@${parts[1]}`;
  };

  const handleSignUp = async () => {
    if (loading) return;
    clearErrors();
    setInfoBanner('');

    if (!fullName.trim()) {
      setFullNameError('Please enter your full name');
      fullNameInputRef.current?.focus();
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setEmailError('Please enter a valid email address');
      emailInputRef.current?.focus();
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setEmailError('Please enter a valid email address');
      emailInputRef.current?.focus();
      return;
    }
    const phoneValidation = validateIndianMobile(phone);
    if (!phoneValidation.isValid) {
      setPhoneError(phoneValidation.error || 'Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!password) {
      setPasswordError('Password is required');
      passwordInputRef.current?.focus();
      return;
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters long');
      passwordInputRef.current?.focus();
      return;
    }
    if (!confirmPassword) {
      setConfirmPasswordError('Please confirm your password');
      confirmPasswordInputRef.current?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      confirmPasswordInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const response = await signUpCustomer({
        email: cleanEmail,
        password,
        fullName: fullName.trim(),
        phone: toIndianE164(phone),
      });

      if (response.requiresEmailConfirmation || !response.session) {
        const msg =
          response.message ||
          'Account created successfully. Please check your email to verify your account.';
        setInfoBanner(msg);
        setResendCooldown(60);
        setStep('VERIFY_OTP');
      } else {
        onSessionEstablished(response);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('already exists') || msg.includes('already registered')) {
        setActionError('An account with this email already exists.');
      } else if (msg.includes('connection') || msg.includes('network')) {
        setActionError('Unable to connect. Please check your internet connection.');
      } else if (msg) {
        setActionError(msg);
      } else {
        setActionError('Unable to create your account right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (verifyingOtp) return;
    clearErrors();

    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setOtpError('Please enter the 6-digit code');
      otpInputRef.current?.focus();
      return;
    }
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      setOtpError('Code must be exactly 6 digits');
      otpInputRef.current?.focus();
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    setVerifyingOtp(true);
    try {
      const result = await verifyEmailOtp(cleanEmail, cleanOtp);

      if (result.verified) {
        // Attempt automatic sign-in if password is available
        if (password) {
          try {
            const loginSession = await signInCustomer({
              email: cleanEmail,
              password,
            });
            if (loginSession.session) {
              onSessionEstablished(loginSession);
              return;
            }
          } catch {
            // Fall back to manual sign-in screen
          }
        }
        setStep('SUCCESS');
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('expired')) {
        setOtpError('Verification code has expired. Please request a new one.');
      } else if (msg.includes('attempts')) {
        setOtpError('Too many failed attempts. Please request a new verification code.');
      } else if (msg.includes('Invalid') || msg.includes('code')) {
        setOtpError('Invalid verification code. Please check and try again.');
      } else {
        setActionError(msg || 'Unable to verify email right now. Please try again.');
      }
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendingOtp || resendCooldown > 0) return;
    clearErrors();

    const cleanEmail = email.trim().toLowerCase();
    setResendingOtp(true);
    try {
      await resendEmailOtp(cleanEmail);
      setResendCooldown(60);
      setInfoBanner('A new verification code has been sent to your email.');
    } catch (err: any) {
      const msg = err?.message || '';
      setActionError(msg || 'Unable to resend verification code right now.');
    } finally {
      setResendingOtp(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {step !== 'SUCCESS' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={step === 'VERIFY_OTP' ? () => setStep('FORM') : onBack}
            style={styles.backButton}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        )}

        <BrandLogo width={160} containerStyle={styles.logoContainer} />

        {/* STEP 1: REGISTRATION FORM */}
        {step === 'FORM' && (
          <View style={styles.contentWrapper}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Sign up for premium Bright & White laundry care
            </Text>

            <View style={styles.form}>
              <TextInput
                ref={fullNameInputRef}
                style={[styles.input, fullNameError ? styles.inputError : null]}
                placeholder="Full Name"
                placeholderTextColor="#888888"
                value={fullName}
                onChangeText={(text) => {
                  setFullName(text);
                  if (fullNameError) setFullNameError('');
                  if (actionError) setActionError('');
                }}
                autoCapitalize="words"
              />
              <FieldError error={fullNameError} />

              <TextInput
                ref={emailInputRef}
                style={[styles.input, emailError ? styles.inputError : null]}
                placeholder="Email"
                placeholderTextColor="#888888"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (emailError) setEmailError('');
                  if (actionError) setActionError('');
                }}
              />
              <FieldError error={emailError} />

              <IndianMobileInput
                label=""
                placeholder="Mobile Number"
                value={phone}
                error={phoneError}
                accessibilityLabel="Mobile Number"
                helperText=""
                onChangeText={(localDigits) => {
                  setPhone(localDigits);
                  if (phoneError) setPhoneError('');
                  if (actionError) setActionError('');
                }}
              />

              <PasswordInput
                placeholder="Password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (passwordError) setPasswordError('');
                  if (actionError) setActionError('');
                }}
              />
              <FieldError error={passwordError} />

              <PasswordInput
                placeholder="Confirm Password"
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (confirmPasswordError) setConfirmPasswordError('');
                  if (actionError) setActionError('');
                }}
              />
              <FieldError error={confirmPasswordError} />

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
              <ActionError error={actionError} />

              <View style={styles.termsRow}>
                <Text style={styles.termsText}>
                  By signing up, you agree to our{' '}
                  <Text
                    style={styles.termsLink}
                    accessibilityRole="link"
                    accessibilityLabel="Terms and Conditions"
                    onPress={() => setShowTerms(true)}>
                    Terms & Conditions
                  </Text>
                  {' and '}
                  <Text
                    style={styles.termsLink}
                    accessibilityRole="link"
                    accessibilityLabel="Privacy Policy"
                    onPress={() =>
                      onNavigateToPrivacyPolicy
                        ? onNavigateToPrivacyPolicy()
                        : setShowPrivacy(true)
                    }>
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </View>

              <View style={styles.footerRow}>
                <Text style={styles.footerText}>Already have an account? </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={onNavigateToLogin}>
                  <Text style={styles.footerLink}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* STEP 2: EMAIL VERIFICATION OTP */}
        {step === 'VERIFY_OTP' && (
          <View style={styles.contentWrapper}>
            <Text style={styles.title}>Verify Your Email</Text>
            <Text style={styles.subtitle}>
              A 6-digit verification code was sent to {maskEmail(email)}.
            </Text>

            {infoBanner ? (
              <View style={styles.bannerContainer} accessibilityRole="alert">
                <Text style={styles.bannerText}>{infoBanner}</Text>
              </View>
            ) : null}

            <Text style={styles.expiryNotice}>
              The verification code will expire in 10 minutes.
            </Text>

            <View style={styles.form}>
              <TextInput
                ref={otpInputRef}
                style={[styles.otpInput, otpError ? styles.inputError : null]}
                placeholder="000000"
                placeholderTextColor="#AAAAAA"
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(text) => {
                  const cleaned = text.replace(/\D/g, '').slice(0, 6);
                  setOtp(cleaned);
                  if (otpError) setOtpError('');
                  if (actionError) setActionError('');
                }}
                autoFocus={true}
              />
              <FieldError error={otpError} />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Verify Email"
                style={[
                  styles.button,
                  (verifyingOtp || otp.trim().length !== 6) && styles.buttonDisabled,
                ]}
                onPress={handleVerifyOtp}
                disabled={verifyingOtp || otp.trim().length !== 6}>
                {verifyingOtp ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.buttonText}>Verifying...</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Verify Email</Text>
                )}
              </TouchableOpacity>
              <ActionError error={actionError} />

              <View style={styles.resendRow}>
                <Text style={styles.resendHint}>Didn't receive the code? </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={handleResendOtp}
                  disabled={resendingOtp || resendCooldown > 0}>
                  <Text
                    style={[
                      styles.resendLink,
                      (resendingOtp || resendCooldown > 0) && styles.linkDisabled,
                    ]}>
                    {resendingOtp
                      ? 'Resending...'
                      : resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : 'Resend Code'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.footerRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={onNavigateToLogin}>
                  <Text style={styles.footerLink}>Go to Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* STEP 3: VERIFICATION SUCCESS */}
        {step === 'SUCCESS' && (
          <View style={styles.contentWrapper}>
            <View style={styles.successContainer} accessibilityRole="alert">
              <Text style={styles.successTitle}>Email Verified Successfully</Text>
              <Text style={styles.successText}>
                Your email address has been verified. You can now access your Bright & White account.
              </Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={onNavigateToLogin}>
                <Text style={styles.secondaryButtonText}>Go to Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
      <TermsAndConditionsModal visible={showTerms} onClose={() => setShowTerms(false)} />
      <PrivacyPolicyModal visible={showPrivacy} onClose={() => setShowPrivacy(false)} />
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
  contentWrapper: {
    width: '100%',
  },
  backButton: {
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  logoContainer: {
    marginBottom: 20,
    alignSelf: 'center',
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
    marginBottom: 20,
    lineHeight: 22,
  },
  expiryNotice: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  bannerContainer: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  bannerText: {
    color: '#1E40AF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
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
  otpInput: {
    borderWidth: 1.5,
    borderColor: '#0284C7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
    color: '#111111',
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#C53030',
    backgroundColor: '#FFF5F5',
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
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  resendHint: {
    fontSize: 14,
    color: '#666666',
  },
  resendLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0284C7',
  },
  linkDisabled: {
    color: '#999999',
    fontWeight: '500',
  },
  successContainer: {
    backgroundColor: '#DEF7EC',
    borderColor: '#31C48D',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    marginTop: 10,
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#03543F',
    marginBottom: 10,
    textAlign: 'center',
  },
  successText: {
    color: '#03543F',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 20,
  },
  secondaryButton: {
    backgroundColor: '#111111',
    paddingVertical: 12,
    paddingHorizontal: 28,
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
  termsRow: {
    marginTop: 14,
    marginBottom: 4,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  termsText: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: '#111111',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
