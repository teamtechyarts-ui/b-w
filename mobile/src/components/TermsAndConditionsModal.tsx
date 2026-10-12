import React from 'react';

import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {
  TERMS_INTRO,
  TERMS_SECTIONS,
  TERMS_VERSION,
} from '../content/termsAndConditions';

type TermsAndConditionsModalProps = {
  visible: boolean;
  onClose: () => void;
};

export default function TermsAndConditionsModal({
  visible,
  onClose,
}: TermsAndConditionsModalProps) {
  return (
    <Modal
      visible={
        visible
      }
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={
        onClose
      }>
      <SafeAreaView
        style={
          styles.container
        }>
        <View
          style={
            styles.header
          }>
          <View
            style={
              styles.headerSpacer
            }
          />

          <View
            style={
              styles.headerCenter
            }>
            <Text
              style={
                styles.title
              }>
              Terms & Conditions
            </Text>

            <Text
              style={
                styles.version
              }>
              Version{' '}
              {
                TERMS_VERSION
              }
            </Text>
          </View>

          <TouchableOpacity
            style={
              styles.closeButton
            }
            onPress={
              onClose
            }>
            <Text
              style={
                styles.closeText
              }>
              Close
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={
            styles.flex
          }
          contentContainerStyle={
            styles.scrollContent
          }
          showsVerticalScrollIndicator>
          <View
            style={
              styles.noticeCard
            }>
            <Text
              style={
                styles.noticeTitle
              }>
              Please read carefully
            </Text>

            <Text
              style={
                styles.noticeText
              }>
              {
                TERMS_INTRO
              }
            </Text>
          </View>

          {TERMS_SECTIONS.map(
            section => (
              <View
                key={
                  section.title
                }
                style={
                  styles.section
                }>
                <Text
                  style={
                    styles.sectionTitle
                  }>
                  {
                    section.title
                  }
                </Text>

                {section.paragraphs?.map(
                  (
                    paragraph,
                    index,
                  ) => (
                    <Text
                      key={`paragraph-${section.title}-${index}`}
                      style={
                        styles.paragraph
                      }>
                      {
                        paragraph
                      }
                    </Text>
                  ),
                )}

                {section.bullets?.map(
                  (
                    bullet,
                    index,
                  ) => (
                    <View
                      key={`bullet-${section.title}-${index}`}
                      style={
                        styles.bulletRow
                      }>
                      <Text
                        style={
                          styles.bulletSymbol
                        }>
                        •
                      </Text>

                      <Text
                        style={
                          styles.bulletText
                        }>
                        {
                          bullet
                        }
                      </Text>
                    </View>
                  ),
                )}
              </View>
            ),
          )}

          <View
            style={
              styles.acceptanceNotice
            }>
            <Text
              style={
                styles.acceptanceNoticeTitle
              }>
              Acceptance
            </Text>

            <Text
              style={
                styles.acceptanceNoticeText
              }>
              Opening or reading these Terms does not automatically accept them.
            </Text>

            <Text
              style={
                styles.acceptanceNoticeText
              }>
              Acceptance occurs only when you return to the Payment screen, actively select the Terms & Conditions checkbox, and place your order.
            </Text>
          </View>

          <View
            style={
              styles.versionCard
            }>
            <Text
              style={
                styles.versionCardLabel
              }>
              TERMS VERSION
            </Text>

            <Text
              style={
                styles.versionCardValue
              }>
              {
                TERMS_VERSION
              }
            </Text>
          </View>

          <Text
            style={
              styles.footerText
            }>
            Bright & White Customer Terms & Conditions
          </Text>
        </ScrollView>

        <View
          style={
            styles.bottomArea
          }>
          <TouchableOpacity
            style={
              styles.doneButton
            }
            onPress={
              onClose
            }>
            <Text
              style={
                styles.doneButtonText
              }>
              Close Terms & Conditions
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#FFFFFF',
    },

    flex: {
      flex: 1,
    },

    header: {
      minHeight: 66,
      paddingHorizontal:
        18,
      flexDirection:
        'row',
      alignItems:
        'center',
      borderBottomWidth:
        1,
      borderBottomColor:
        '#EEEEEE',
      backgroundColor:
        '#FFFFFF',
    },

    headerSpacer: {
      width: 60,
    },

    headerCenter: {
      flex: 1,
      alignItems:
        'center',
    },

    title: {
      fontSize: 17,
      fontWeight:
        '800',
      textAlign:
        'center',
      color:
        '#111111',
    },

    version: {
      marginTop: 2,
      fontSize: 10,
      color:
        '#777777',
    },

    closeButton: {
      width: 60,
      alignItems:
        'flex-end',
      paddingVertical:
        10,
    },

    closeText: {
      fontSize: 14,
      fontWeight:
        '700',
      color:
        '#111111',
    },

    scrollContent: {
      paddingHorizontal:
        20,
      paddingTop: 18,
      paddingBottom:
        120,
    },

    noticeCard: {
      backgroundColor:
        '#F4F4F4',
      borderRadius: 14,
      padding: 15,
      marginBottom: 22,
    },

    noticeTitle: {
      fontSize: 14,
      fontWeight:
        '800',
      color:
        '#111111',
      marginBottom: 6,
    },

    noticeText: {
      fontSize: 12,
      lineHeight: 19,
      color:
        '#555555',
    },

    section: {
      marginBottom: 22,
    },

    sectionTitle: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight:
        '800',
      color:
        '#111111',
      marginBottom: 9,
    },

    paragraph: {
      fontSize: 12,
      lineHeight: 19,
      color:
        '#333333',
      marginBottom: 8,
    },

    bulletRow: {
      flexDirection:
        'row',
      alignItems:
        'flex-start',
      marginBottom: 7,
    },

    bulletSymbol: {
      width: 18,
      fontSize: 13,
      lineHeight: 19,
      fontWeight:
        '800',
      color:
        '#111111',
    },

    bulletText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 19,
      color:
        '#333333',
    },

    acceptanceNotice: {
      backgroundColor:
        '#F7F7F7',
      borderRadius: 14,
      padding: 15,
      marginTop: 2,
      marginBottom: 16,
    },

    acceptanceNoticeTitle: {
      fontSize: 14,
      fontWeight:
        '800',
      color:
        '#111111',
      marginBottom: 6,
    },

    acceptanceNoticeText: {
      fontSize: 11,
      lineHeight: 17,
      color:
        '#555555',
      marginBottom: 5,
    },

    versionCard: {
      borderWidth: 1,
      borderColor:
        '#E6E6E6',
      borderRadius: 12,
      padding: 14,
      marginBottom: 18,
    },

    versionCardLabel: {
      fontSize: 9,
      letterSpacing: 0.7,
      fontWeight:
        '700',
      color:
        '#888888',
    },

    versionCardValue: {
      marginTop: 4,
      fontSize: 15,
      fontWeight:
        '800',
      color:
        '#111111',
    },

    footerText: {
      fontSize: 10,
      color:
        '#888888',
      textAlign:
        'center',
      marginTop: 4,
    },

    bottomArea: {
      position:
        'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal:
        20,
      paddingTop: 12,
      paddingBottom: 10,
      backgroundColor:
        '#FFFFFF',
      borderTopWidth:
        1,
      borderTopColor:
        '#EEEEEE',
    },

    doneButton: {
      minHeight: 52,
      borderRadius: 13,
      backgroundColor:
        '#111111',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    doneButtonText: {
      color:
        '#FFFFFF',
      fontSize: 15,
      fontWeight:
        '700',
    },
  });
