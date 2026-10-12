import React from 'react';
import {
  Modal,
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

type PrivacyPolicyModalProps = {
  visible: boolean;
  onClose: () => void;
};

export default function PrivacyPolicyModal({
  visible,
  onClose,
}: PrivacyPolicyModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />

          <View style={styles.headerCenter}>
            <Text style={styles.title}>Privacy Policy</Text>
            <Text style={styles.version}>Version {PRIVACY_POLICY_VERSION}</Text>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close privacy policy"
            style={styles.closeButton}
            onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}>
          <View style={styles.noticeCard}>
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>DATA PROTECTION</Text>
              </View>
              <Text style={styles.dateText}>
                Last Updated: {PRIVACY_POLICY_LAST_UPDATED}
              </Text>
            </View>
            <Text style={styles.noticeText}>{PRIVACY_POLICY_INTRO}</Text>
          </View>

          {PRIVACY_POLICY_SECTIONS.map((section) => (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>

              {section.paragraphs?.map((paragraph, index) => (
                <Text
                  key={`paragraph-${section.id}-${index}`}
                  style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}

              {section.bullets?.map((bullet, index) => (
                <View
                  key={`bullet-${section.id}-${index}`}
                  style={styles.bulletRow}>
                  <Text style={styles.bulletSymbol}>•</Text>
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
                      <Text style={styles.bulletSymbol}>•</Text>
                      <Text style={styles.bulletText}>{subB}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))}

          <View style={styles.contactCard}>
            <Text style={styles.contactTitle}>Privacy Inquiries & Deletion</Text>
            <Text style={styles.contactText}>
              For any privacy questions or external account deletion requests,
              contact our privacy desk at brightandwhiteofficial@gmail.com or call
              +91 87124 35442.
            </Text>
          </View>

          <Text style={styles.footerText}>
            Bright & White Laundry • com.brightwhitemobile
          </Text>
        </ScrollView>

        <View style={styles.bottomArea}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close privacy policy"
            style={styles.doneButton}
            onPress={onClose}>
            <Text style={styles.doneButtonText}>Close Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },
  header: {
    minHeight: 60,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  headerSpacer: {
    width: 60,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    color: '#111111',
  },
  version: {
    marginTop: 2,
    fontSize: 10,
    color: '#777777',
    fontWeight: '600',
  },
  closeButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingVertical: 10,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 110,
  },
  noticeCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#3730A3',
  },
  dateText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 19,
    color: '#334155',
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: '#111111',
    marginBottom: 8,
  },
  subSectionContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  subSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  paragraph: {
    fontSize: 12,
    lineHeight: 19,
    color: '#333333',
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  bulletSymbol: {
    width: 16,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: '#111111',
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#333333',
  },
  contactCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
    marginBottom: 16,
  },
  contactTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  contactText: {
    fontSize: 11,
    lineHeight: 17,
    color: '#475569',
  },
  footerText: {
    fontSize: 10,
    color: '#888888',
    textAlign: 'center',
    marginTop: 4,
  },
  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
  },
  doneButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
