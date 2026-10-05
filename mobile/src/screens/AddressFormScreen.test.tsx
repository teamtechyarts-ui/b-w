import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import AddressFormScreen from './AddressFormScreen';
import {getCurrentDeviceLocation} from '../services/deviceLocationService';
import {reverseGeocode} from '../services/mapsApi';
import type {AddressFormState} from '../types/address';
import {EMPTY_ADDRESS_FORM} from '../types/address';

jest.mock('../services/deviceLocationService', () => ({
  getCurrentDeviceLocation: jest.fn(),
}));

jest.mock('../services/mapsApi', () => ({
  reverseGeocode: jest.fn(),
}));

const mockGetCurrentDeviceLocation = getCurrentDeviceLocation as jest.Mock;
const mockReverseGeocode = reverseGeocode as jest.Mock;

describe('AddressFormScreen Location UI States & Autofill Flow', () => {
  const defaultProps = {
    accessToken: 'test-token',
    editing: false,
    form: {
      ...EMPTY_ADDRESS_FORM,
    },
    saving: false,
    onBack: jest.fn(),
    onChange: jest.fn(),
    onChooseLocation: jest.fn(),
    onSave: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. renders the initial Pickup Location section with Use My Current Location and Map options', async () => {
    const view = await render(<AddressFormScreen {...defaultProps} />);
    expect(view.getByText('Use My Current Location')).toBeTruthy();
    expect(view.getByText('Choose Location on Map')).toBeTruthy();
    expect(view.getByText('Pickup Location')).toBeTruthy();
    expect(view.queryByText('Location detected')).toBeNull();
  });

  it('2. (Scenario A) GPS permission granted + reverse geocode succeeds populates all available address fields', async () => {
    mockGetCurrentDeviceLocation.mockResolvedValueOnce({
      latitude: 17.3753,
      longitude: 78.5582,
      accuracy: 137,
    });

    mockReverseGeocode.mockResolvedValueOnce({
      placeId: 'place-123',
      formattedAddress: 'Plot 42, Anand Nagar, Nagole, Hyderabad, Telangana 500068',
      addressLine1: 'Plot 42, Anand Nagar',
      addressLine2: 'Nagole',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500068',
      country: 'India',
      coordinate: {latitude: 17.3753, longitude: 78.5582},
      provider: 'google',
    });

    const onChange = jest.fn();
    const view = await render(
      <AddressFormScreen {...defaultProps} onChange={onChange} />,
    );

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(mockGetCurrentDeviceLocation).toHaveBeenCalled();
      expect(mockReverseGeocode).toHaveBeenCalledWith('test-token', 17.3753, 78.5582);
    });

    await waitFor(() => {
      expect(view.getByText('Location detected')).toBeTruthy();
      expect(view.getByText('Accuracy: ~137 m')).toBeTruthy();
      expect(view.getByText('Plot 42, Anand Nagar')).toBeTruthy();
      expect(view.getByText('Nagole')).toBeTruthy();
      expect(view.getByText('Hyderabad, Telangana')).toBeTruthy();
      expect(view.getByText('500068')).toBeTruthy();
      expect(view.getByText('Change Location')).toBeTruthy();
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: 'Plot 42, Anand Nagar',
        addressLine2: 'Nagole',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500068',
        latitude: 17.3753,
        longitude: 78.5582,
      }),
    );
  });

  it('3. (Scenario B) GPS succeeds but street unavailable -> available fields populate, street remains empty', async () => {
    mockGetCurrentDeviceLocation.mockResolvedValueOnce({
      latitude: 17.3753,
      longitude: 78.5582,
      accuracy: 45,
    });

    mockReverseGeocode.mockResolvedValueOnce({
      placeId: 'place-no-street',
      formattedAddress: 'Nagole, Hyderabad, Telangana 500068',
      addressLine1: '', // Street unavailable
      addressLine2: 'Nagole',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500068',
      country: 'India',
      coordinate: {latitude: 17.3753, longitude: 78.5582},
      provider: 'google',
    });

    const onChange = jest.fn();
    const view = await render(
      <AddressFormScreen {...defaultProps} onChange={onChange} />,
    );

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(mockReverseGeocode).toHaveBeenCalled();
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: '',
        addressLine2: 'Nagole',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500068',
        latitude: 17.3753,
        longitude: 78.5582,
      }),
    );
  });

  it('4. (Scenario C) GPS succeeds but postal code unavailable -> postal code remains empty for manual entry', async () => {
    mockGetCurrentDeviceLocation.mockResolvedValueOnce({
      latitude: 17.3753,
      longitude: 78.5582,
      accuracy: 25,
    });

    mockReverseGeocode.mockResolvedValueOnce({
      placeId: 'place-no-pin',
      formattedAddress: 'Main Road, Nagole, Hyderabad, Telangana',
      addressLine1: 'Main Road',
      addressLine2: 'Nagole',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '', // Postal code unavailable
      country: 'India',
      coordinate: {latitude: 17.3753, longitude: 78.5582},
      provider: 'google',
    });

    const onChange = jest.fn();
    const view = await render(
      <AddressFormScreen {...defaultProps} onChange={onChange} />,
    );

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(mockReverseGeocode).toHaveBeenCalled();
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: 'Main Road',
        addressLine2: 'Nagole',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '',
        latitude: 17.3753,
        longitude: 78.5582,
      }),
    );
  });

  it('5. (Scenario D) Reverse geocoding failure -> coordinates remain available and manual entry possible', async () => {
    mockGetCurrentDeviceLocation.mockResolvedValueOnce({
      latitude: 17.3753,
      longitude: 78.5582,
      accuracy: 137,
    });

    mockReverseGeocode.mockRejectedValueOnce(
      new Error('Geocoding service unavailable'),
    );

    const existingForm: AddressFormState = {
      label: 'Home',
      addressLine1: 'nagole',
      addressLine2: '',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500068',
      latitude: null,
      longitude: null,
      isDefault: false,
    };

    const onChange = jest.fn();
    const view = await render(
      <AddressFormScreen {...defaultProps} form={existingForm} onChange={onChange} />,
    );

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(view.getByText('Location detected')).toBeTruthy();
      expect(
        view.getByText(
          "We found your current location, but couldn't automatically determine the address.",
        ),
      ).toBeTruthy();
      expect(view.getByText('Accuracy: ~137 m')).toBeTruthy();
      expect(view.getByText('Try Again')).toBeTruthy();
      expect(view.getByText('Choose Location on Map')).toBeTruthy();
      expect(view.getByText('You can also enter your address manually below.')).toBeTruthy();
    });

    // Coordinates are preserved in form state
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: 'nagole',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500068',
        latitude: 17.3753,
        longitude: 78.5582,
      }),
    );
  });

  it('6. (Scenario E) Permission denied -> proper error state', async () => {
    mockGetCurrentDeviceLocation.mockRejectedValueOnce(
      new Error('Location permission was not granted'),
    );

    const view = await render(<AddressFormScreen {...defaultProps} />);

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(
        view.getByText('Location permission was denied. You can enter your address manually.'),
      ).toBeTruthy();
      expect(view.getByText('Try Again')).toBeTruthy();
      expect(view.getByText('Enter Address Manually')).toBeTruthy();
    });
  });

  it('7. (Scenario F) Low GPS accuracy (> 1000m) -> warning + retry prompt', async () => {
    mockGetCurrentDeviceLocation.mockRejectedValueOnce(
      new Error('Your location accuracy is low (1200m). Move to an area with a clearer GPS signal and try again.'),
    );

    const view = await render(<AddressFormScreen {...defaultProps} />);

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(
        view.getByText('Your location accuracy is low. Move to an open area and try again.'),
      ).toBeTruthy();
    });
  });

  it('8. (Scenario H) Manual edits are updated via onChange and saved on Save button press', async () => {
    const onChange = jest.fn();
    const onSave = jest.fn();
    const formWithData: AddressFormState = {
      label: 'Home',
      addressLine1: 'Building 1',
      addressLine2: 'Street 2',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500068',
      latitude: 17.3753,
      longitude: 78.5582,
      isDefault: false,
    };

    const view = await render(
      <AddressFormScreen
        {...defaultProps}
        form={formWithData}
        onChange={onChange}
        onSave={onSave}
      />,
    );

    await fireEvent.changeText(view.getByDisplayValue('Building 1'), 'Building 1, Apt 4B');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: 'Building 1, Apt 4B',
      }),
    );

    await fireEvent.press(view.getByText('Save Address'));
    expect(onSave).toHaveBeenCalled();
  });

  it('9. (Scenario K) Editing an address and changing location updates both coordinates and fields', async () => {
    const existingAddressWithLocation: AddressFormState = {
      label: 'Office',
      addressLine1: 'Cyber Towers',
      addressLine2: 'Hitec City',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      latitude: 17.4501,
      longitude: 78.3809,
      isDefault: true,
    };

    const onChange = jest.fn();
    const view = await render(
      <AddressFormScreen
        {...defaultProps}
        editing={true}
        form={existingAddressWithLocation}
        onChange={onChange}
      />,
    );

    expect(view.getByText('Pickup location saved')).toBeTruthy();
    expect(view.getByText('Cyber Towers')).toBeTruthy();
    expect(view.getByText('Hitec City')).toBeTruthy();
    expect(view.getByText('Hyderabad, Telangana')).toBeTruthy();
    expect(view.getByText('500081')).toBeTruthy();
    expect(view.getByText('Change Location')).toBeTruthy();

    await fireEvent.press(view.getByText('Change Location'));

    expect(view.getByText('Use My Current Location')).toBeTruthy();
    expect(view.getByText('Choose Location on Map')).toBeTruthy();

    mockGetCurrentDeviceLocation.mockResolvedValueOnce({
      latitude: 17.3753,
      longitude: 78.5582,
      accuracy: 20,
    });

    mockReverseGeocode.mockResolvedValueOnce({
      placeId: 'place-new',
      formattedAddress: 'New Road, Nagole, Hyderabad, Telangana 500068',
      addressLine1: 'New Road',
      addressLine2: 'Nagole',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500068',
      country: 'India',
      coordinate: {latitude: 17.3753, longitude: 78.5582},
      provider: 'google',
    });

    await fireEvent.press(view.getByText('Use My Current Location'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          addressLine1: 'New Road',
          addressLine2: 'Nagole',
          city: 'Hyderabad',
          state: 'Telangana',
          postalCode: '500068',
          latitude: 17.3753,
          longitude: 78.5582,
        }),
      );
    });
  });
});
