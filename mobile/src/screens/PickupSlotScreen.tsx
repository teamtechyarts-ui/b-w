import React from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import AppIcon from '../components/AppIcon';
import CheckoutProgressBar from '../components/CheckoutProgressBar';
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';
import type {AddressItem} from '../types/address';
import type {
  PickupDateChoice,
  PickupSlot,
} from '../hooks/usePickupSchedule';

type PickupSlotScreenProps = {
  selectedAddress: AddressItem | null;

  pickupDateChoices: PickupDateChoice[];
  pickupSlots: PickupSlot[];

  selectedPickupDateKey: string | null;
  selectedPickupSlotId: string | null;

  pickupScheduledAt: string;
  pickupSlotLabel: string;

  selectedPickupDate: PickupDateChoice | null;

  onBack: () => void;
  onChoosePickupDate: (dateKey: string) => void;
  onChoosePickupSlot: (slot: PickupSlot) => void;
  onContinue: () => void;

  isSlotUnavailable: (
    dateKey: string,
    slot: PickupSlot,
  ) => boolean;
};

export default function PickupSlotScreen({
  selectedAddress,
  pickupDateChoices,
  pickupSlots,
  selectedPickupDateKey,
  selectedPickupSlotId,
  pickupScheduledAt,
  pickupSlotLabel,
  selectedPickupDate,
  onBack,
  onChoosePickupDate,
  onChoosePickupSlot,
  onContinue,
  isSlotUnavailable,
}: PickupSlotScreenProps) {
  const isContinueEnabled = Boolean(pickupScheduledAt && pickupSlotLabel);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.screenContainer}>
        {/* Header */}
        <View style={styles.pageHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.headerBtn}
            onPress={onBack}>
            <View style={styles.backRow}>
              <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
              <Text style={styles.pageBack}>Back</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.pageHeaderTitle}>Pickup Schedule</Text>

          <View style={styles.headerSpacer} />
        </View>

        {/* Progress Bar */}
        <CheckoutProgressBar currentStep="schedule" />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          
          {/* Selected Address Compact Summary */}
          {selectedAddress ? (
            <View style={styles.addressSummaryCard}>
              <View style={styles.addressSummaryLeft}>
                <View style={styles.locationPinBox}>
                  <AppIcon name="location" size={18} color={colors.textPrimary} />
                </View>
                <View style={styles.addressTextCol}>
                  <Text style={styles.addressEyebrow}>PICKUP FROM</Text>
                  <Text numberOfLines={1} style={styles.addressLabelName}>
                    {selectedAddress.label || 'Selected Address'}
                  </Text>
                  <Text numberOfLines={1} style={styles.addressLineText}>
                    {selectedAddress.address_line1}
                    {selectedAddress.postal_code ? ` · ${selectedAddress.postal_code}` : ''}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Section: Select Date */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Select pickup date</Text>
            <Text style={styles.sectionSubtitle}>
              Choose your preferred day for garment collection.
            </Text>
          </View>

          {/* Horizontal Date Picker */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateRow}>
            {pickupDateChoices.map(date => {
              const selected = date.key === selectedPickupDateKey;

              return (
                <TouchableOpacity
                  key={date.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Pickup on ${date.dayName} ${date.dateLabel}`}
                  accessibilityState={{selected}}
                  style={[
                    styles.dateCard,
                    selected && styles.dateCardSelected,
                  ]}
                  onPress={() => onChoosePickupDate(date.key)}>
                  <Text
                    style={[
                      styles.dateDay,
                      selected && styles.dateTextSelected,
                    ]}>
                    {date.dayName.toUpperCase()}
                  </Text>

                  <Text
                    style={[
                      styles.dateNumber,
                      selected && styles.dateTextSelected,
                    ]}>
                    {date.dateLabel}
                  </Text>

                  {selected ? (
                    <View style={styles.dateActiveDot} />
                  ) : (
                    <View style={styles.dateDotPlaceholder} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Section: Select Time Slot */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Select pickup time</Text>
            <Text style={styles.selectedDateBadge}>
              {selectedPickupDate?.fullLabel || 'Select a date above first'}
            </Text>
          </View>

          {/* Time Slots 2-Column Grid */}
          <View style={styles.slotGrid}>
            {pickupSlots.map(slot => {
              const selected = slot.id === selectedPickupSlotId;
              const unavailable =
                !selectedPickupDateKey ||
                isSlotUnavailable(selectedPickupDateKey, slot);

              return (
                <TouchableOpacity
                  key={slot.id}
                  disabled={unavailable}
                  accessibilityRole="button"
                  accessibilityLabel={`Pickup slot ${slot.label}${
                    unavailable ? ' (Unavailable)' : selected ? ' (Selected)' : ''
                  }`}
                  accessibilityState={{selected, disabled: unavailable}}
                  style={[
                    styles.slotCard,
                    selected && styles.slotCardSelected,
                    unavailable && styles.slotCardDisabled,
                  ]}
                  onPress={() => onChoosePickupSlot(slot)}>
                  <View style={styles.slotTopRow}>
                    <AppIcon
                      name="clock"
                      size={16}
                      color={selected ? colors.textInverse : colors.textMuted}
                    />
                    {selected ? (
                      <View style={styles.slotSelectedBadge}>
                        <AppIcon name="check" size={12} color={colors.primary} strokeWidth={3} />
                      </View>
                    ) : null}
                  </View>

                  <Text
                    style={[
                      styles.slotTime,
                      selected && styles.slotTextSelected,
                      unavailable && styles.slotTextDisabled,
                    ]}>
                    {slot.label}
                  </Text>

                  {unavailable ? (
                    <Text style={styles.unavailableText}>Unavailable</Text>
                  ) : selected ? (
                    <Text style={styles.selectedSlotStatusText}>Selected slot</Text>
                  ) : (
                    <Text style={styles.availableText}>Available</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected Confirmation Banner */}
          {pickupScheduledAt && pickupSlotLabel ? (
            <View style={styles.selectedScheduleBanner}>
              <View style={styles.bannerCheckCircle}>
                <AppIcon name="check" size={16} color={colors.textInverse} strokeWidth={2.5} />
              </View>
              <View style={styles.bannerTextCol}>
                <Text style={styles.bannerTitle}>Pickup Slot Confirmed</Text>
                <Text style={styles.bannerSubtitle}>
                  {selectedPickupDate?.fullLabel} · {pickupSlotLabel}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky Bottom CTA */}
        <View style={styles.bottomArea}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Continue to Order Review"
            disabled={!isContinueEnabled}
            style={[
              styles.continueButton,
              !isContinueEnabled && styles.buttonDisabled,
            ]}
            onPress={onContinue}>
            <View style={styles.btnContentRow}>
              <Text style={styles.continueButtonText}>
                Continue to Order Review
              </Text>
              <AppIcon name="arrow-right" size={18} color={colors.textInverse} strokeWidth={2.5} />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  pageHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    minWidth: 54,
    minHeight: 44,
    justifyContent: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pageBack: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pageHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 54,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  addressSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  addressSummaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationPinBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  addressTextCol: {
    flex: 1,
  },
  addressEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  addressLabelName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 1,
  },
  addressLineText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  sectionHeaderRow: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  selectedDateBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  dateRow: {
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
  },
  dateCard: {
    width: 88,
    minHeight: 86,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  dateCardSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.md,
  },
  dateDay: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  dateNumber: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dateTextSelected: {
    color: colors.textInverse,
  },
  dateActiveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.textInverse,
    marginTop: 6,
  },
  dateDotPlaceholder: {
    height: 5,
    marginTop: 6,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  slotCard: {
    width: '48%',
    minHeight: 90,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    justifyContent: 'space-between',
    ...shadows.sm,
  },
  slotCardSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.md,
  },
  slotCardDisabled: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    opacity: 0.6,
  },
  slotTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  slotSelectedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotTime: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  slotTextSelected: {
    color: colors.textInverse,
  },
  slotTextDisabled: {
    color: colors.textSubtle,
  },
  availableText: {
    marginTop: 4,
    fontSize: 11,
    color: colors.success,
    fontWeight: '600',
  },
  unavailableText: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textSubtle,
    fontWeight: '500',
  },
  selectedSlotStatusText: {
    marginTop: 4,
    fontSize: 11,
    color: '#A7F3D0',
    fontWeight: '700',
  },
  selectedScheduleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginTop: spacing.xs,
  },
  bannerCheckCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  bannerTextCol: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.successText,
  },
  bannerSubtitle: {
    fontSize: 12,
    color: colors.success,
    marginTop: 1,
    fontWeight: '600',
  },
  bottomArea: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    backgroundColor: 'transparent',
  },
  continueButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    ...shadows.lg,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  continueButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    backgroundColor: colors.textSubtle,
    shadowOpacity: 0,
    elevation: 0,
  },
});