import React from 'react';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import {Alert} from 'react-native';
import AdminLocationsScreen from './AdminLocationsScreen';
import {
  addAdminFacilityPincode,
  createAdminLocation,
  deleteAdminLocation,
  listAdminLocations,
  removeAdminFacilityPincode,
  updateAdminLocation,
} from '../services/adminFacilityOversightApi';

jest.mock('../services/adminFacilityOversightApi', () => ({
  listAdminLocations: jest.fn(),
  createAdminLocation: jest.fn(),
  updateAdminLocation: jest.fn(),
  deleteAdminLocation: jest.fn(),
  addAdminFacilityPincode: jest.fn(),
  removeAdminFacilityPincode: jest.fn(),
}));

const mockLocation1 = {
  id: 'fac-1',
  name: 'Central Processing Hub',
  address: 'Plot 10, HITEC City, Hyderabad',
  latitude: 17.4435,
  longitude: 78.3772,
  serviceRadiusMeters: 10000,
  isActive: true,
  pincodes: ['500068', '500074'],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const mockLocation2 = {
  id: 'fac-2',
  name: 'Banjara Hills Laundry Hub',
  address: 'Road No 12, Banjara Hills, Hyderabad',
  latitude: 17.4156,
  longitude: 78.4354,
  serviceRadiusMeters: 15000,
  isActive: false,
  pincodes: [],
  createdAt: '2026-09-02T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (listAdminLocations as jest.Mock).mockResolvedValue([mockLocation1, mockLocation2]);
  (createAdminLocation as jest.Mock).mockResolvedValue({
    ...mockLocation1,
    id: 'fac-3',
    name: 'New Hub',
  });
  (updateAdminLocation as jest.Mock).mockResolvedValue(mockLocation1);
  (deleteAdminLocation as jest.Mock).mockResolvedValue({
    success: true,
    deleted: false,
    archived: true,
    message: 'Facility was archived because it has historical orders.',
  });
  (addAdminFacilityPincode as jest.Mock).mockResolvedValue({
    success: true,
    facilityId: 'fac-1',
    pincode: '500076',
    message: 'Pincode added.',
  });
  (removeAdminFacilityPincode as jest.Mock).mockResolvedValue({
    success: true,
    facilityId: 'fac-1',
    pincode: '500068',
    message: 'Pincode removed.',
  });
});

afterEach(async () => {
  await cleanup();
});

test('renders laundry locations with address and serviceable pincodes (no GPS/radius displayed)', async () => {
  const onBack = jest.fn();
  const view = await render(<AdminLocationsScreen accessToken="admin-token" onBack={onBack} />);

  await waitFor(() => {
    expect(view.getByText('Central Processing Hub')).toBeTruthy();
  });

  expect(view.getByText('Banjara Hills Laundry Hub')).toBeTruthy();
  expect(view.getByText('Plot 10, HITEC City, Hyderabad')).toBeTruthy();
  expect(view.getByText('500068')).toBeTruthy();
  expect(view.getByText('500074')).toBeTruthy();

  // Verify GPS coordinates and radius strings are not displayed
  expect(view.queryByText(/10 km radius/)).toBeNull();
  expect(view.queryByText(/15 km radius/)).toBeNull();
  expect(view.queryByText(/Coordinates not set/)).toBeNull();

  fireEvent.press(view.getByText('‹ Admin'));
  expect(onBack).toHaveBeenCalled();
});

test('opens Add Location modal and creates a location with name and address (no GPS required)', async () => {
  const view = await render(<AdminLocationsScreen accessToken="admin-token" onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText('Central Processing Hub')).toBeTruthy();
  });

  await act(async () => {
    fireEvent.press(view.getByText('+ Add Location'));
  });

  await waitFor(() => {
    expect(view.getByText('Add Laundry Location')).toBeTruthy();
  });

  // Verify map search, latitude, longitude, and radius inputs are not present
  expect(view.queryByText('Search on Map')).toBeNull();
  expect(view.queryByTestId('input-location-latitude')).toBeNull();
  expect(view.queryByTestId('input-location-longitude')).toBeNull();
  expect(view.queryByTestId('input-location-radius')).toBeNull();

  await act(async () => {
    fireEvent.changeText(view.getByTestId('input-location-name'), 'Kondapur Facility');
    fireEvent.changeText(view.getByTestId('input-location-address'), 'Kondapur Main Road, Hyderabad');
  });

  await act(async () => {
    fireEvent.press(view.getByTestId('btn-submit-location'));
  });

  await waitFor(() => {
    expect(createAdminLocation).toHaveBeenCalledWith('admin-token', {
      name: 'Kondapur Facility',
      address: 'Kondapur Main Road, Hyderabad',
      isActive: true,
    });
  });
});

test('toggles active status and deletes/archives location', async () => {
  const view = await render(<AdminLocationsScreen accessToken="admin-token" onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText('Central Processing Hub')).toBeTruthy();
  });

  // Toggle active/deactivate
  await act(async () => {
    fireEvent.press(view.getByText('Deactivate'));
  });
  await waitFor(() => {
    expect(updateAdminLocation).toHaveBeenCalledWith('admin-token', 'fac-1', {
      isActive: false,
    });
  });

  // Delete / Archive
  const deleteBtns = view.getAllByText('Delete / Archive');
  await act(async () => {
    fireEvent.press(deleteBtns[0]);
  });

  await waitFor(() => {
    expect(view.getByText('Remove Location?')).toBeTruthy();
  });

  // Confirm delete in modal (second one is in modal)
  const allDeleteArchive = view.getAllByText('Delete / Archive');
  await act(async () => {
    fireEvent.press(allDeleteArchive[allDeleteArchive.length - 1]);
  });

  await waitFor(() => {
    expect(deleteAdminLocation).toHaveBeenCalledWith('admin-token', 'fac-1');
  });
});

test('adds a serviceable pincode to a facility', async () => {
  const view = await render(<AdminLocationsScreen accessToken="admin-token" onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText('Central Processing Hub')).toBeTruthy();
  });

  const addPincodeBtns = view.getAllByText('+ Add Pincode');
  await act(async () => {
    fireEvent.press(addPincodeBtns[0]);
  });

  await waitFor(() => {
    expect(view.getByText('Add Serviceable Pincode')).toBeTruthy();
  });

  await act(async () => {
    fireEvent.changeText(view.getByPlaceholderText('e.g. 500068'), '500076');
  });

  await act(async () => {
    fireEvent.press(view.getByText('Add Pincode'));
  });

  await waitFor(() => {
    expect(addAdminFacilityPincode).toHaveBeenCalledWith('admin-token', 'fac-1', '500076');
  });
});

test('removes a serviceable pincode with confirmation alert', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert');
  const view = await render(<AdminLocationsScreen accessToken="admin-token" onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText('Central Processing Hub')).toBeTruthy();
  });

  const removePinBtn = view.getByLabelText('Remove pincode 500068');
  await act(async () => {
    fireEvent.press(removePinBtn);
  });

  expect(alertSpy).toHaveBeenCalledWith(
    'Remove Pincode',
    expect.stringContaining('500068'),
    expect.any(Array),
  );

  // Trigger Remove callback from alert buttons
  const alertButtons = alertSpy.mock.calls[0][2] as any[];
  const removeBtn = alertButtons.find(b => b.text === 'Remove');
  await act(async () => {
    await removeBtn.onPress();
  });

  await waitFor(() => {
    expect(removeAdminFacilityPincode).toHaveBeenCalledWith('admin-token', 'fac-1', '500068');
  });
});
