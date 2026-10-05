import {renderHook, act} from '@testing-library/react-native';
import {Alert} from 'react-native';
import {useAddresses} from './useAddresses';
import {
  createAddress,
  getMyAddresses,
} from '../services/customersApi';

jest.mock('../services/customersApi', () => ({
  createAddress: jest.fn(),
  getMyAddresses: jest.fn(),
  updateAddress: jest.fn(),
  removeAddress: jest.fn(),
  setAddressDefault: jest.fn(),
}));

jest.spyOn(Alert, 'alert');

describe('useAddresses hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads addresses and sets initial selected address', async () => {
    (getMyAddresses as jest.Mock).mockResolvedValueOnce([
      {
        id: 'addr-1',
        label: 'Home',
        address_line1: 'Road 1',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500001',
        latitude: 17.38,
        longitude: 78.48,
        is_default: true,
      },
    ]);

    const view = await renderHook(() => useAddresses({accessToken: 'token-123'}));

    await act(async () => {
      await view.result.current.loadAddresses();
    });

    expect(view.result.current.addresses).toHaveLength(1);
    expect(view.result.current.selectedAddressId).toBe('addr-1');
    expect(view.result.current.selectedAddress?.label).toBe('Home');
  });

  it('validates addressLine1, city, state, postalCode and coordinates before saving', async () => {
    const view = await renderHook(() => useAddresses({accessToken: 'token-123'}));

    // 1. Missing addressLine1
    let success = false;
    await act(async () => {
      success = await view.result.current.saveAddress();
    });
    expect(success).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Address required',
      'Please enter Address Line 1.',
    );

    // 2. Missing city
    await act(async () => {
      view.result.current.setAddressForm({
        ...view.result.current.addressForm,
        addressLine1: 'Plot 10',
      });
    });
    await act(async () => {
      success = await view.result.current.saveAddress();
    });
    expect(success).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith('City required', 'Please enter City.');

    // 3. Missing state
    await act(async () => {
      view.result.current.setAddressForm({
        ...view.result.current.addressForm,
        addressLine1: 'Plot 10',
        city: 'Hyderabad',
      });
    });
    await act(async () => {
      success = await view.result.current.saveAddress();
    });
    expect(success).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith('State required', 'Please enter State.');

    // 4. Invalid postal code
    await act(async () => {
      view.result.current.setAddressForm({
        ...view.result.current.addressForm,
        addressLine1: 'Plot 10',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '123',
      });
    });
    await act(async () => {
      success = await view.result.current.saveAddress();
    });
    expect(success).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Pincode required',
      'Please enter a valid 6-digit pincode.',
    );

    // 5. Invalid latitude
    await act(async () => {
      view.result.current.setAddressForm({
        ...view.result.current.addressForm,
        addressLine1: 'Plot 10',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500068',
        latitude: 95, // Invalid > 90
        longitude: 78.5,
      });
    });
    await act(async () => {
      success = await view.result.current.saveAddress();
    });
    expect(success).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith('Location Error', 'Invalid GPS coordinates.');

    // 6. Valid form with coordinates
    await act(async () => {
      view.result.current.setAddressForm({
        ...view.result.current.addressForm,
        addressLine1: 'Plot 10, Anand Nagar',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500068',
        latitude: 17.3753,
        longitude: 78.5582,
      });
    });

    (createAddress as jest.Mock).mockResolvedValueOnce({
      id: 'new-addr-id',
    });
    (getMyAddresses as jest.Mock).mockResolvedValueOnce([
      {
        id: 'new-addr-id',
        address_line1: 'Plot 10, Anand Nagar',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500068',
        latitude: 17.3753,
        longitude: 78.5582,
      },
    ]);

    await act(async () => {
      success = await view.result.current.saveAddress();
    });

    expect(success).toBe(true);
    expect(createAddress).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        addressLine1: 'Plot 10, Anand Nagar',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500068',
        latitude: 17.3753,
        longitude: 78.5582,
      }),
    );
  });

  it('deletes an address and refreshes the address list', async () => {
    const removeAddressMock = require('../services/customersApi').removeAddress;
    removeAddressMock.mockResolvedValueOnce({deleted: true});
    (getMyAddresses as jest.Mock).mockResolvedValueOnce([]);

    const view = await renderHook(() => useAddresses({accessToken: 'token-123'}));

    let result: any;
    await act(async () => {
      result = await view.result.current.deleteAddress({
        id: 'addr-del-1',
        label: 'Old Address',
        address_line1: 'Road 5',
        address_line2: '',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500001',
        latitude: 17.38,
        longitude: 78.48,
        is_default: false,
      });
    });

    expect(result.success).toBe(true);
    expect(removeAddressMock).toHaveBeenCalledWith('token-123', 'addr-del-1');
  });

  it('handles delete failure when address is linked to existing order', async () => {
    const removeAddressMock = require('../services/customersApi').removeAddress;
    removeAddressMock.mockRejectedValueOnce(
      new Error('Address is used by an existing order and cannot be deleted.'),
    );

    const view = await renderHook(() => useAddresses({accessToken: 'token-123'}));

    let result: any;
    await act(async () => {
      result = await view.result.current.deleteAddress({
        id: 'addr-linked-1',
        label: 'Home',
        address_line1: 'Road 1',
        address_line2: '',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500001',
        latitude: 17.38,
        longitude: 78.48,
        is_default: false,
      });
    });

    expect(result.success).toBe(false);
    expect(result.inUse).toBe(true);
    expect(result.error).toBe('Address is used by an existing order and cannot be deleted.');
  });
});

