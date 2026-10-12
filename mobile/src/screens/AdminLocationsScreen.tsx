import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  AdminLocation,
  addAdminFacilityPincode,
  createAdminLocation,
  deleteAdminLocation,
  listAdminLocations,
  removeAdminFacilityPincode,
  updateAdminLocation,
} from '../services/adminFacilityOversightApi';
import AppIcon from '../components/AppIcon';

type Props = {
  accessToken: string;
  onBack: () => void;
};

type FormState = {
  id?: string;
  name: string;
  address: string;
  isActive: boolean;
};

const initialFormState: FormState = {
  name: '',
  address: '',
  isActive: true,
};

export default function AdminLocationsScreen({accessToken, onBack}: Props) {
  const [locations, setLocations] = useState<AdminLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Modal states for Location Add/Edit
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingLocation, setEditingLocation] = useState<AdminLocation | null>(null);
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Pincode modal states
  const [pincodeModalVisible, setPincodeModalVisible] = useState(false);
  const [targetFacilityForPincode, setTargetFacilityForPincode] = useState<AdminLocation | null>(null);
  const [newPincodeText, setNewPincodeText] = useState('');
  const [pincodeError, setPincodeError] = useState('');
  const [addingPincode, setAddingPincode] = useState(false);

  // Delete modal state
  const [deletingLocation, setDeletingLocation] = useState<AdminLocation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const data = await listAdminLocations(accessToken);
        setLocations(data);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load laundry locations.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    load();
  }, [load]);

  const openAddModal = () => {
    setEditingLocation(null);
    setFormState(initialFormState);
    setFormError('');
    setFormModalVisible(true);
  };

  const openEditModal = (item: AdminLocation) => {
    setEditingLocation(item);
    setFormState({
      id: item.id,
      name: item.name,
      address: item.address || '',
      isActive: item.isActive,
    });
    setFormError('');
    setFormModalVisible(true);
  };

  const handleSave = async () => {
    setFormError('');
    const name = formState.name.trim();
    const address = formState.address.trim();

    if (!name) {
      setFormError('Location name is required.');
      return;
    }
    if (!address) {
      setFormError('Address is required.');
      return;
    }

    setSaving(true);
    try {
      if (editingLocation) {
        await updateAdminLocation(accessToken, editingLocation.id, {
          name,
          address,
          isActive: formState.isActive,
        });
        setSuccessMessage(`Location "${name}" updated successfully.`);
      } else {
        await createAdminLocation(accessToken, {
          name,
          address,
          isActive: formState.isActive,
        });
        setSuccessMessage(`Location "${name}" added successfully.`);
      }
      setFormModalVisible(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save location.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (loc: AdminLocation) => {
    try {
      const nextStatus = !loc.isActive;
      await updateAdminLocation(accessToken, loc.id, {isActive: nextStatus});
      setSuccessMessage(`Location "${loc.name}" ${nextStatus ? 'activated' : 'deactivated'}.`);
      load();
    } catch (e) {
      Alert.alert('Update Failed', e instanceof Error ? e.message : 'Could not change location status.');
    }
  };

  const confirmDelete = async () => {
    if (!deletingLocation) return;
    setDeleting(true);
    try {
      const result = await deleteAdminLocation(accessToken, deletingLocation.id);
      setDeletingLocation(null);
      setSuccessMessage(result.message || (result.archived ? 'Location archived.' : 'Location deleted.'));
      load();
    } catch (e) {
      Alert.alert('Action Failed', e instanceof Error ? e.message : 'Could not remove location.');
    } finally {
      setDeleting(false);
    }
  };

  const openAddPincodeModal = (item: AdminLocation) => {
    setTargetFacilityForPincode(item);
    setNewPincodeText('');
    setPincodeError('');
    setPincodeModalVisible(true);
  };

  const handleAddPincode = async () => {
    if (!targetFacilityForPincode) return;
    const cleanPincode = newPincodeText.trim();
    if (!/^\d{6}$/.test(cleanPincode)) {
      setPincodeError('Pincode must be exactly 6 numeric digits.');
      return;
    }

    if ((targetFacilityForPincode.pincodes || []).includes(cleanPincode)) {
      setPincodeError(`Pincode ${cleanPincode} is already added to this facility.`);
      return;
    }

    setAddingPincode(true);
    setPincodeError('');
    try {
      await addAdminFacilityPincode(accessToken, targetFacilityForPincode.id, cleanPincode);
      setSuccessMessage(`Pincode ${cleanPincode} added to "${targetFacilityForPincode.name}".`);
      setPincodeModalVisible(false);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add pincode.';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('duplicate') || msg.includes('23505')) {
        setPincodeError('Pincode already exists for this laundry location.');
      } else {
        setPincodeError(msg);
      }
    } finally {
      setAddingPincode(false);
    }
  };

  const handleRemovePincode = (location: AdminLocation, pincode: string) => {
    Alert.alert(
      'Remove Pincode',
      `Are you sure you want to remove serviceable pincode "${pincode}" from ${location.name}? Customers in this pincode will no longer be served by this facility.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeAdminFacilityPincode(accessToken, location.id, pincode);
              setSuccessMessage(`Pincode ${pincode} removed from "${location.name}".`);
              load();
            } catch (e) {
              Alert.alert('Remove Pincode Failed', e instanceof Error ? e.message : 'Could not remove pincode.');
            }
          },
        },
      ],
    );
  };

  const renderLocationCard = ({item}: {item: AdminLocation}) => {
    const pincodes = item.pincodes || [];

    return (
      <View style={styles.card} testID={`location-card-${item.id}`}>
        {/* Top row: Name + Active Status Badge */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.locationName} numberOfLines={2}>
              {item.name}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              item.isActive ? styles.statusBadgeActive : styles.statusBadgeInactive,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                item.isActive ? styles.statusDotActive : styles.statusDotInactive,
              ]}
            />
            <Text
              style={[
                styles.statusBadgeText,
                item.isActive ? styles.statusTextActive : styles.statusTextInactive,
              ]}
            >
              {item.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>

        {/* Human-readable Address */}
        <Text style={styles.addressText} numberOfLines={3}>
          {item.address || 'Address not specified'}
        </Text>

        {/* Serviceable Pincodes Section */}
        <View style={styles.pincodesSection}>
          <View style={styles.pincodesHeader}>
            <Text style={styles.pincodesTitle}>
              Serviceable Pincodes ({pincodes.length})
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.btnAddPincodeSmall}
              onPress={() => openAddPincodeModal(item)}
            >
              <Text style={styles.btnAddPincodeSmallText}>+ Add Pincode</Text>
            </TouchableOpacity>
          </View>

          {pincodes.length > 0 ? (
            <View style={styles.pincodeChipsContainer}>
              {pincodes.map((pin: string) => (
                <View key={pin} style={styles.pincodeChip}>
                  <Text style={styles.pincodeChipText}>{pin}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Remove pincode ${pin}`}
                    style={styles.pincodeChipRemove}
                    onPress={() => handleRemovePincode(item, pin)}
                  >
                    <AppIcon name="close" size={10} color="#6B7280" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noPincodesText}>
              No serviceable pincodes assigned. Customers in all pincodes will be unserviceable.
            </Text>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.btnAction, styles.btnEdit]}
            onPress={() => openEditModal(item)}
          >
            <Text style={styles.btnEditText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.btnAction,
              item.isActive ? styles.btnDeactivate : styles.btnActivate,
            ]}
            onPress={() => handleToggleActive(item)}
          >
            <Text
              style={[
                styles.btnActionText,
                item.isActive ? styles.btnDeactivateText : styles.btnActivateText,
              ]}
            >
              {item.isActive ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.btnAction, styles.btnDelete]}
            onPress={() => setDeletingLocation(item)}
          >
            <Text style={styles.btnDeleteText}>Delete / Archive</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.page}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>‹ Admin</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            style={styles.btnAdd}
            onPress={openAddModal}
          >
            <Text style={styles.btnAddText}>+ Add Location</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.title}>Laundry Locations</Text>
            <Text style={styles.subtitle}>
              {locations.length} {locations.length === 1 ? 'facility' : 'facilities'} configured for pincode serviceability
            </Text>
          </View>
        </View>
      </View>

      {/* Notifications / Alerts */}
      {successMessage ? (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{successMessage}</Text>
          <TouchableOpacity onPress={() => setSuccessMessage('')}>
            <AppIcon name="close" size={14} color="#065F46" />
          </TouchableOpacity>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load()}>
            <Text style={styles.retryLink}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Main List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1A1A1A" />
          <Text style={styles.loadingText}>Loading laundry locations...</Text>
        </View>
      ) : (
        <FlatList
          data={locations}
          keyExtractor={item => item.id}
          renderItem={renderLocationCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AppIcon name="facility" size={32} color="#9CA3AF" />
              <Text style={styles.emptyTitle}>No laundry locations found</Text>
              <Text style={styles.emptySubtitle}>
                Add your first processing facility and configure its serviceable pincodes.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.btnAdd, {marginTop: 16}]}
                onPress={openAddModal}
              >
                <Text style={styles.btnAddText}>+ Add Laundry Location</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Add / Edit Location Modal */}
      <Modal
        visible={formModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setFormModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingLocation ? 'Edit Laundry Location' : 'Add Laundry Location'}
              </Text>
              <TouchableOpacity
                onPress={() => setFormModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <AppIcon name="close" size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {formError ? (
              <View style={styles.modalErrorBanner}>
                <Text style={styles.modalErrorText}>{formError}</Text>
              </View>
            ) : null}

            <ScrollView
              contentContainerStyle={styles.formBody}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* 1. Location Name */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  Location Name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  testID="input-location-name"
                  style={styles.input}
                  placeholder="e.g. Central Laundry Facility"
                  placeholderTextColor="#999"
                  value={formState.name}
                  onChangeText={name => setFormState(prev => ({...prev, name}))}
                />
              </View>

              {/* 2. Address */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  Address <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  testID="input-location-address"
                  style={[styles.input, styles.multilineInput]}
                  placeholder="e.g. Plot 10, HITEC City, Hyderabad, Telangana"
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={3}
                  value={formState.address}
                  onChangeText={address => setFormState(prev => ({...prev, address}))}
                />
                <Text style={styles.helperText}>
                  Human-readable pickup and processing facility address.
                </Text>
              </View>

              {/* 3. Serviceable Pincodes (in Edit Mode) */}
              {editingLocation ? (
                <View style={styles.editPincodesSection}>
                  <View style={styles.pincodesHeader}>
                    <Text style={styles.label}>
                      Serviceable Pincodes ({editingLocation.pincodes?.length || 0})
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.btnAddPincodeSmall}
                      onPress={() => {
                        setFormModalVisible(false);
                        openAddPincodeModal(editingLocation);
                      }}
                    >
                      <Text style={styles.btnAddPincodeSmallText}>+ Add Pincode</Text>
                    </TouchableOpacity>
                  </View>

                  {(editingLocation.pincodes || []).length > 0 ? (
                    <View style={styles.pincodeChipsContainer}>
                      {(editingLocation.pincodes || []).map((pin: string) => (
                        <View key={pin} style={styles.pincodeChip}>
                          <Text style={styles.pincodeChipText}>{pin}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.noPincodesText}>
                      No serviceable pincodes assigned yet.
                    </Text>
                  )}
                </View>
              ) : null}

              {/* 4. Active Status Toggle */}
              <View style={styles.activeToggleRow}>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleLabel}>Active Status</Text>
                  <Text style={styles.toggleSub}>
                    {formState.isActive
                      ? 'Location is open and serving customer orders.'
                      : 'Location is currently inactive and will not receive customer orders.'}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.toggleButton,
                    formState.isActive ? styles.toggleActive : styles.toggleInactive,
                  ]}
                  onPress={() => setFormState(prev => ({...prev, isActive: !prev.isActive}))}
                >
                  <Text
                    style={[
                      styles.toggleButtonText,
                      formState.isActive ? styles.toggleActiveText : styles.toggleInactiveText,
                    ]}
                  >
                    {formState.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() => setFormModalVisible(false)}
                disabled={saving}
              >
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="btn-submit-location"
                accessibilityRole="button"
                style={[styles.btnSubmit, saving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnSubmitText}>
                    {editingLocation ? 'Save Changes' : 'Create Location'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete / Archive Confirmation Modal */}
      <Modal
        visible={!!deletingLocation}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setDeletingLocation(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <Text style={styles.deleteModalTitle}>Remove Location?</Text>
            <Text style={styles.deleteModalBody}>
              Are you sure you want to remove &quot;{deletingLocation?.name}&quot;?
              {'\n\n'}
              If this location has historical orders, it will be safely archived and deactivated to protect order integrity.
            </Text>

            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() => setDeletingLocation(null)}
                disabled={deleting}
              >
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnDeleteConfirm, deleting && styles.btnDisabled]}
                onPress={confirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnDeleteConfirmText}>Delete / Archive</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Pincode Modal */}
      <Modal
        visible={pincodeModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setPincodeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            <View style={styles.pincodeModalContent}>
              <Text style={styles.pincodeModalTitle}>
                Add Serviceable Pincode
              </Text>
              <Text style={styles.pincodeModalSubtitle}>
                Facility: {targetFacilityForPincode?.name}
              </Text>

              {pincodeError ? (
                <Text style={styles.formErrorText}>{pincodeError}</Text>
              ) : null}

              <Text style={styles.inputLabel}>6-Digit Pincode *</Text>
              <TextInput
                style={styles.pincodeTextInput}
                placeholder="e.g. 500068"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                maxLength={6}
                value={newPincodeText}
                onChangeText={setNewPincodeText}
                autoFocus
              />

              <View style={styles.pincodeModalActions}>
                <TouchableOpacity
                  style={styles.btnCancel}
                  onPress={() => setPincodeModalVisible(false)}
                  disabled={addingPincode}
                >
                  <Text style={styles.btnCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnSubmit, addingPincode && styles.btnDisabled]}
                  onPress={handleAddPincode}
                  disabled={addingPincode}
                >
                  {addingPincode ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.btnSubmitText}>Add Pincode</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E3DB',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  btnAdd: {
    backgroundColor: '#151515',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnAddText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  headerTitleRow: {
    marginTop: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#151515',
  },
  subtitle: {
    fontSize: 13,
    color: '#67635B',
    marginTop: 2,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    borderColor: '#C8E6C9',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
  },
  successText: {
    color: '#2E7D32',
    fontWeight: '600',
    fontSize: 13,
    flex: 1,
  },
  closeAlert: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '700',
    marginLeft: 8,
    padding: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFEBEE',
    borderColor: '#FFCDD2',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    color: '#C62828',
    fontWeight: '600',
    fontSize: 13,
    flex: 1,
  },
  retryLink: {
    color: '#C62828',
    fontWeight: '800',
    fontSize: 13,
    textDecorationLine: 'underline',
    marginLeft: 8,
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#67635B',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 36,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6E3DB',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardHeaderLeft: {
    flex: 1,
  },
  locationName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#151515',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  statusBadgeActive: {
    backgroundColor: '#E8F5E9',
  },
  statusBadgeInactive: {
    backgroundColor: '#F5F5F5',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: '#2E7D32',
  },
  statusDotInactive: {
    backgroundColor: '#9E9E9E',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextActive: {
    color: '#2E7D32',
  },
  statusTextInactive: {
    color: '#757575',
  },
  addressText: {
    fontSize: 13,
    color: '#4B4842',
    marginTop: 6,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EFEA',
  },
  btnAction: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnEdit: {
    backgroundColor: '#F0EFEA',
  },
  btnEditText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#151515',
  },
  btnActivate: {
    backgroundColor: '#E8F5E9',
  },
  btnActivateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E7D32',
  },
  btnDeactivate: {
    backgroundColor: '#FFF3E0',
  },
  btnDeactivateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E65100',
  },
  btnActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  btnDelete: {
    backgroundColor: '#FFEBEE',
  },
  btnDeleteText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C62828',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6E3DB',
    marginTop: 20,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#151515',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#67635B',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 24,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EAE8E2',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#151515',
  },
  modalCloseBtn: {
    padding: 8,
    minHeight: 40,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 16,
    color: '#777',
    fontWeight: '700',
  },
  modalErrorBanner: {
    backgroundColor: '#FFEBEE',
    padding: 10,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 8,
  },
  modalErrorText: {
    color: '#C62828',
    fontSize: 12,
    fontWeight: '600',
  },
  formBody: {
    padding: 20,
    gap: 16,
  },
  formGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#33312B',
  },
  required: {
    color: '#D32F2F',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D4D0C8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#151515',
    backgroundColor: '#FAFAF8',
    minHeight: 44,
  },
  multilineInput: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 11,
    color: '#77736C',
    marginTop: 2,
  },
  editPincodesSection: {
    backgroundColor: '#FAF9F6',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E6E3DB',
    gap: 8,
  },
  activeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F7F6F2',
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
    gap: 12,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#151515',
  },
  toggleSub: {
    fontSize: 11,
    color: '#67635B',
    marginTop: 2,
  },
  toggleButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#E8F5E9',
    borderColor: '#C8E6C9',
    borderWidth: 1,
  },
  toggleInactive: {
    backgroundColor: '#EEEEEE',
    borderColor: '#E0E0E0',
    borderWidth: 1,
  },
  toggleButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toggleActiveText: {
    color: '#2E7D32',
  },
  toggleInactiveText: {
    color: '#757575',
  },
  modalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#EAE8E2',
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D4D0C8',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#55524B',
  },
  btnSubmit: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnSubmitText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deleteModalContent: {
    backgroundColor: '#FFFFFF',
    margin: 24,
    borderRadius: 16,
    padding: 20,
    alignSelf: 'center',
    width: '90%',
    maxWidth: 380,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#C62828',
    marginBottom: 8,
  },
  deleteModalBody: {
    fontSize: 13,
    color: '#4B4842',
    lineHeight: 18,
    marginBottom: 20,
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  btnDeleteConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#C62828',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnDeleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pincodesSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EFEA',
  },
  pincodesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pincodesTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333333',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  btnAddPincodeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F0F0EE',
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnAddPincodeSmallText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#151515',
  },
  pincodeChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pincodeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderColor: '#C8E6C9',
    borderWidth: 1,
    borderRadius: 6,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
  },
  pincodeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E7D32',
    marginRight: 4,
  },
  pincodeChipRemove: {
    padding: 3,
    minHeight: 24,
    minWidth: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pincodeChipRemoveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#757575',
  },
  noPincodesText: {
    fontSize: 11,
    color: '#88857D',
    fontStyle: 'italic',
  },
  pincodeModalContent: {
    backgroundColor: '#FFFFFF',
    margin: 20,
    borderRadius: 16,
    padding: 20,
    width: '90%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  pincodeModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#151515',
    marginBottom: 4,
  },
  pincodeModalSubtitle: {
    fontSize: 12,
    color: '#66635C',
    marginBottom: 16,
  },
  pincodeTextInput: {
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#D8D4CC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#151515',
    fontWeight: '600',
    minHeight: 44,
  },
  pincodeModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B4842',
    marginBottom: 6,
  },
  formErrorText: {
    fontSize: 12,
    color: '#C62828',
    marginBottom: 10,
    fontWeight: '600',
  },
  keyboardAvoid: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
