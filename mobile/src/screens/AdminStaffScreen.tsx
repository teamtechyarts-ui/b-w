import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  FacilityChoice,
  StaffRecord,
  StaffRole,
  activateAdminStaff,
  deactivateAdminStaff,
  listAdminFacilities,
  listAdminStaff,
  provisionAdminStaff,
  updateDriverPin,
} from '../services/adminStaffApi';
import AppIcon from '../components/AppIcon';
import IndianMobileInput from '../components/IndianMobileInput';
import { toIndianE164, validateIndianMobile } from '../utils/indianMobile';

type Props = {
  accessToken: string;
  onBack: () => void;
  onStaff: (profileId: string) => void;
};

export default function AdminStaffScreen({accessToken, onBack, onStaff}: Props) {
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [facilities, setFacilities] = useState<FacilityChoice[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [applied, setApplied] = useState({search: '', role: '', status: ''});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{fullName?: string; phone?: string; driverPin?: string; confirmDriverPin?: string; facilityId?: string}>({});
  const [success, setSuccess] = useState('');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('driver');
  const [facilityId, setFacilityId] = useState('');
  const [driverPin, setDriverPin] = useState('');
  const [confirmDriverPin, setConfirmDriverPin] = useState('');

  // Change PIN modal state
  const [pinModalStaff, setPinModalStaff] = useState<StaffRecord | null>(null);
  const [changePinValue, setChangePinValue] = useState('');
  const [confirmChangePinValue, setConfirmChangePinValue] = useState('');
  const [pinModalError, setPinModalError] = useState('');
  const [pinModalSaving, setPinModalSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [people, places] = await Promise.all([
        listAdminStaff(accessToken, applied),
        listAdminFacilities(accessToken),
      ]);
      setStaff(people);
      const activePlaces = places.filter(place => place.is_active);
      setFacilities(activePlaces);
      if (activePlaces.length === 1) {
        setFacilityId(activePlaces[0].id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Staff unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, applied]);

  useEffect(() => {
    load();
  }, [load]);

  const validateForm = () => {
    const errors: {fullName?: string; phone?: string; driverPin?: string; confirmDriverPin?: string; facilityId?: string} = {};
    const trimmedName = fullName.trim();

    if (!trimmedName) {
      errors.fullName = 'Full name is required.';
    } else if (trimmedName.length > 100) {
      errors.fullName = 'Full name must not exceed 100 characters.';
    }

    const phoneValidation = validateIndianMobile(phone);
    if (!phoneValidation.isValid) {
      errors.phone = phoneValidation.error;
    }

    if (!driverPin || !/^\d{6}$/.test(driverPin)) {
      errors.driverPin = `${newRole === 'driver' ? 'Driver' : 'Facility Employee'} PIN must be exactly 6 numeric digits.`;
    }
    if (confirmDriverPin !== driverPin) {
      errors.confirmDriverPin = 'PIN and confirmation do not match.';
    }

    if (newRole === 'facility_employee') {
      if (!facilities.length) {
        errors.facilityId = 'No active facilities available to assign.';
      } else if (!facilityId) {
        errors.facilityId = 'Assigned facility is required.';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const create = async () => {
    if (saving) return;
    setError('');
    setSuccess('');

    if (!validateForm()) {
      return;
    }

    setSaving(true);
    try {
      await provisionAdminStaff(accessToken, {
        phone: toIndianE164(phone),
        fullName: fullName.trim(),
        role: newRole,
        facilityId: newRole === 'facility_employee' ? facilityId : undefined,
        pin: driverPin.trim(),
      });
      setPhone('');
      setFullName('');
      setFacilityId('');
      setDriverPin('');
      setConfirmDriverPin('');
      setFieldErrors({});
      await load();
      setSuccess(`${newRole === 'driver' ? 'Driver' : 'Facility Employee'} account created successfully.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to create staff.';
      if (message.includes('409') || message.toLowerCase().includes('already exists')) {
        setError('This phone number is already registered to an existing account.');
      } else if (message.includes('403') || message.toLowerCase().includes('admin')) {
        setError('Administrator authorization required to provision staff.');
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePin = async () => {
    if (!pinModalStaff || pinModalSaving) return;
    setPinModalError('');

    if (!changePinValue || !/^\d{6}$/.test(changePinValue)) {
      setPinModalError('New PIN must be exactly 6 numeric digits.');
      return;
    }
    if (confirmChangePinValue !== changePinValue) {
      setPinModalError('PIN confirmation does not match.');
      return;
    }

    setPinModalSaving(true);
    try {
      await updateDriverPin(accessToken, pinModalStaff.profile_id, changePinValue.trim());
      const staffName = pinModalStaff.profiles?.full_name || 'Staff';
      setPinModalStaff(null);
      setChangePinValue('');
      setConfirmChangePinValue('');
      setSuccess(`Permanent PIN updated successfully for ${staffName}.`);
      await load();
    } catch (cause) {
      setPinModalError(cause instanceof Error ? cause.message : 'Failed to update PIN.');
    } finally {
      setPinModalSaving(false);
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'ST';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Navigation & Header */}
        <View style={styles.topBar}>
          <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Admin dashboard</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.pageHeader}>
          <Text style={styles.eyebrow}>B&W ADMIN · OPERATIONS</Text>
          <Text style={styles.title}>Driver and Facility staff</Text>
          <Text style={styles.subtitle}>
            Provision and manage field drivers and facility processing employees.
          </Text>
        </View>

        {/* Create Staff Form Card */}
        <View style={styles.formCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Text style={styles.cardTitle}>
                {newRole === 'driver' ? 'Create Driver' : 'Create Facility Employee'}
              </Text>
              <Text style={styles.cardSubtitle}>
                {newRole === 'driver'
                  ? 'Provision a verified delivery driver with mobile app access'
                  : 'Provision operational staff with assigned facility permissions'}
              </Text>
            </View>
            <View style={[styles.roleBadge, newRole === 'driver' ? styles.roleBadgeDriver : styles.roleBadgeFacility]}>
              <Text style={[styles.roleBadgeText, newRole === 'driver' ? styles.roleBadgeTextDriver : styles.roleBadgeTextFacility]}>
                {newRole.replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Role Selection Tabs */}
          <Text style={styles.sectionLabel}>STAFF ROLE</Text>
          <View style={styles.roleTabs}>
            {(['driver', 'facility_employee'] as const).map(value => {
              const isSelected = value === newRole;
              return (
                <TouchableOpacity
                  key={value}
                  accessibilityRole="button"
                  style={[styles.roleTab, isSelected && styles.roleTabActive]}
                  onPress={() => {
                    setNewRole(value);
                    setFieldErrors({});
                  }}>
                  <Text style={[styles.roleTabText, isSelected && styles.roleTabTextActive]}>
                    {value === 'driver' ? 'Driver' : 'Facility Employee'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Role Information Banner */}
          {newRole === 'driver' ? (
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerTitle}>Driver Operational Access</Text>
              <Text style={styles.infoBannerText}>
                Drivers are dispatched dynamically across orders and routes. Authentication uses a permanent 6-digit PIN.
              </Text>
            </View>
          ) : (
            <View style={styles.infoBannerNotice}>
              <Text style={styles.infoBannerTitleNotice}>Facility Binding Required</Text>
              <Text style={styles.infoBannerTextNotice}>
                Facility employees must be linked to an active processing facility and authenticate via permanent 6-digit PIN.
              </Text>
            </View>
          )}

          {/* Basic Information Section */}
          <View style={styles.formSection}>
            <Text style={styles.sectionLabel}>BASIC INFORMATION</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                Full Name <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <TextInput
                accessibilityLabel="Staff name"
                placeholder="e.g. Ramesh Patel"
                placeholderTextColor="#9CA3AF"
                value={fullName}
                onChangeText={text => {
                  setFullName(text);
                  if (fieldErrors.fullName) setFieldErrors(prev => ({...prev, fullName: undefined}));
                }}
                style={[styles.input, fieldErrors.fullName && styles.inputError]}
              />
              {fieldErrors.fullName ? (
                <Text style={styles.fieldErrorMessage}>{fieldErrors.fullName}</Text>
              ) : null}
            </View>

            <IndianMobileInput
              label="Mobile Number"
              required
              accessibilityLabel="Staff phone"
              value={phone}
              error={fieldErrors.phone}
              helperText="Enter 10-digit Indian mobile number. +91 is added automatically."
              onChangeText={(localDigits) => {
                setPhone(localDigits);
                if (fieldErrors.phone) setFieldErrors(prev => ({...prev, phone: undefined}));
              }}
            />

            {/* Facility Choice for Facility Employee */}
            {newRole === 'facility_employee' ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Assigned Facility <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                {facilities.length ? (
                  <View style={styles.facilityList}>
                    {facilities.map(place => {
                      const isSelected = place.id === facilityId;
                      return (
                        <TouchableOpacity
                          key={place.id}
                          accessibilityRole="button"
                          style={[styles.facilityOption, isSelected && styles.facilityOptionSelected]}
                          onPress={() => {
                            setFacilityId(place.id);
                            if (fieldErrors.facilityId) setFieldErrors(prev => ({...prev, facilityId: undefined}));
                          }}>
                          <Text style={[styles.facilityOptionText, isSelected && styles.facilityOptionTextSelected]}>
                            {place.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.emptyNotice}>No active facilities available.</Text>
                )}
                {fieldErrors.facilityId ? (
                  <Text style={styles.fieldErrorMessage}>{fieldErrors.facilityId}</Text>
                ) : null}
              </View>
            ) : null}

            {/* PIN Fields for Driver and Facility Employee */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {newRole === 'driver' ? 'Driver PIN (6 Digits)' : 'Facility Employee PIN (6 Digits)'} <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <TextInput
                accessibilityLabel={newRole === 'driver' ? 'Driver PIN' : 'Facility Employee PIN'}
                placeholder="Enter 6-digit access PIN (e.g. 482731)"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                value={driverPin}
                onChangeText={text => {
                  const cleaned = text.replace(/\D/g, '').slice(0, 6);
                  setDriverPin(cleaned);
                  if (fieldErrors.driverPin) setFieldErrors(prev => ({...prev, driverPin: undefined}));
                }}
                style={[styles.input, styles.pinInput, fieldErrors.driverPin && styles.inputError]}
              />
              {fieldErrors.driverPin ? (
                <Text style={styles.fieldErrorMessage}>{fieldErrors.driverPin}</Text>
              ) : (
                <Text style={styles.fieldHint}>Permanent 6-digit PIN used for sign in. No SMS OTP required.</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                Confirm {newRole === 'driver' ? 'Driver' : 'Facility Employee'} PIN <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <TextInput
                accessibilityLabel={newRole === 'driver' ? 'Confirm Driver PIN' : 'Confirm Facility Employee PIN'}
                placeholder="Re-enter 6-digit access PIN"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                value={confirmDriverPin}
                onChangeText={text => {
                  const cleaned = text.replace(/\D/g, '').slice(0, 6);
                  setConfirmDriverPin(cleaned);
                  if (fieldErrors.confirmDriverPin) setFieldErrors(prev => ({...prev, confirmDriverPin: undefined}));
                }}
                style={[styles.input, styles.pinInput, fieldErrors.confirmDriverPin && styles.inputError]}
              />
              {fieldErrors.confirmDriverPin ? (
                <Text style={styles.fieldErrorMessage}>{fieldErrors.confirmDriverPin}</Text>
              ) : null}
            </View>
          </View>

          {/* Status Feedback */}
          {error ? (
            <View style={styles.errorAlert} accessibilityRole="alert">
              <AppIcon name="alert" size={16} color="#DC2626" />
              <Text style={styles.errorAlertText}>{error}</Text>
            </View>
          ) : null}

          {success ? (
            <View style={styles.successAlert} accessibilityRole="alert">
              <AppIcon name="check" size={16} color="#059669" />
              <Text style={styles.successAlertText}>{success}</Text>
            </View>
          ) : null}

          {/* Submit Action */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Submit staff creation"
            disabled={
              saving ||
              !fullName.trim() ||
              !phone.trim() ||
              !driverPin ||
              driverPin.length !== 6 ||
              confirmDriverPin !== driverPin ||
              (newRole === 'facility_employee' && !facilityId)
            }
            style={[
              styles.submitButton,
              (saving ||
                !fullName.trim() ||
                !phone.trim() ||
                !driverPin ||
                driverPin.length !== 6 ||
                confirmDriverPin !== driverPin ||
                (newRole === 'facility_employee' && !facilityId)) &&
                styles.submitButtonDisabled,
            ]}
            onPress={create}>
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>
                {newRole === 'driver' ? 'Create Driver' : 'Create Facility Employee'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Staff Directory & Filters Card */}
        <View style={styles.directoryCard}>
          <View style={styles.directoryHeader}>
            <View>
              <Text style={styles.cardTitle}>Staff Directory</Text>
              <Text style={styles.cardSubtitle}>
                {staff.length} operational {staff.length === 1 ? 'member' : 'members'} registered
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry staff"
              style={styles.refreshIconBtn}
              onPress={() => load()}>
              <Text style={styles.link}>Retry staff</Text>
            </TouchableOpacity>
          </View>

          {/* Search Input */}
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel="Search staff"
              placeholder="Search by name or phone…"
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
              style={[styles.input, styles.searchInput]}
            />
          </View>

          {/* Filter Pills */}
          <View style={styles.filtersSection}>
            <View style={styles.filterGroup}>
              <Text style={styles.filterGroupLabel}>Role:</Text>
              <View style={styles.filterPills}>
                {(['', 'driver', 'facility_employee'] as const).map(value => {
                  const isSelected = value === roleFilter;
                  return (
                    <TouchableOpacity
                      key={value}
                      accessibilityRole="button"
                      style={[styles.filterPill, isSelected && styles.filterPillSelected]}
                      onPress={() => setRoleFilter(value)}>
                      <Text style={[styles.filterPillText, isSelected && styles.filterPillTextSelected]}>
                        {value ? (value === 'driver' ? 'Driver' : 'Facility Employee') : 'All'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterGroup}>
              <Text style={styles.filterGroupLabel}>Status:</Text>
              <View style={styles.filterPills}>
                {['', 'active', 'inactive'].map(value => {
                  const isSelected = value === statusFilter;
                  return (
                    <TouchableOpacity
                      key={value}
                      accessibilityRole="button"
                      style={[styles.filterPill, isSelected && styles.filterPillSelected]}
                      onPress={() => setStatusFilter(value)}>
                      <Text style={[styles.filterPillText, isSelected && styles.filterPillTextSelected]}>
                        {value ? (value === 'active' ? 'Active' : 'Disabled') : 'All'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              style={styles.searchApplyButton}
              onPress={() => setApplied({search, role: roleFilter, status: statusFilter})}>
              <Text style={styles.searchApplyButtonText}>Search staff</Text>
            </TouchableOpacity>
          </View>

          {/* Loading Indicator */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator accessibilityLabel="Loading staff" color="#2563EB" size="large" />
              <Text style={styles.loadingText}>Loading staff directory…</Text>
            </View>
          ) : null}

          {/* Empty State */}
          {!loading && !staff.length ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No staff found.</Text>
              <Text style={styles.emptySubtitle}>No records match the current search or filters.</Text>
            </View>
          ) : null}

          {/* Staff Member Cards */}
          {!loading && staff.length ? (
            <View style={styles.staffGrid}>
              {staff.map(person => {
                const name = person.profiles?.full_name || 'Staff';
                const phoneNum = person.profiles?.phone || 'No phone recorded';
                const isActive = Boolean(person.profiles?.is_active);
                const isDriver = person.role === 'driver';

                return (
                  <View key={person.profile_id} style={styles.staffCard}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.staffCardTop}
                      onPress={() => onStaff(person.profile_id)}>
                      <View style={[styles.avatarCircle, isDriver ? styles.avatarDriver : styles.avatarFacility]}>
                        <Text style={[styles.avatarText, isDriver ? styles.avatarTextDriver : styles.avatarTextFacility]}>
                          {getInitials(name)}
                        </Text>
                      </View>
                      <View style={styles.staffInfoCol}>
                        <Text style={styles.staffName}>{name}</Text>
                        <Text style={styles.staffPhone}>{phoneNum}</Text>
                      </View>
                      <View style={styles.badgeCol}>
                        <View style={[styles.statusPill, isActive ? styles.statusPillActive : styles.statusPillInactive]}>
                          <View style={[styles.statusDot, isActive ? styles.statusDotActive : styles.statusDotInactive]} />
                          <Text style={[styles.statusPillText, isActive ? styles.statusPillTextActive : styles.statusPillTextInactive]}>
                            {isActive ? 'Active' : 'Disabled'}
                          </Text>
                        </View>
                        <View style={[styles.rolePill, isDriver ? styles.rolePillDriver : styles.rolePillFacility]}>
                          <Text style={[styles.rolePillText, isDriver ? styles.rolePillTextDriver : styles.rolePillTextFacility]}>
                            {person.role.replace(/_/g, ' ')}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.changePinBtn}
                        onPress={e => {
                          e.stopPropagation?.();
                          setPinModalStaff(person);
                          setChangePinValue('');
                          setConfirmChangePinValue('');
                          setPinModalError('');
                        }}>
                        <Text style={styles.changePinBtnText}>Change PIN</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={[styles.statusToggleBtn, isActive ? styles.deactivateBtn : styles.activateBtn]}
                        onPress={async e => {
                          e.stopPropagation?.();
                          setError('');
                          setSuccess('');
                          try {
                            if (isActive) {
                              await deactivateAdminStaff(accessToken, person.profile_id);
                              setSuccess(`Deactivated ${name}.`);
                            } else {
                              await activateAdminStaff(accessToken, person.profile_id);
                              setSuccess(`Activated ${name}.`);
                            }
                            await load();
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : 'Staff status update failed.');
                          }
                        }}>
                        <Text style={[styles.statusToggleBtnText, isActive ? styles.deactivateBtnText : styles.activateBtnText]}>
                          {isActive ? 'Deactivate' : 'Activate'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.staffCardBottom}
                      onPress={() => onStaff(person.profile_id)}>
                      <Text style={styles.assignmentMeta}>
                        {isDriver
                          ? 'Operational dispatch · Active pickup & delivery'
                          : person.facilities?.name ? `Assigned to: ${person.facilities.name}` : 'No assigned facility'}
                      </Text>
                      <Text style={styles.cardArrow}>Manage ›</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Change PIN Modal */}
      {pinModalStaff ? (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Change {pinModalStaff.role === 'driver' ? 'Driver' : 'Facility Employee'} PIN
            </Text>
            <View style={styles.modalDriverInfo}>
              <Text style={styles.modalDriverInfoText}>
                <Text style={styles.bold}>Staff: </Text>
                {pinModalStaff.profiles?.full_name || 'Staff Member'}
              </Text>
              <Text style={styles.modalDriverInfoText}>
                <Text style={styles.bold}>Phone: </Text>
                {pinModalStaff.profiles?.phone || 'Not recorded'}
              </Text>
              {pinModalStaff.facilities?.name ? (
                <Text style={styles.modalDriverInfoText}>
                  <Text style={styles.bold}>Facility: </Text>
                  {pinModalStaff.facilities.name}
                </Text>
              ) : null}
            </View>

            {pinModalError ? (
              <View style={styles.modalErrorAlert}>
                <Text style={styles.modalErrorText}>{pinModalError}</Text>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                New {pinModalStaff.role === 'driver' ? 'Driver' : 'Facility Employee'} PIN *
              </Text>
              <TextInput
                accessibilityLabel="New PIN"
                placeholder="6-digit PIN"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                value={changePinValue}
                onChangeText={text => setChangePinValue(text.replace(/\D/g, '').slice(0, 6))}
                style={[styles.input, styles.pinInput]}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Confirm New PIN *</Text>
              <TextInput
                accessibilityLabel="Confirm New PIN"
                placeholder="6-digit PIN"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                value={confirmChangePinValue}
                onChangeText={text => setConfirmChangePinValue(text.replace(/\D/g, '').slice(0, 6))}
                style={[styles.input, styles.pinInput]}
              />
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.modalCancelBtn}
                disabled={pinModalSaving}
                onPress={() => {
                  setPinModalStaff(null);
                  setPinModalError('');
                }}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                style={[
                  styles.modalSubmitBtn,
                  (!changePinValue || !confirmChangePinValue || pinModalSaving) && styles.submitButtonDisabled,
                ]}
                disabled={!changePinValue || !confirmChangePinValue || pinModalSaving}
                onPress={handleUpdatePin}>
                {pinModalSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Update PIN</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 24,
    gap: 20,
    maxWidth: 960,
    alignSelf: 'center',
    width: '100%',
  },
  topBar: {
    marginBottom: 4,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
  },
  pageHeader: {
    marginBottom: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#6B7280',
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#4B5563',
    marginTop: 4,
    lineHeight: 20,
  },

  // Form Card
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  cardHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  roleBadgeDriver: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  roleBadgeFacility: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  roleBadgeTextDriver: {
    color: '#1D4ED8',
  },
  roleBadgeTextFacility: {
    color: '#15803D',
  },

  // Role selection tabs
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#6B7280',
    marginTop: 4,
  },
  roleTabs: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  roleTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleTabActive: {
    backgroundColor: '#111827',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  roleTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  roleTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Banners
  infoBanner: {
    backgroundColor: '#F0F9FF',
    borderLeftWidth: 4,
    borderLeftColor: '#0284C7',
    borderRadius: 8,
    padding: 12,
  },
  infoBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
    marginBottom: 2,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#0C4A6E',
    lineHeight: 18,
  },
  infoBannerNotice: {
    backgroundColor: '#FEFCE8',
    borderLeftWidth: 4,
    borderLeftColor: '#CA8A04',
    borderRadius: 8,
    padding: 12,
  },
  infoBannerTitleNotice: {
    fontSize: 13,
    fontWeight: '700',
    color: '#854D0E',
    marginBottom: 2,
  },
  infoBannerTextNotice: {
    fontSize: 12,
    color: '#713F12',
    lineHeight: 18,
  },

  // Form Fields
  formSection: {
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  requiredAsterisk: {
    color: '#DC2626',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  inputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  fieldErrorMessage: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  fieldHint: {
    fontSize: 12,
    color: '#6B7280',
  },
  facilityList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  facilityOption: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  facilityOptionSelected: {
    backgroundColor: '#1E40AF',
    borderColor: '#1E40AF',
  },
  facilityOptionText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '600',
  },
  facilityOptionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  emptyNotice: {
    fontSize: 13,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },

  // Alerts
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
  },
  errorIcon: {
    color: '#DC2626',
    fontSize: 16,
    fontWeight: '700',
  },
  errorAlertText: {
    flex: 1,
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '600',
  },
  successAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 8,
  },
  successIcon: {
    color: '#16A34A',
    fontSize: 16,
    fontWeight: '700',
  },
  successAlertText: {
    flex: 1,
    fontSize: 13,
    color: '#15803D',
    fontWeight: '600',
  },

  // Button
  submitButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  submitButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Directory Card
  directoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: 16,
  },
  directoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  refreshIconBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  searchRow: {
    width: '100%',
  },
  searchInput: {
    backgroundColor: '#F9FAFB',
  },

  // Filter Pills
  filtersSection: {
    gap: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  filterGroupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    minWidth: 50,
  },
  filterPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  filterPillSelected: {
    backgroundColor: '#1E40AF',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  filterPillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchApplyButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 4,
  },
  searchApplyButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Loading & Empty
  loadingContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
  },
  emptyContainer: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
  },

  // Staff Grid & Cards
  staffGrid: {
    gap: 12,
  },
  staffCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  staffCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarDriver: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  avatarFacility: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  avatarTextDriver: {
    color: '#1D4ED8',
  },
  avatarTextFacility: {
    color: '#15803D',
  },
  staffInfoCol: {
    flex: 1,
  },
  staffName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  staffPhone: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  badgeCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillActive: {
    backgroundColor: '#ECFDF5',
  },
  statusPillInactive: {
    backgroundColor: '#F3F4F6',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: '#10B981',
  },
  statusDotInactive: {
    backgroundColor: '#9CA3AF',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPillTextActive: {
    color: '#047857',
  },
  statusPillTextInactive: {
    color: '#4B5563',
  },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rolePillDriver: {
    backgroundColor: '#EFF6FF',
  },
  rolePillFacility: {
    backgroundColor: '#F3F4F6',
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  rolePillTextDriver: {
    color: '#1D4ED8',
  },
  rolePillTextFacility: {
    color: '#4B5563',
  },
  staffCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  assignmentMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
  cardArrow: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  pinInput: {
    letterSpacing: 4,
    fontSize: 18,
    fontWeight: '600',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusToggleBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  deactivateBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  activateBtn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  statusToggleBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deactivateBtnText: {
    color: '#DC2626',
  },
  activateBtnText: {
    color: '#059669',
  },
  changePinBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#0F172A',
    borderRadius: 6,
  },
  changePinBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 480,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalDriverInfo: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalDriverInfoText: {
    fontSize: 14,
    color: '#334155',
  },
  modalErrorAlert: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 10,
  },
  modalErrorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  modalSubmitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bold: {
    fontWeight: '700',
  },
});
