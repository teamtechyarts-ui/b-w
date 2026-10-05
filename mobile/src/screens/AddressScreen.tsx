import React, {useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type {AddressItem} from '../types/address';
import CheckoutProgressBar from '../components/CheckoutProgressBar';
import AppIcon from '../components/AppIcon';

type AddressScreenProps = {
  manageOnly?: boolean;
  addresses: AddressItem[];
  loading: boolean;
  saving: boolean;
  selectedAddressId: string | null;
  selectedAddress: AddressItem | null;

  onBack: () => void;
  onSelectAddress: (addressId: string) => void;
  onAddAddress: () => void;
  onEditAddress: (address: AddressItem) => void;
  onSetDefaultAddress: (address: AddressItem) => void;
  onDeleteAddress: (
    address: AddressItem,
  ) =>
    | Promise<{success: boolean; error?: string; inUse?: boolean} | boolean | void>
    | void;
  onContinue: () => void;
};

export default function AddressScreen({
  manageOnly = false,
  addresses,
  loading,
  saving,
  selectedAddressId,
  selectedAddress,
  onBack,
  onSelectAddress,
  onAddAddress,
  onEditAddress,
  onSetDefaultAddress,
  onDeleteAddress,
  onContinue,
}: AddressScreenProps) {
  const [deletingTarget, setDeletingTarget] = useState<AddressItem | null>(null);
  const [deletingInProgress, setDeletingInProgress] = useState(false);
  const [errorModal, setErrorModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
  } | null>(null);

  const handleStartDelete = (address: AddressItem) => {
    if (saving || deletingInProgress) return;
    setDeletingTarget(address);
  };

  const handleConfirmDelete = async () => {
    if (!deletingTarget || deletingInProgress) return;
    const target = deletingTarget;
    setDeletingInProgress(true);

    try {
      const result = await onDeleteAddress(target);

      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        setDeletingTarget(null);
        const errMsg = result.error || '';
        const inUse =
          result.inUse ||
          errMsg.toLowerCase().includes('existing order') ||
          errMsg.toLowerCase().includes('used by an existing order');

        if (inUse) {
          setErrorModal({
            visible: true,
            title: "Address Can't Be Deleted",
            message:
              'This address is linked to an existing order, so it cannot be deleted.',
          });
        } else {
          setErrorModal({
            visible: true,
            title: "Address Can't Be Deleted",
            message: errMsg || 'Unable to delete address right now.',
          });
        }
      } else {
        // Successful delete
        setDeletingTarget(null);
      }
    } catch (err: any) {
      setDeletingTarget(null);
      const rawMessage = err?.message || 'Unable to delete address right now.';
      const inUse =
        rawMessage.toLowerCase().includes('existing order') ||
        rawMessage.toLowerCase().includes('used by an existing order');

      setErrorModal({
        visible: true,
        title: "Address Can't Be Deleted",
        message: inUse
          ? 'This address is linked to an existing order, so it cannot be deleted.'
          : rawMessage,
      });
    } finally {
      setDeletingInProgress(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.screenContainer}>
        <View style={styles.pageHeader}>
          <TouchableOpacity
            style={styles.pageBackTouchable}
            disabled={saving || deletingInProgress}
            onPress={onBack}>
            <Text style={styles.pageBack}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.pageHeaderTitle}>
            {manageOnly ? 'Saved Addresses' : 'Pickup Address'}
          </Text>

          <View style={styles.headerSpacer} />
        </View>

        {!manageOnly ? (
          <CheckoutProgressBar currentStep="address" />
        ) : null}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#111111" />
            <Text style={styles.loadingText}>Loading addresses...</Text>
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {!manageOnly ? (
                <View style={styles.checkoutStep}>
                  <Text style={styles.checkoutStepNumber}>1</Text>
                  <View style={styles.flex}>
                    <Text style={styles.checkoutStepTitle}>
                      Select pickup address
                    </Text>
                    <Text style={styles.checkoutStepText}>
                      Your driver will collect the laundry from this location.
                    </Text>
                  </View>
                </View>
              ) : null}

              {addresses.length === 0 ? (
                <View style={styles.noAddressCard}>
                  <AppIcon name="location" size={28} color="#6B7280" />
                  <Text style={styles.noAddressTitle}>No saved addresses</Text>
                  <Text style={styles.noAddressText}>
                    Add your pickup address to continue.
                  </Text>
                </View>
              ) : (
                addresses.map(address => {
                  const selected = address.id === selectedAddressId;
                  const hasLabel = Boolean(
                    address.label &&
                      address.label.trim() &&
                      address.label.trim().toLowerCase() !== 'null' &&
                      address.label.trim().toLowerCase() !== 'undefined',
                  );
                  const addressLine1 = (address.address_line1 || '').trim();
                  const addressLine2 = (address.address_line2 || '').trim();
                  const city = (address.city || '').trim();
                  const state = (address.state || '').trim();
                  const postalCode = (address.postal_code || '').trim();

                  const cityState = [city, state].filter(Boolean).join(', ');

                  return (
                    <TouchableOpacity
                      key={address.id}
                      style={[
                        styles.addressCard,
                        selected && styles.addressCardSelected,
                      ]}
                      disabled={saving || deletingInProgress}
                      onPress={() => onSelectAddress(address.id)}>
                      <View style={styles.addressCardTop}>
                        <View style={styles.addressRadioOuter}>
                          {selected ? (
                            <View style={styles.addressRadioInner} />
                          ) : null}
                        </View>

                        <View style={styles.addressInfo}>
                          {/* 1. Address Label + Default Badge */}
                          {hasLabel || address.is_default ? (
                            <View style={styles.addressLabelRow}>
                              {hasLabel ? (
                                <Text style={styles.addressLabel}>
                                  {address.label!.trim()}
                                </Text>
                              ) : null}

                              {address.is_default ? (
                                <View style={styles.defaultBadge}>
                                  <Text style={styles.defaultBadgeText}>
                                    DEFAULT
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          ) : null}

                          {/* 2. Address Line 1 */}
                          {Boolean(addressLine1) && (
                            <Text style={styles.addressPrimary}>
                              {addressLine1}
                            </Text>
                          )}

                          {/* 3. Address Line 2 */}
                          {Boolean(addressLine2) && (
                            <Text style={styles.addressSecondary}>
                              {addressLine2}
                            </Text>
                          )}

                          {/* 4. City, State */}
                          {Boolean(cityState) && (
                            <Text style={styles.addressSecondary}>
                              {cityState}
                            </Text>
                          )}

                          {/* 5. Postal Code */}
                          {Boolean(postalCode) && (
                            <Text style={styles.addressSecondary}>
                              {postalCode}
                            </Text>
                          )}
                        </View>
                      </View>

                      <View style={styles.addressActions}>
                        <TouchableOpacity
                          style={styles.addressSmallButton}
                          disabled={saving || deletingInProgress}
                          onPress={() => onEditAddress(address)}>
                          <Text style={styles.addressSmallButtonText}>Edit</Text>
                        </TouchableOpacity>

                        {!address.is_default ? (
                          <TouchableOpacity
                            style={styles.addressSmallButton}
                            disabled={saving || deletingInProgress}
                            onPress={() => onSetDefaultAddress(address)}>
                            <Text style={styles.addressSmallButtonText}>
                              Set Default
                            </Text>
                          </TouchableOpacity>
                        ) : null}

                        <TouchableOpacity
                          style={styles.addressDeleteButton}
                          disabled={saving || deletingInProgress}
                          onPress={() => handleStartDelete(address)}>
                          <Text style={styles.addressDeleteText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}

              <TouchableOpacity
                style={styles.addAddressButton}
                disabled={saving || deletingInProgress}
                onPress={onAddAddress}>
                <Text style={styles.addAddressPlus}>+</Text>
                <View style={styles.flex}>
                  <Text style={styles.addAddressTitle}>Add New Address</Text>
                  <Text style={styles.addAddressText}>
                    Add another pickup location
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>

            {!manageOnly ? (
              <View style={styles.continueArea}>
                {selectedAddress ? (
                  <View style={styles.selectedAddressSummary}>
                    <Text style={styles.selectedAddressLabel}>Pickup from</Text>
                    <Text
                      style={styles.selectedAddressName}
                      numberOfLines={1}>
                      {selectedAddress.label || selectedAddress.address_line1}
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.continueButton,
                    (!selectedAddressId || saving || deletingInProgress) &&
                      styles.buttonDisabled,
                  ]}
                  disabled={!selectedAddressId || saving || deletingInProgress}
                  onPress={onContinue}>
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.continueButtonText}>
                      Continue to Pickup Slot
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Confirmation Modal for Deleting an Address */}
      <Modal
        visible={!!deletingTarget}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!deletingInProgress) setDeletingTarget(null);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Address</Text>
            <Text style={styles.modalMessage}>
              Are you sure you want to delete this address?
            </Text>

            {deletingTarget ? (
              <View style={styles.modalAddressSnippet}>
                {Boolean(deletingTarget.label) && (
                  <Text style={styles.modalSnippetLabel}>
                    {deletingTarget.label}
                  </Text>
                )}
                <Text style={styles.modalSnippetLine1}>
                  {deletingTarget.address_line1}
                </Text>
                {Boolean(deletingTarget.city || deletingTarget.state) && (
                  <Text style={styles.modalSnippetCityState}>
                    {[deletingTarget.city, deletingTarget.state]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                )}
              </View>
            ) : null}

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                disabled={deletingInProgress}
                onPress={() => setDeletingTarget(null)}>
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalDeleteButton,
                  deletingInProgress && styles.buttonDisabled,
                ]}
                disabled={deletingInProgress}
                onPress={handleConfirmDelete}>
                {deletingInProgress ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalDeleteButtonText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* In-App Error Modal for Linked Order / Delete Errors */}
      <Modal
        visible={!!errorModal?.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setErrorModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalErrorIconCircle}>
              <AppIcon name="alert" size={24} color="#DC2626" />
            </View>

            <Text style={styles.modalTitle}>{errorModal?.title}</Text>
            <Text style={styles.modalErrorMessage}>{errorModal?.message}</Text>

            <TouchableOpacity
              style={styles.modalOkButton}
              onPress={() => setErrorModal(null)}>
              <Text style={styles.modalOkButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  screenContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  pageHeader: {
    height: 65,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageBackTouchable: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  pageBack: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
  },
  pageHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 8,
    color: '#111111',
  },
  headerSpacer: {
    width: 44,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },
  scrollContent: {
    paddingBottom: 160,
  },
  checkoutStep: {
    flexDirection: 'row',
    backgroundColor: '#F7F7F7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  checkoutStepNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#111111',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 30,
    marginRight: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  checkoutStepTitle: {
    fontWeight: '700',
    color: '#111111',
    fontSize: 14,
  },
  checkoutStepText: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: '#666666',
  },
  addressCard: {
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  addressCardSelected: {
    borderWidth: 2,
    borderColor: '#111111',
    backgroundColor: '#FAFAFA',
  },
  addressCardTop: {
    flexDirection: 'row',
  },
  addressRadioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  addressRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#111111',
  },
  addressInfo: {
    flex: 1,
  },
  addressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  addressLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  defaultBadge: {
    marginLeft: 8,
    backgroundColor: '#111111',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  defaultBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  addressPrimary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 2,
    lineHeight: 20,
  },
  addressSecondary: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 2,
    lineHeight: 18,
  },
  addressActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 12,
  },
  addressSmallButton: {
    minHeight: 44,
    minWidth: 64,
    borderWidth: 1,
    borderColor: '#D0D0D0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  addressSmallButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111111',
  },
  addressDeleteButton: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  addressDeleteText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
  },
  noAddressCard: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 16,
    padding: 25,
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  noAddressEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  noAddressTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111111',
  },
  noAddressText: {
    marginTop: 5,
    color: '#666666',
    textAlign: 'center',
    fontSize: 13,
  },
  addAddressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#BBBBBB',
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
    minHeight: 56,
    backgroundColor: '#FAFAFA',
  },
  addAddressPlus: {
    fontSize: 26,
    fontWeight: '400',
    color: '#111111',
    marginRight: 12,
    width: 28,
    textAlign: 'center',
  },
  addAddressTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  addAddressText: {
    marginTop: 2,
    fontSize: 12,
    color: '#777777',
  },
  continueArea: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 10,
    paddingTop: 10,
    backgroundColor: '#FFFFFF',
  },
  selectedAddressSummary: {
    marginBottom: 10,
  },
  selectedAddressLabel: {
    fontSize: 11,
    color: '#777777',
    fontWeight: '500',
  },
  selectedAddressName: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
    color: '#111111',
  },
  continueButton: {
    minHeight: 52,
    backgroundColor: '#111111',
    borderRadius: 13,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  modalErrorIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalErrorIcon: {
    fontSize: 26,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
    marginBottom: 10,
  },
  modalMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 18,
  },
  modalErrorMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 22,
  },
  modalAddressSnippet: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  modalSnippetLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 2,
  },
  modalSnippetLine1: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  modalSnippetCityState: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  modalActionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  modalDeleteButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalDeleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalOkButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalOkButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

