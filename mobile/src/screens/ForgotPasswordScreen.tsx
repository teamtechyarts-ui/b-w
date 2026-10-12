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
import { ActionError, FieldError } from '../components/FormError';
import PasswordInput from '../components/PasswordInput';
import {
  confirmPasswordReset,
  requestPasswordReset,
  verifyPasswordResetOtp,
} from '../services/authApi';

type Step = 'EMAIL' | 'OTP' | 'PASSWORD' | 'SUCCESS';

type ForgotPasswordScreenProps = {
  onBackToLogin: () => void;
  onBack: () => void;
};

export default function ForgotPasswordScreen({
  onBackToLogin,
  onBack,
}: ForgotPasswordScreenProps) {
  const [step, setStep] = useState<Step>('EMAIL');

  // Step 1: Email
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  // Step 2: OTP
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resetToken, setResetToken] = useState('');

  // Step 3: Passwords
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  // Common UI states
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const emailInputRef = useRef<any>(null);
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
    setEmailError('');
    setOtpError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setActionError('');
  };

  // Helper to mask email for security guidance
  const maskEmail = (raw: string) => {
    const parts = raw.trim().toLowerCase().split('@');
    if (parts.length !== 2) return raw;
    const user = parts[0];
    const maskedUser =
      user.length <= 2 ? `${user[0]}*` : `${user.slice(0, 2)}***${user.slice(-1)}`;
    return `${maskedUser}@${parts[1]}`;
  };

  // Step 1 Handler: Request OTP
  const handleRequestOtp = async () => {
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

    setLoading(true);
    try {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost:5173';
      const redirectTo = `${origin}/auth/reset-password`;

      await requestPasswordReset(cleanEmail, redirectTo);
      setResendCooldown(60);
      setStep('OTP');
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('wait') || msg.includes('cooldown') || msg.includes('seconds')) {
        setActionError(msg);
      } else if (msg.includes('connection') || msg.includes('network')) {
        setActionError('Unable to connect. Please check your internet connection.');
      } else {
        setActionError('Unable to send verification code. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 2 Handler: Resend OTP
  const handleResendOtp = async () => {
    if (loading || resendCooldown > 0) return;
    clearErrors();

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      await requestPasswordReset(cleanEmail);
      setResendCooldown(60);
    } catch (err: any) {
      const msg = err?.message || '';
      setActionError(msg || 'Unable to resend verification code right now.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 Handler: Verify OTP
  const handleVerifyOtp = async () => {
    if (loading) return;
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

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await verifyPasswordResetOtp(cleanEmail, cleanOtp);
      setResetToken(res.resetToken);
      setStep('PASSWORD');
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('expired')) {
        setOtpError('This verification code has expired. Please request a new one.');
      } else if (msg.includes('attempts')) {
        setOtpError('Too many failed attempts. Please request a new code.');
      } else {
        setOtpError('Invalid verification code. Please check and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 3 Handler: Set New Password
  const handleResetPassword = async () => {
    if (loading) return;
    clearErrors();

    if (!newPassword) {
      setPasswordError('Please enter a new password');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long');
      return;
    }
    if (!confirmPassword) {
      setConfirmPasswordError('Please confirm your new password');
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset({
        resetToken,
        newPassword,
        confirmPassword,
      });
      setStep('SUCCESS');
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('expired') || msg.includes('used')) {
        setActionError('Your reset session has expired. Please start over.');
      } else {
        setActionError(msg || 'Unable to reset password. Please try again.');
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
        {step !== 'SUCCESS' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => {
              if (step === 'PASSWORD') setStep('OTP');
              else if (step === 'OTP') setStep('EMAIL');
              else onBack();
            }}
            style={styles.backButton}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        )}

        <BrandLogo width={160} containerStyle={styles.logoContainer} />

        {/* STEP 1: ENTER EMAIL */}
        {step === 'EMAIL' && (
          <View style={styles.contentWrapper}>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your registered email address and we will send you a 6-digit verification code to reset your password.
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
                onChangeText={(text) => {
                  setEmail(text);
                  if (emailError) setEmailError('');
                  if (actionError) setActionError('');
                }}
              />
              <FieldError error={emailError} />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Send Reset Link"
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleRequestOtp}
                disabled={loading}>
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.buttonText}>Sending code...</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Send Reset Link</Text>
                )}
              </TouchableOpacity>
              <ActionError error={actionError} />

              <View style={styles.footerRow}>
                <TouchableOpacity accessibilityRole="button" onPress={onBackToLogin}>
                  <Text style={styles.footerLink}>Remembered your password? Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* STEP 2: VERIFY OTP */}
        {step === 'OTP' && (
          <View style={styles.contentWrapper}>
            <View style={styles.bannerContainer} accessibilityRole="alert">
              <Text style={styles.bannerTitle}>Check Your Email</Text>
              <Text style={styles.bannerText}>
                If an account exists for {maskEmail(email)}, a 6-digit verification code has been sent.
              </Text>
            </View>

            <Text style={styles.title}>Enter Verification Code</Text>
            <Text style={styles.subtitle}>
              Please enter the 6-digit code sent to your email. The code expires in 10 minutes.
            </Text>

            <View style={styles.form}>
              <TextInput
                ref={otpInputRef}
                style={[styles.otpInput, otpError ? styles.inputError : null]}
                placeholder="123456"
                placeholderTextColor="#AAAAAA"
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(text) => {
                  setOtp(text.replace(/\D/g, ''));
                  if (otpError) setOtpError('');
                  if (actionError) setActionError('');
                }}
              />
              <FieldError error={otpError} />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Verify Code"
                style={[
                  styles.button,
                  (loading || otp.length !== 6) && styles.buttonDisabled,
                ]}
                onPress={handleVerifyOtp}
                disabled={loading || otp.length !== 6}>
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.buttonText}>Verifying...</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Verify Code</Text>
                )}
              </TouchableOpacity>
              <ActionError error={actionError} />

              <View style={styles.cooldownRow}>
                {resendCooldown > 0 ? (
                  <Text style={styles.cooldownText}>
                    Resend code in {resendCooldown}s
                  </Text>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={handleResendOtp}
                    disabled={loading}>
                    <Text style={styles.resendLink}>Resend Code</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.footerRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setStep('EMAIL')}>
                  <Text style={styles.footerLink}>Change Email Address</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.footerRow, { marginTop: 12 }]}>
                <TouchableOpacity accessibilityRole="button" onPress={onBackToLogin}>
                  <Text style={styles.secondaryText}>Return to Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* STEP 3: SET NEW PASSWORD */}
        {step === 'PASSWORD' && (
          <View style={styles.contentWrapper}>
            <Text style={styles.title}>Set New Password</Text>
            <Text style={styles.subtitle}>
              Create a strong new password with at least 6 characters.
            </Text>

            <View style={styles.form}>
              <PasswordInput
                placeholder="New Password"
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  if (passwordError) setPasswordError('');
                  if (actionError) setActionError('');
                }}
              />
              <FieldError error={passwordError} />

              <PasswordInput
                placeholder="Confirm New Password"
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
                accessibilityLabel="Reset Password"
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleResetPassword}
                disabled={loading}>
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.buttonText}>Updating password...</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Reset Password</Text>
                )}
              </TouchableOpacity>
              <ActionError error={actionError} />
            </View>
          </View>
        )}

        {/* STEP 4: SUCCESS */}
        {step === 'SUCCESS' && (
          <View style={styles.successWrapper} accessibilityRole="alert">
            <View style={styles.checkCircle}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Password Reset Successfully</Text>
            <Text style={styles.successText}>
              Your account password has been updated. You can now log in securely using your new credentials.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Return to Sign In"
              style={styles.button}
              onPress={onBackToLogin}>
              <Text style={styles.buttonText}>Return to Sign In</Text>
            </TouchableOpacity>
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
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 40,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
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
    fontWeight: '500',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
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
    paddingVertical: 14,
    fontSize: 16,
    color: '#111111',
    marginBottom: 16,
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
    marginBottom: 16,
    backgroundColor: '#F0F9FF',
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
    backgroundColor: '#0284C7',
    marginTop: 4,
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
    fontSize: 16,
    fontWeight: '600',
  },
  cooldownRow: {
    alignItems: 'center',
    marginTop: 18,
  },
  cooldownText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  resendLink: {
    fontSize: 15,
    color: '#0284C7',
    fontWeight: '600',
  },
  footerRow: {
    alignItems: 'center',
    marginTop: 22,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0284C7',
  },
  secondaryText: {
    fontSize: 14,
    color: '#6B7280',
  },
  bannerContainer: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 4,
  },
  bannerText: {
    color: '#1E3A8A',
    fontSize: 14,
    lineHeight: 20,
  },
  successWrapper: {
    alignItems: 'center',
    paddingVertical: 40,
    width: '100%',
  },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#DEF7EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  checkMark: {
    fontSize: 38,
    color: '#047857',
    fontWeight: 'bold',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 10,
    textAlign: 'center',
  },
  successText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#555555',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 12,
  },
});
