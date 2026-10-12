import React, {useState} from 'react';
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

import AppIcon from '../components/AppIcon';
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';
import {getCurrentDeviceLocation} from '../services/deviceLocationService';
import {reverseGeocode} from '../services/mapsApi';
import type {AddressFormState} from '../types/address';

type AddressFormScreenProps = {
  accessToken: string;
  editing: boolean;
  form: AddressFormState;
  saving: boolean;
  onBack: () => void;
  onChange: (form: AddressFormState) => void;
  onChooseLocation: () => void;
  onSave: () => void;
};

type LocationStatus =
  | 'none'
  | 'existing_saved'
  | 'confirmed'
  | 'unresolved'
  | 'error';

type ResolvedAddressPreview = {
  street?: string;
  area?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

export default function AddressFormScreen({
  accessToken,
  editing,
  form,
  saving,
  onBack,
  onChange,
  onChooseLocation,
  onSave,
}: AddressFormScreenProps) {
  const [locating, setLocating] = useState(false);
  const [locatingStage, setLocatingStage] = useState<'idle' | 'gps' | 'geocoding'>('idle');
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [showPickerOptions, setShowPickerOptions] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const initialStatus: LocationStatus =
    form.latitude && form.longitude
      ? editing
        ? 'existing_saved'
        : 'confirmed'
      : 'none';

  const [locationStatus, setLocationStatus] = useState<LocationStatus>(initialStatus);
  const [resolvedAddressPreview, setResolvedAddressPreview] =
    useState<ResolvedAddressPreview | null>(null);

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    setLocatingStage('gps');
    setErrorMessage(null);

    try {
      const location = await getCurrentDeviceLocation();
      const accuracy = location.accuracy ? Math.round(location.accuracy) : null;
      setAccuracyMeters(accuracy);

      setLocatingStage('geocoding');

      let geocodedAddress = null;
      if (accessToken) {
        try {
          geocodedAddress = await reverseGeocode(
            accessToken,
            location.latitude,
            location.longitude,
          );
        } catch {
          geocodedAddress = null;
        }
      }

      if (geocodedAddress) {
        const nextForm: AddressFormState = {
          ...form,
          latitude: location.latitude,
          longitude: location.longitude,
        };

        if (geocodedAddress.addressLine1) {
          nextForm.addressLine1 = geocodedAddress.addressLine1;
        }
        if (geocodedAddress.addressLine2) {
          nextForm.addressLine2 = geocodedAddress.addressLine2;
        }
        if (geocodedAddress.city) {
          nextForm.city = geocodedAddress.city;
        }
        if (geocodedAddress.state) {
          nextForm.state = geocodedAddress.state;
        }
        if (geocodedAddress.postalCode) {
          nextForm.postalCode = geocodedAddress.postalCode;
        }

        onChange(nextForm);

        setResolvedAddressPreview({
          street: geocodedAddress.addressLine1,
          area: geocodedAddress.addressLine2,
          city: geocodedAddress.city,
          state: geocodedAddress.state,
          postalCode: geocodedAddress.postalCode,
        });

        setLocationStatus('confirmed');
        setShowPickerOptions(false);
      } else {
        setResolvedAddressPreview(null);
        onChange({
          ...form,
          latitude: location.latitude,
          longitude: location.longitude,
        });
        setLocationStatus('unresolved');
        setShowPickerOptions(false);
      }
    } catch (error: any) {
      const rawMessage = (error?.message || '').toLowerCase();
      let friendlyMessage = "Couldn't get your location. Please try again.";

      if (
        rawMessage.includes('permission') ||
        rawMessage.includes('denied') ||
        rawMessage.includes('not granted')
      ) {
        friendlyMessage =
          'Location permission was denied. You can enter your address manually.';
      } else if (
        rawMessage.includes('accuracy') ||
        rawMessage.includes('low')
      ) {
        friendlyMessage =
          'Your location accuracy is low. Move to an open area and try again.';
      } else if (
        rawMessage.includes('timeout') ||
        rawMessage.includes('timed out')
      ) {
        friendlyMessage = "Couldn't get your location. Please try again.";
      } else if (
        rawMessage.includes('network') ||
        rawMessage.includes('geocod')
      ) {
        friendlyMessage =
          "Couldn't look up your address right now. You can enter it manually.";
      }

      setErrorMessage(friendlyMessage);
      setLocationStatus('error');
    } finally {
      setLocating(false);
      setLocatingStage('idle');
    }
  };

  const previewStreet = resolvedAddressPreview?.street ?? form.addressLine1;
  const previewArea = resolvedAddressPreview?.area ?? form.addressLine2;
  const previewCity = resolvedAddressPreview?.city ?? form.city;
  const previewState = resolvedAddressPreview?.state ?? form.state;
  const previewPostalCode = resolvedAddressPreview?.postalCode ?? form.postalCode;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.screenContainer}>
        <View style={styles.pageHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            disabled={saving || locating}
            style={styles.backBtn}
            onPress={onBack}>
            <View style={styles.backRow}>
              <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
              <Text style={styles.pageBack}>Back</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.pageHeaderTitle}>
            {editing ? 'Edit Address' : 'Add Address'}
          </Text>

          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.formScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.locationSection}>
            <View style={styles.locationSectionHeader}>
              <View style={styles.locationIconContainer}>
                <AppIcon name="location" size={18} color={colors.textPrimary} />
              </View>

              <View style={styles.locationSectionText}>
                <Text style={styles.locationSectionTitle}>Pickup Location</Text>
                <Text style={styles.locationSectionSubtitle}>
                  Use your current location to automatically fill your pickup
                  address.
                </Text>
              </View>
            </View>

            {/* 1. CONFIRMED / EXISTING SAVED STATE */}
            {!showPickerOptions &&
            (locationStatus === 'confirmed' || locationStatus === 'existing_saved') ? (
              <View style={styles.selectedLocationCard}>
                <View style={styles.selectedLocationHeader}>
                  <View style={styles.statusRow}>
                    <AppIcon name="check" size={16} color={colors.success} strokeWidth={2.5} />
                    <Text style={styles.confirmedLocationTitle}>
                      {locationStatus === 'existing_saved'
                        ? 'Pickup location saved'
                        : 'Location detected'}
                    </Text>
                  </View>
                  {accuracyMeters !== null ? (
                    <Text style={styles.accuracyBadge}>
                      Accuracy: ~{accuracyMeters} m
                    </Text>
                  ) : null}
                </View>

                {Boolean(previewStreet) && (
                  <Text style={styles.detectedAddressLinePrimary}>
                    {previewStreet}
                  </Text>
                )}

                {Boolean(previewArea) && (
                  <Text style={styles.detectedAddressLineSecondary}>
                    {previewArea}
                  </Text>
                )}

                <Text style={styles.detectedAddressLineSecondary}>
                  {[previewCity, previewState].filter(Boolean).join(', ')}
                </Text>

                {Boolean(previewPostalCode) && (
                  <Text style={styles.detectedAddressLineSecondary}>
                    {previewPostalCode}
                  </Text>
                )}

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Change Location"
                  style={styles.changeLocationButton}
                  disabled={saving || locating}
                  onPress={() => setShowPickerOptions(true)}>
                  <Text style={styles.changeLocationButtonText}>
                    Change Location
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* 2. GPS SUCCESS + REVERSE GEOCODING FAILURE (UNRESOLVED STATE) */}
            {!showPickerOptions && locationStatus === 'unresolved' ? (
              <View style={styles.unresolvedLocationCard}>
                <View style={styles.unresolvedLocationHeader}>
                  <View style={styles.statusRow}>
                    <AppIcon name="location" size={16} color={colors.primary} />
                    <Text style={styles.unresolvedLocationTitle}>
                      Location detected
                    </Text>
                  </View>
                  {accuracyMeters !== null ? (
                    <Text style={styles.accuracyBadge}>
                      Accuracy: ~{accuracyMeters} m
                    </Text>
                  ) : null}
                </View>

                <Text style={styles.unresolvedLocationSubtitle}>
                  We found your current location, but couldn't automatically
                  determine the address.
                </Text>

                <View style={styles.unresolvedActionRow}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Try Again"
                    style={styles.unresolvedRetryButton}
                    disabled={locating || saving}
                    onPress={handleUseCurrentLocation}>
                    <Text style={styles.unresolvedRetryButtonText}>
                      Try Again
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Choose Location on Map"
                    style={styles.unresolvedMapButton}
                    disabled={locating || saving}
                    onPress={() => {
                      setShowPickerOptions(false);
                      onChooseLocation();
                    }}>
                    <Text style={styles.unresolvedMapButtonText}>
                      Choose Location on Map
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.unresolvedHelpText}>
                  You can also enter your address manually below.
                </Text>
              </View>
            ) : null}

            {/* 3. ERROR STATE */}
            {!showPickerOptions && locationStatus === 'error' && errorMessage ? (
              <View style={styles.errorCard}>
                <AppIcon name="alert" size={18} color={colors.danger} />
                <View style={styles.errorTextContainer}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                  <View style={styles.errorActionRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Try Again"
                      style={styles.errorRetryButton}
                      disabled={locating || saving}
                      onPress={handleUseCurrentLocation}>
                      <Text style={styles.errorRetryButtonText}>Try Again</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Enter Address Manually"
                      style={styles.errorDismissButton}
                      onPress={() => setLocationStatus('none')}>
                      <Text style={styles.errorDismissButtonText}>
                        Enter Address Manually
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : null}

            {/* 4. PICKER OPTIONS STATE */}
            {showPickerOptions ||
            (locationStatus === 'none' && !locating) ||
            locating ? (
              <View style={styles.pickerOptionsContainer}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Use My Current Location"
                  style={[
                    styles.currentLocationButton,
                    (locating || saving) && styles.buttonDisabled,
                  ]}
                  disabled={locating || saving}
                  onPress={handleUseCurrentLocation}>
                  {locating ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color={colors.textInverse} size="small" />
                      <Text style={styles.currentLocationButtonText}>
                        {locatingStage === 'geocoding'
                          ? 'Finding your address...'
                          : 'Getting your location...'}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.btnContentRow}>
                      <AppIcon name="location" size={16} color={colors.textInverse} />
                      <Text style={styles.currentLocationButtonText}>
                        Use My Current Location
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Choose Location on Map"
                  style={[
                    styles.mapPickerButton,
                    (locating || saving) && styles.buttonDisabled,
                  ]}
                  disabled={locating || saving}
                  onPress={() => {
                    setShowPickerOptions(false);
                    onChooseLocation();
                  }}>
                  <View style={styles.btnContentRow}>
                    <AppIcon name="location" size={16} color={colors.textPrimary} />
                    <Text style={styles.mapPickerButtonText}>
                      Choose Location on Map
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* Form Inputs */}
          <View style={styles.formCard}>
            <Text style={styles.formSectionTitle}>Address Details</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Address Label</Text>
              <TextInput
                accessibilityLabel="Address Label"
                placeholder="e.g. Home, Office, Parents"
                placeholderTextColor={colors.textMuted}
                value={form.label}
                onChangeText={text => onChange({...form, label: text})}
                style={styles.textInput}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Flat, House no., Building, Company *</Text>
              <TextInput
                accessibilityLabel="Address Line 1"
                placeholder="House / Flat No., Apartment Name"
                placeholderTextColor={colors.textMuted}
                value={form.addressLine1}
                onChangeText={text => onChange({...form, addressLine1: text})}
                style={styles.textInput}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Area, Street, Sector, Village</Text>
              <TextInput
                accessibilityLabel="Address Line 2"
                placeholder="Street / Area Name"
                placeholderTextColor={colors.textMuted}
                value={form.addressLine2}
                onChangeText={text => onChange({...form, addressLine2: text})}
                style={styles.textInput}
              />
            </View>

            <View style={styles.rowFields}>
              <View style={[styles.fieldGroup, styles.flexHalf]}>
                <Text style={styles.fieldLabel}>City *</Text>
                <TextInput
                  accessibilityLabel="City"
                  placeholder="City"
                  placeholderTextColor={colors.textMuted}
                  value={form.city}
                  onChangeText={text => onChange({...form, city: text})}
                  style={styles.textInput}
                />
              </View>

              <View style={[styles.fieldGroup, styles.flexHalf]}>
                <Text style={styles.fieldLabel}>State *</Text>
                <TextInput
                  accessibilityLabel="State"
                  placeholder="State"
                  placeholderTextColor={colors.textMuted}
                  value={form.state}
                  onChangeText={text => onChange({...form, state: text})}
                  style={styles.textInput}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Pincode *</Text>
              <TextInput
                accessibilityLabel="Pincode"
                placeholder="6-digit Pincode"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                maxLength={6}
                value={form.postalCode}
                onChangeText={text => onChange({...form, postalCode: text})}
                style={styles.textInput}
              />
            </View>

            {/* Default Address Checkbox */}
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{checked: form.isDefault}}
              accessibilityLabel="Make this my default address"
              style={styles.checkboxRow}
              onPress={() => onChange({...form, isDefault: !form.isDefault})}>
              <View
                style={[
                  styles.checkbox,
                  form.isDefault && styles.checkboxChecked,
                ]}>
                {form.isDefault ? (
                  <AppIcon name="check" size={14} color={colors.textInverse} strokeWidth={3} />
                ) : null}
              </View>
              <Text style={styles.checkboxLabel}>Make this my default address</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Bottom Save CTA */}
        <View style={styles.bottomArea}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Update Address' : 'Save Address'}
            disabled={saving || locating}
            style={[
              styles.saveButton,
              (saving || locating) && styles.buttonDisabled,
            ]}
            onPress={onSave}>
            {saving ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.textInverse} size="small" />
                <Text style={styles.saveButtonText}>Saving address...</Text>
              </View>
            ) : (
              <View style={styles.btnContentRow}>
                <Text style={styles.saveButtonText}>
                  {editing ? 'Update Address' : 'Save Address'}
                </Text>
                <AppIcon name="arrow-right" size={16} color={colors.textInverse} strokeWidth={2.5} />
              </View>
            )}
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
  backBtn: {
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
  formScroll: {
    paddingBottom: 110,
  },
  locationSection: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  locationSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  locationIconContainer: {
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
  locationSectionText: {
    flex: 1,
  },
  locationSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  locationSectionSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
  selectedLocationCard: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  selectedLocationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  confirmedLocationTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.successText,
  },
  accuracyBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
  },
  detectedAddressLinePrimary: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  detectedAddressLineSecondary: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  changeLocationButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  changeLocationButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  unresolvedLocationCard: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  unresolvedLocationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  unresolvedLocationTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  unresolvedLocationSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  unresolvedActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  unresolvedRetryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  unresolvedRetryButtonText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '700',
  },
  unresolvedMapButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  unresolvedMapButtonText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  unresolvedHelpText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  errorCard: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorTextContainer: {
    flex: 1,
  },
  errorText: {
    fontSize: 12,
    color: colors.dangerText,
    lineHeight: 16,
  },
  errorActionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  errorRetryButton: {
    alignSelf: 'flex-start',
  },
  errorRetryButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dangerText,
    textDecorationLine: 'underline',
  },
  errorDismissButton: {
    alignSelf: 'flex-start',
  },
  errorDismissButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  pickerOptionsContainer: {
    marginTop: spacing.xs,
  },
  currentLocationButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  currentLocationButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  mapPickerButton: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  mapPickerButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.sm,
  },
  formSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  rowFields: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flexHalf: {
    flex: 1,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: borderRadius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
  },
  checkboxLabel: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  bottomArea: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    backgroundColor: 'transparent',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    ...shadows.lg,
  },
  saveButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    backgroundColor: colors.textSubtle,
    shadowOpacity: 0,
    elevation: 0,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
