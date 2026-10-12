import React from 'react';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

type OtpScreenProps = {
  phone: string;
  otp: string;
  loading: boolean;
  onOtpChange: (value: string) => void;
  onVerifyOtp: () => void;
  onBack: () => void;
};

export default function OtpScreen({
  phone,
  otp,
  loading,
  onOtpChange,
  onVerifyOtp,
  onBack,
}: OtpScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.content}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>
            ← Back
          </Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          Enter OTP
        </Text>

        <Text style={styles.subtitle}>
          Enter the OTP sent to {phone}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="OTP"
          keyboardType="number-pad"
          value={otp}
          onChangeText={onOtpChange}
          maxLength={6}
        />

        <TouchableOpacity
          style={[
            styles.button,
            loading && styles.buttonDisabled,
          ]}
          onPress={onVerifyOtp}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              Verify OTP
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  content: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: 40,
  },

  back: {
    fontSize: 16,
    marginBottom: 40,
  },

  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 16,
    color: '#555555',
    marginBottom: 30,
  },

  input: {
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 17,
    marginBottom: 20,
  },

  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#111111',
  },

  buttonDisabled: {
    opacity: 0.4,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});