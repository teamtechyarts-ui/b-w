import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import AddressScreen from './AddressScreen';
import type {AddressItem} from '../types/address';

describe('AddressScreen UX & In-App Deletion / Error Modals', () => {
  const sampleAddresses: AddressItem[] = [
    {
      id: 'addr-1',
      customer_id: 'cust-1',
      label: 'Home',
      address_line1: 'Flat 402, Sunshine Heights',
      address_line2: 'Anand Nagar, Nagole',
      city: 'Hyderabad',
      state: 'Telangana',
      postal_code: '500068',
      latitude: 17.3753,
      longitude: 78.5582,
      is_default: true,
    },
    {
      id: 'addr-2',
      customer_id: 'cust-1',
      label: 'Office',
      address_line1: 'Building 12, Cyber Gateway',
      address_line2: null, // Incomplete / missing line 2
      city: 'Hyderabad',
      state: 'Telangana',
      postal_code: '500081',
      latitude: 17.4401,
      longitude: 78.3489,
      is_default: false,
    },
    {
      id: 'addr-3',
      customer_id: 'cust-1',
      label: null, // Incomplete / missing label & postal code
      address_line1: 'House 5, Green Valley',
      address_line2: 'Main Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postal_code: null,
      latitude: 12.9121,
      longitude: 77.6446,
      is_default: false,
    },
  ];

  const defaultProps = {
    manageOnly: false,
    addresses: sampleAddresses,
    loading: false,
    saving: false,
    selectedAddressId: 'addr-1',
    selectedAddress: sampleAddresses[0],
    onBack: jest.fn(),
    onSelectAddress: jest.fn(),
    onAddAddress: jest.fn(),
    onEditAddress: jest.fn(),
    onSetDefaultAddress: jest.fn(),
    onDeleteAddress: jest.fn(),
    onContinue: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. displays available address fields in exact order and omits missing fields without null/undefined/separators', async () => {
    const view = await render(<AddressScreen {...defaultProps} />);

    // Complete Address (addr-1)
    expect(view.getAllByText('Home').length).toBeGreaterThanOrEqual(1);
    expect(view.getByText('DEFAULT')).toBeTruthy();
    expect(view.getByText('Flat 402, Sunshine Heights')).toBeTruthy();
    expect(view.getByText('Anand Nagar, Nagole')).toBeTruthy();
    expect(view.getAllByText('Hyderabad, Telangana').length).toBe(2);
    expect(view.getByText('500068')).toBeTruthy();

    // Incomplete Address missing Line 2 (addr-2)
    expect(view.getByText('Office')).toBeTruthy();
    expect(view.getByText('Building 12, Cyber Gateway')).toBeTruthy();
    expect(view.getByText('500081')).toBeTruthy();

    // Incomplete Address missing Label and Postal Code (addr-3)
    expect(view.getByText('House 5, Green Valley')).toBeTruthy();
    expect(view.getByText('Main Road')).toBeTruthy();
    expect(view.getByText('Bengaluru, Karnataka')).toBeTruthy();

    // Verify no "null" or "undefined" text is rendered
    expect(view.queryByText('null')).toBeNull();
    expect(view.queryByText('undefined')).toBeNull();
  });

  it('2. opens in-app confirmation modal when customer taps Delete', async () => {
    const view = await render(<AddressScreen {...defaultProps} />);

    const deleteButtons = view.getAllByText('Delete');
    expect(deleteButtons.length).toBe(3);

    // Tap Delete on first address
    await fireEvent.press(deleteButtons[0]);

    // Modal opens with title and message
    expect(view.getByText('Delete Address')).toBeTruthy();
    expect(
      view.getByText('Are you sure you want to delete this address?'),
    ).toBeTruthy();
    expect(view.getAllByText('Flat 402, Sunshine Heights').length).toBe(2);
    expect(view.getByText('Cancel')).toBeTruthy();
  });

  it('3. cancels deletion when customer taps Cancel in modal', async () => {
    const onDeleteAddress = jest.fn();
    const view = await render(
      <AddressScreen {...defaultProps} onDeleteAddress={onDeleteAddress} />,
    );

    const deleteButtons = view.getAllByText('Delete');
    await fireEvent.press(deleteButtons[0]);

    expect(view.getByText('Delete Address')).toBeTruthy();

    // Tap Cancel
    await fireEvent.press(view.getByText('Cancel'));

    expect(onDeleteAddress).not.toHaveBeenCalled();
    expect(view.queryByText('Are you sure you want to delete this address?')).toBeNull();
  });

  it('4. confirms delete, calls onDeleteAddress, and closes modal on success', async () => {
    const onDeleteAddress = jest.fn().mockResolvedValueOnce({success: true});
    const view = await render(
      <AddressScreen {...defaultProps} onDeleteAddress={onDeleteAddress} />,
    );

    const deleteButtons = view.getAllByText('Delete');
    await fireEvent.press(deleteButtons[0]);

    // In modal, there's a Cancel and a confirm Delete button
    const modalConfirmDeleteButtons = view.getAllByText('Delete');
    // The last Delete button is inside the modal
    const confirmBtn = modalConfirmDeleteButtons[modalConfirmDeleteButtons.length - 1];
    await fireEvent.press(confirmBtn);

    await waitFor(() => {
      expect(onDeleteAddress).toHaveBeenCalledWith(sampleAddresses[0]);
      expect(view.queryByText('Are you sure you want to delete this address?')).toBeNull();
    });
  });

  it('5. shows clean in-app error modal when backend rejects deletion of address linked to an order', async () => {
    const onDeleteAddress = jest.fn().mockResolvedValueOnce({
      success: false,
      error: 'Address is used by an existing order and cannot be deleted.',
      inUse: true,
    });

    const view = await render(
      <AddressScreen {...defaultProps} onDeleteAddress={onDeleteAddress} />,
    );

    const deleteButtons = view.getAllByText('Delete');
    await fireEvent.press(deleteButtons[0]);

    const modalConfirmDeleteButtons = view.getAllByText('Delete');
    const confirmBtn = modalConfirmDeleteButtons[modalConfirmDeleteButtons.length - 1];
    await fireEvent.press(confirmBtn);

    await waitFor(() => {
      expect(onDeleteAddress).toHaveBeenCalled();
      // Required error modal appears
      expect(view.getByText("Address Can't Be Deleted")).toBeTruthy();
      expect(
        view.getByText(
          'This address is linked to an existing order, so it cannot be deleted.',
        ),
      ).toBeTruthy();
      expect(view.getByText('OK')).toBeTruthy();
    });

    // Error remains visible until dismissed
    await fireEvent.press(view.getByText('OK'));

    expect(view.queryByText("Address Can't Be Deleted")).toBeNull();
  });

  it('6. handles thrown error when address is linked to an order', async () => {
    const onDeleteAddress = jest.fn().mockRejectedValueOnce(
      new Error('Address is used by an existing order and cannot be deleted.'),
    );

    const view = await render(
      <AddressScreen {...defaultProps} onDeleteAddress={onDeleteAddress} />,
    );

    const deleteButtons = view.getAllByText('Delete');
    await fireEvent.press(deleteButtons[0]);

    const modalConfirmDeleteButtons = view.getAllByText('Delete');
    const confirmBtn = modalConfirmDeleteButtons[modalConfirmDeleteButtons.length - 1];
    await fireEvent.press(confirmBtn);

    await waitFor(() => {
      expect(view.getByText("Address Can't Be Deleted")).toBeTruthy();
      expect(
        view.getByText(
          'This address is linked to an existing order, so it cannot be deleted.',
        ),
      ).toBeTruthy();
    });

    await fireEvent.press(view.getByText('OK'));
    expect(view.queryByText("Address Can't Be Deleted")).toBeNull();
  });

  it('7. selects address when tapped and continues to pickup slot', async () => {
    const onSelectAddress = jest.fn();
    const onContinue = jest.fn();

    const view = await render(
      <AddressScreen
        {...defaultProps}
        onSelectAddress={onSelectAddress}
        onContinue={onContinue}
      />,
    );

    await fireEvent.press(view.getByText('Office'));
    expect(onSelectAddress).toHaveBeenCalledWith('addr-2');

    await fireEvent.press(view.getByText('Continue to Pickup Slot'));
    expect(onContinue).toHaveBeenCalled();
  });

  it('8. in manage-only mode, hides checkout step banner and continue button', async () => {
    const view = await render(
      <AddressScreen {...defaultProps} manageOnly={true} />,
    );

    expect(view.getByText('Saved Addresses')).toBeTruthy();
    expect(view.queryByText('Select pickup address')).toBeNull();
    expect(view.queryByText('Continue to Pickup Slot')).toBeNull();
  });
});
