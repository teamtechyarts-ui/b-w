import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  Alert,
} from 'react-native';

import type {
  AddressFormState,
  AddressItem,
} from '../types/address';

import {
  EMPTY_ADDRESS_FORM,
} from '../types/address';

import {
  createAddress,
  getMyAddresses,
  removeAddress,
  setAddressDefault,
  updateAddress,
} from '../services/customersApi';

type UseAddressesOptions = {
  accessToken: string;
};

export function useAddresses(
  options: UseAddressesOptions,
) {
  const {
    accessToken,
  } = options;

  const [
    addresses,
    setAddresses,
  ] =
    useState<AddressItem[]>(
      [],
    );

  const [
    addressesLoading,
    setAddressesLoading,
  ] =
    useState(false);

  const [
    selectedAddressId,
    setSelectedAddressId,
  ] =
    useState<
      string | null
    >(null);

  const [
    editingAddressId,
    setEditingAddressId,
  ] =
    useState<
      string | null
    >(null);

  const [
    addressForm,
    setAddressForm,
  ] =
    useState<AddressFormState>(
      EMPTY_ADDRESS_FORM,
    );

  const [
    addressSaving,
    setAddressSaving,
  ] =
    useState(false);

  const selectedAddress =
    useMemo(
      () => {
        if (
          !selectedAddressId
        ) {
          return null;
        }

        return (
          addresses.find(
            address =>
              address.id ===
              selectedAddressId,
          ) ?? null
        );
      },
      [
        addresses,
        selectedAddressId,
      ],
    );

  const loadAddresses =
    useCallback(
      async (
        preferredAddressId?:
          | string
          | null,
      ) => {
        if (
          !accessToken
        ) {
          return;
        }

        try {
          setAddressesLoading(
            true,
          );

          const loadedAddresses =
            await getMyAddresses(
              accessToken,
            );

          setAddresses(
            loadedAddresses,
          );

          const preferred =
            preferredAddressId ===
            undefined
              ? selectedAddressId
              : preferredAddressId;

          const preferredExists =
            preferred !==
              null &&
            loadedAddresses.some(
              address =>
                address.id ===
                preferred,
            );

          if (
            preferredExists
          ) {
            setSelectedAddressId(
              preferred,
            );

            return;
          }

          const defaultAddress =
            loadedAddresses.find(
              address =>
                address.is_default,
          );

          if (
            defaultAddress
          ) {
            setSelectedAddressId(
              defaultAddress.id,
          );

            return;
          }

          setSelectedAddressId(
            loadedAddresses.length >
              0
              ? loadedAddresses[0]
                  .id
              : null,
          );
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to load addresses';

          Alert.alert(
            'Address Error',
            message,
          );

          setAddresses(
            [],
          );

          setSelectedAddressId(
            null,
          );
        } finally {
          setAddressesLoading(
            false,
          );
        }
      },
      [
        accessToken,
        selectedAddressId,
      ],
    );

  const prepareAddAddress =
    useCallback(
      () => {
        setEditingAddressId(
          null,
        );

        setAddressForm({
          ...EMPTY_ADDRESS_FORM,

          isDefault:
            addresses.length ===
            0,
        });
      },
      [
        addresses.length,
      ],
    );

  const prepareEditAddress =
    useCallback(
      (
        address: AddressItem,
      ) => {
        setEditingAddressId(
          address.id,
        );

        setAddressForm({
          label:
            address.label ??
            '',

          addressLine1:
            address.address_line1 ??
            '',

          addressLine2:
            address.address_line2 ??
            '',

          city:
            address.city ??
            '',

          state:
            address.state ??
            '',

          postalCode:
            address.postal_code ??
            '',

          latitude:
            address.latitude,

          longitude:
            address.longitude,

          isDefault:
            Boolean(
              address.is_default,
            ),
        });
      },
      [],
    );

  const cancelAddressEdit =
    useCallback(
      () => {
        setEditingAddressId(
          null,
        );

        setAddressForm(
          EMPTY_ADDRESS_FORM,
        );
      },
      [],
    );

  const saveAddress =
    useCallback(
      async (): Promise<boolean> => {
        if (
          !addressForm.addressLine1.trim()
        ) {
          Alert.alert(
            'Address required',
            'Please enter Address Line 1.',
          );

          return false;
        }

        if (
          !addressForm.city.trim()
        ) {
          Alert.alert(
            'City required',
            'Please enter City.',
          );

          return false;
        }

        if (
          !addressForm.state.trim()
        ) {
          Alert.alert(
            'State required',
            'Please enter State.',
          );

          return false;
        }

        const pincode = addressForm.postalCode.trim();
        if (!pincode || !/^\d{6}$/.test(pincode)) {
          Alert.alert(
            'Pincode required',
            'Please enter a valid 6-digit pincode.',
          );

          return false;
        }

        if (addressForm.latitude !== null || addressForm.longitude !== null) {
          const lat = Number(addressForm.latitude);
          const lng = Number(addressForm.longitude);
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lat < -90 ||
            lat > 90 ||
            lng < -180 ||
            lng > 180
          ) {
            Alert.alert(
              'Location Error',
              'Invalid GPS coordinates.',
            );

            return false;
          }
        }

        if (
          !accessToken
        ) {
          Alert.alert(
            'Session Error',
            'Please login again.',
          );

          return false;
        }

        try {
          setAddressSaving(
            true,
          );

          let savedAddressId:
            | string
            | null =
            null;

          if (
            editingAddressId
          ) {
            const result =
              await updateAddress(
                accessToken,
                editingAddressId,
                addressForm,
              );

            savedAddressId =
              result.id ??
              editingAddressId;
          } else {
            const result =
              await createAddress(
                accessToken,
                addressForm,
              );

            savedAddressId =
              result.id ??
              null;
          }

          await loadAddresses(
            savedAddressId,
          );

          setEditingAddressId(
            null,
          );

          setAddressForm(
            EMPTY_ADDRESS_FORM,
          );

          return true;
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to save address';

          Alert.alert(
            'Save Address Error',
            message,
          );

          return false;
        } finally {
          setAddressSaving(
            false,
          );
        }
      },
      [
        accessToken,
        addressForm,
        editingAddressId,
        loadAddresses,
      ],
    );

  const makeDefaultAddress =
    useCallback(
      async (
        address: AddressItem,
      ) => {
        if (
          !accessToken
        ) {
          return;
        }

        try {
          setAddressSaving(
            true,
          );

          await setAddressDefault(
            accessToken,
            address.id,
          );

          await loadAddresses(
            address.id,
          );
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to update default address';

          Alert.alert(
            'Address Error',
            message,
          );
        } finally {
          setAddressSaving(
            false,
          );
        }
      },
      [
        accessToken,
        loadAddresses,
      ],
    );

  const deleteAddress =
    useCallback(
      async (
        address: AddressItem,
      ): Promise<{ success: boolean; error?: string; inUse?: boolean }> => {
        if (!accessToken) {
          return {
            success: false,
            error: 'Please login again.',
            inUse: false,
          };
        }

        try {
          setAddressSaving(true);

          await removeAddress(
            accessToken,
            address.id,
          );

          await loadAddresses(
            selectedAddressId ===
              address.id
              ? null
              : selectedAddressId,
          );

          return {
            success: true,
          };
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to delete address';

          const inUse =
            message.toLowerCase().includes('existing order') ||
            message.toLowerCase().includes('used by an existing order');

          return {
            success: false,
            error: message,
            inUse,
          };
        } finally {
          setAddressSaving(
            false,
          );
        }
      },
      [
        accessToken,
        loadAddresses,
        selectedAddressId,
      ],
    );

  const resetAddresses =
    useCallback(
      () => {
        setAddresses(
          [],
        );

        setAddressesLoading(
          false,
        );

        setSelectedAddressId(
          null,
        );

        setEditingAddressId(
          null,
        );

        setAddressForm(
          EMPTY_ADDRESS_FORM,
        );

        setAddressSaving(
          false,
        );
      },
      [],
    );

  return {
    addresses,
    addressesLoading,

    selectedAddressId,
    setSelectedAddressId,
    selectedAddress,

    editingAddressId,

    addressForm,
    setAddressForm,

    addressSaving,

    loadAddresses,

    prepareAddAddress,
    prepareEditAddress,
    cancelAddressEdit,

    saveAddress,
    makeDefaultAddress,
    deleteAddress,

    resetAddresses,
  };
}