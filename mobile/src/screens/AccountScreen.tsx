import React from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';

export type AccountDestination =
  | 'profile'
  | 'addresses'
  | 'offers'
  | 'claims'
  | 'notifications'
  | 'support'
  | 'terms'
  | 'privacy';

type Props = {
  onOpen: (destination: AccountDestination) => void;
  onLogout: () => void;
};

const entries: {label: string; detail: string; destination: AccountDestination}[] = [
  {
    label: 'Profile',
    detail: 'Personal details and preferences',
    destination: 'profile',
  },
  {
    label: 'Addresses',
    detail: 'Saved pickup and delivery locations',
    destination: 'addresses',
  },
  {
    label: 'Coupons & offers',
    detail: 'Available promo codes and discounts',
    destination: 'offers',
  },
  {
    label: 'Claims & refunds',
    detail: 'Order help and status',
    destination: 'claims',
  },
  {
    label: 'Notifications',
    detail: 'Order updates and messages',
    destination: 'notifications',
  },
  {
    label: 'Support',
    detail: 'Help and contact options',
    destination: 'support',
  },
  {
    label: 'Terms',
    detail: 'Terms and conditions',
    destination: 'terms',
  },
  {
    label: 'Privacy Policy',
    detail: 'How we collect, use and protect your data',
    destination: 'privacy',
  },
];

export default function AccountScreen({onOpen, onLogout}: Props) {
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.subtitle}>Manage your details, savings and support.</Text>

        <View style={styles.list}>
          {entries.map(entry => (
            <TouchableOpacity
              key={entry.label}
              accessibilityRole="button"
              accessibilityLabel={entry.label}
              style={styles.row}
              onPress={() => onOpen(entry.destination)}>
              <View style={styles.flex}>
                <Text style={styles.label}>{entry.label}</Text>
                <Text style={styles.detail}>{entry.detail}</Text>
              </View>
              <AppIcon name="chevron-right" size={16} color="#888" />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Log out"
          style={styles.logout}
          onPress={onLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#FAF9F6'},
  content: {padding: 20, paddingBottom: 38},
  title: {fontSize: 30, fontWeight: '900', color: '#151515'},
  subtitle: {color: '#67635B', marginTop: 5, marginBottom: 20, fontSize: 14},
  list: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E1DDD5',
    backgroundColor: '#fff',
  },
  row: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD8CF',
    minHeight: 52,
  },
  flex: {flex: 1},
  label: {fontSize: 16, fontWeight: '800', color: '#151515'},
  detail: {color: '#6D685F', marginTop: 3, fontSize: 13},
  arrow: {fontSize: 24, color: '#888'},
  logout: {
    marginTop: 24,
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7B4B0',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  logoutText: {fontWeight: '800', color: '#982C23', fontSize: 15},
});
