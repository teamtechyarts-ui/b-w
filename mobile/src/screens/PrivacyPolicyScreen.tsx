import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PRIVACY_POLICY_INTRO,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
} from '../content/privacyPolicy';

type PrivacyPolicyScreenProps = {
  onBack: () => void;
};

export default function PrivacyPolicyScreen({
  onBack,
}: PrivacyPolicyScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <Text style={styles.headerSubtitle}>
            Bright & White Laundry • v{PRIVACY_POLICY_VERSION}
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}>
        {/* Intro Banner */}
        <View style={styles.introCard}>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>OFFICIAL POLICY</Text>
            </View>
            <Text style={styles.dateText}>
              Last Updated: {PRIVACY_POLICY_LAST_UPDATED}
            </Text>
          </View>
          <Text style={styles.introText}>{PRIVACY_POLICY_INTRO}</Text>
        </View>

        {/* Sections */}
        {PRIVACY_POLICY_SECTIONS.map((section) => (
          <View key={section.id} style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{section.title}</Text>

            {section.paragraphs?.map((paragraph, pIdx) => (
              <Text key={`p-${section.id}-${pIdx}`} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}

            {section.bullets?.map((bullet, bIdx) => (
              <View key={`b-${section.id}-${bIdx}`} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{bullet}</Text>
              </View>
            ))}

            {section.subsections?.map((sub, sIdx) => (
              <View
                key={`sub-${section.id}-${sIdx}`}
                style={styles.subSectionContainer}>
                <Text style={styles.subSectionTitle}>{sub.subtitle}</Text>

                {sub.paragraphs?.map((subP, spIdx) => (
                  <Text
                    key={`subP-${section.id}-${sIdx}-${spIdx}`}
                    style={styles.paragraph}>
                    {subP}
                  </Text>
                ))}

                {sub.bullets?.map((subB, sbIdx) => (
                  <View
                    key={`subB-${section.id}-${sIdx}-${sbIdx}`}
                    style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{subB}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}

        {/* Footer Card */}
        <View style={styles.footerCard}>
          <Text style={styles.footerHeading}>Questions or Data Requests?</Text>
          <Text style={styles.footerBody}>
            Email our data privacy desk at{' '}
            <Text style={styles.footerHighlight}>
              brightandwhiteofficial@gmail.com
            </Text>{' '}
            or call customer support at{' '}
            <Text style={styles.footerHighlight}>+91 87124 35442</Text>.
          </Text>
          <Text style={styles.footerCopyright}>
            © 2026 Bright & White Laundry. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9F6',
  },
  flex: {
    flex: 1,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    minWidth: 64,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 1,
  },
  headerSpacer: {
    minWidth: 64,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 14,
  },
  introCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    backgroundColor: '#EEF2F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: 0.5,
  },
  dateText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  introText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#374151',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
    lineHeight: 21,
  },
  subSectionContainer: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  subSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 12,
    lineHeight: 19,
    color: '#4B5563',
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: 14,
    lineHeight: 18,
    color: '#111827',
    width: 14,
    fontWeight: '700',
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#374151',
  },
  footerCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    marginTop: 6,
  },
  footerHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  footerBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 12,
  },
  footerHighlight: {
    color: '#111827',
    fontWeight: '700',
  },
  footerCopyright: {
    fontSize: 11,
    color: '#9CA3AF',
  },
});
