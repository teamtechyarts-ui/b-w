import React from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import BrandLogo from '../components/BrandLogo';

import PrivacyPolicyModal from '../components/PrivacyPolicyModal';

type WelcomeScreenProps = {
  onGetStarted: () => void;
  onOpenPrivacy?: () => void;
};

export default function WelcomeScreen({
  onGetStarted,
  onOpenPrivacy,
}: WelcomeScreenProps) {
  const [showPrivacy, setShowPrivacy] = React.useState(false);
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.content}>
        <BrandLogo width={200} containerStyle={styles.logoContainer} />

        <Text style={styles.title}>
          Bright & White
        </Text>

        <Text style={styles.subtitle}>
          Laundry & Dry Cleaning
        </Text>

        <Text style={styles.description}>
          Easy pickup. Professional cleaning. Delivered to your doorstep.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={onGetStarted}>
          <Text style={styles.buttonText}>
            Get Started
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.footer}>
          Clean clothes. Simple life.
        </Text>
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel="Privacy Policy"
          onPress={() => onOpenPrivacy ? onOpenPrivacy() : setShowPrivacy(true)}
          style={styles.privacyButton}>
          <Text style={styles.privacyLink}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>

      <PrivacyPolicyModal
        visible={showPrivacy}
        onClose={() => setShowPrivacy(false)}
      />
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },

  logoContainer: {
    marginBottom: 20,
    alignSelf: 'center',
  },

  title: {
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 25,
  },

  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    color: '#555555',
    marginBottom: 40,
  },

  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#111111',
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },

  footerRow: {
    alignItems: 'center',
    paddingBottom: 20,
    gap: 6,
  },

  footer: {
    textAlign: 'center',
    fontSize: 13,
    color: '#666666',
  },

  privacyButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },

  privacyLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textDecorationLine: 'underline',
  },
});