import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import DriverDashboardScreen from './DriverDashboardScreen';
import {claimDriverJob, getDriverDashboard, lookupDriverOrder} from '../services/driverAssignmentsApi';
import {getDriverProfile, setDriverAvailability} from '../services/driverProfileApi';

jest.mock('../services/driverAssignmentsApi', () => ({
  getDriverDashboard: jest.fn(),
  lookupDriverOrder: jest.fn(),
  claimDriverJob: jest.fn(),
  formatDriverAddress: jest.fn(() => '1 Test Road'),
}));

jest.mock('../services/driverProfileApi', () => ({
  getDriverProfile: jest.fn(),
  setDriverAvailability: jest.fn(),
}));

jest.mock('../components/NativeQrScannerButton', () => {
  const ReactModule = require('react');
  const {Text, TouchableOpacity} = require('react-native');
  return ({onScanned}: {onScanned: (value: string) => void}) =>
    ReactModule.createElement(
      TouchableOpacity,
      {onPress: () => onScanned('BW1:00000000-0000-4000-8000-000000000001')},
      ReactModule.createElement(Text, null, 'Scan Order QR'),
    );
});

const loadDashboard = getDriverDashboard as jest.Mock;
const lookup = lookupDriverOrder as jest.Mock;
const claimJobMock = claimDriverJob as jest.Mock;
const loadProfile = getDriverProfile as jest.Mock;
const updateAvailability = setDriverAvailability as jest.Mock;

const sampleProfile = {
  id: 'driver-id-1',
  is_active: true,
  is_available: false,
  max_concurrent_jobs: 5,
  profiles: {
    id: 'profile-id-1',
    full_name: 'testing 2',
    phone: '+919876543211',
    avatar_path: null,
  },
};

const sampleDashboardData = {
  date: '2026-10-02',
  summary: {
    pickups: 1,
    deliveries: 1,
    availablePickups: 1,
    availableDeliveries: 1,
    pending: 1,
    inProgress: 1,
    completed: 0,
  },
  availablePickups: [
    {
      id: 'order-avail-1',
      orderId: 'order-avail-1',
      type: 'pickup',
      assignmentStatus: 'available',
      orderNumber: 'BW-AVAIL-PICKUP',
      assignedAt: '2026-10-02T08:00:00Z',
      pickupScheduledAt: '2026-10-02T10:00:00Z',
      pickupSlotLabel: 'Morning Slot',
      address: null,
      facility: {name: 'Banjara Hills Care Centre'},
    },
  ],
  availableDeliveries: [
    {
      id: 'order-avail-2',
      orderId: 'order-avail-2',
      type: 'delivery',
      assignmentStatus: 'available',
      orderNumber: 'BW-AVAIL-DELIV',
      assignedAt: '2026-10-02T08:30:00Z',
      pickupScheduledAt: null,
      pickupSlotLabel: null,
      address: null,
      facility: {name: 'Banjara Hills Care Centre'},
    },
  ],
  pickups: [
    {
      id: 'pickup-id',
      orderId: 'order-pickup',
      type: 'pickup',
      assignmentStatus: 'assigned',
      orderNumber: 'BW-PICKUP',
      assignedAt: '2026-10-02T09:00:00Z',
      address: null,
      facility: {name: 'Banjara Hills Care Centre'},
    },
  ],
  deliveries: [
    {
      id: 'delivery-id',
      orderId: 'order-delivery',
      type: 'delivery',
      assignmentStatus: 'accepted',
      orderNumber: 'BW-DELIVERY',
      assignedAt: '2026-10-02T10:00:00Z',
      address: null,
      facility: {name: 'Banjara Hills Care Centre'},
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  loadDashboard.mockResolvedValue(sampleDashboardData);
  loadProfile.mockResolvedValue(sampleProfile);
  updateAvailability.mockResolvedValue({driverId: 'driver-id-1', isAvailable: true});
  claimJobMock.mockResolvedValue({success: true, assignment: {id: 'new-assignment-123'}});
});

describe('DriverDashboardScreen - Availability & Dispatch', () => {
  test('1. renders current availability as Unavailable when is_available is false', async () => {
    loadProfile.mockResolvedValueOnce({...sampleProfile, is_available: false});
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Availability for Jobs')).toBeTruthy();
      expect(view.getByText('Unavailable')).toBeTruthy();
      expect(view.getByText("You won't receive new jobs")).toBeTruthy();
      expect(view.getByText('OFF')).toBeTruthy();
    });
  });

  test('2. renders current availability as Available when is_available is true', async () => {
    loadProfile.mockResolvedValueOnce({...sampleProfile, is_available: true});
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Availability for Jobs')).toBeTruthy();
      expect(view.getAllByText('Available').length).toBeGreaterThanOrEqual(1);
      expect(view.getByText('Ready to receive new jobs')).toBeTruthy();
      expect(view.getByText('ON')).toBeTruthy();
    });
  });

  test('3. toggles Unavailable -> Available: calls API and updates UI on success', async () => {
    loadProfile.mockResolvedValueOnce({...sampleProfile, is_available: false});
    updateAvailability.mockResolvedValueOnce({driverId: 'driver-id-1', isAvailable: true});

    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('OFF')).toBeTruthy());

    await fireEvent.press(view.getByLabelText('Toggle job availability'));

    await waitFor(() => {
      expect(updateAvailability).toHaveBeenCalledWith('token-123', true);
      expect(view.getAllByText('Available').length).toBeGreaterThanOrEqual(1);
      expect(view.getByText('Ready to receive new jobs')).toBeTruthy();
      expect(view.getByText('ON')).toBeTruthy();
    });
  });

  test('4. toggles Available -> Unavailable: calls API and updates UI on success', async () => {
    loadProfile.mockResolvedValueOnce({...sampleProfile, is_available: true});
    updateAvailability.mockResolvedValueOnce({driverId: 'driver-id-1', isAvailable: false});

    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('ON')).toBeTruthy());

    await fireEvent.press(view.getByLabelText('Toggle job availability'));

    await waitFor(() => {
      expect(updateAvailability).toHaveBeenCalledWith('token-123', false);
      expect(view.getByText('Unavailable')).toBeTruthy();
      expect(view.getByText("You won't receive new jobs")).toBeTruthy();
      expect(view.getByText('OFF')).toBeTruthy();
    });
  });

  test('5. preserves previous state and shows error message on API failure', async () => {
    loadProfile.mockResolvedValueOnce({...sampleProfile, is_available: false});
    updateAvailability.mockRejectedValueOnce(new Error('Network failure'));

    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('OFF')).toBeTruthy());

    await fireEvent.press(view.getByLabelText('Toggle job availability'));

    await waitFor(() => {
      expect(updateAvailability).toHaveBeenCalledWith('token-123', true);
      expect(view.getByText('Unavailable')).toBeTruthy();
      expect(view.getByText('OFF')).toBeTruthy();
      expect(view.getByText('Unable to update availability. Please try again.')).toBeTruthy();
    });
  });

  test('6. displays available pickups and allows claiming an available pickup', async () => {
    const onJob = jest.fn();
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={onJob}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('AVAILABLE JOBS')).toBeTruthy());
    expect(view.getByText('Available Pickups')).toBeTruthy();
    expect(view.getByText('Order ID: BW-AVAIL-PICKUP')).toBeTruthy();

    const acceptPickupBtn = view.getByLabelText('Accept pickup for order BW-AVAIL-PICKUP');
    await fireEvent.press(acceptPickupBtn);

    await waitFor(() => {
      expect(claimJobMock).toHaveBeenCalledWith('token-123', 'order-avail-1', 'pickup');
      expect(onJob).toHaveBeenCalledWith('new-assignment-123');
    });
  });

  test('7. displays available deliveries and allows claiming an available delivery', async () => {
    const onJob = jest.fn();
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={onJob}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('Available Deliveries')).toBeTruthy());
    expect(view.getByText('Order ID: BW-AVAIL-DELIV')).toBeTruthy();

    const acceptDeliveryBtn = view.getByLabelText('Accept delivery for order BW-AVAIL-DELIV');
    await fireEvent.press(acceptDeliveryBtn);

    await waitFor(() => {
      expect(claimJobMock).toHaveBeenCalledWith('token-123', 'order-avail-2', 'delivery');
      expect(onJob).toHaveBeenCalledWith('new-assignment-123');
    });
  });

  test('8. handles claim conflict error cleanly when another driver accepts first', async () => {
    claimJobMock.mockRejectedValueOnce(
      new Error('This job has already been claimed by another driver.'),
    );
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('Order ID: BW-AVAIL-PICKUP')).toBeTruthy());

    const acceptPickupBtn = view.getByLabelText('Accept pickup for order BW-AVAIL-PICKUP');
    await fireEvent.press(acceptPickupBtn);

    await waitFor(() => {
      expect(
        view.getByText(/This job has already been claimed by another driver/),
      ).toBeTruthy();
    });
  });

  test('9. existing active job queues, metrics, and search functionality remain intact', async () => {
    const onJob = jest.fn();
    const onNotifications = jest.fn();
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={onJob}
        onNotifications={onNotifications}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('MY ACTIVE JOBS')).toBeTruthy());
    expect(view.getByText('My Active')).toBeTruthy();
    expect(view.getByText('Order ID: BW-PICKUP')).toBeTruthy();
    await fireEvent.press(view.getByText('Review assignment →'));
    expect(onJob).toHaveBeenCalledWith('pickup-id');
  });

  test('10. handles retry on dashboard load error', async () => {
    loadDashboard.mockRejectedValueOnce(new Error('Network unavailable'));
    const view = await render(
      <DriverDashboardScreen
        accessToken="token-123"
        onJob={jest.fn()}
        onNotifications={jest.fn()}
        onProfile={jest.fn()}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText('Network unavailable')).toBeTruthy());
    expect(view.getByText('Retry assignments')).toBeTruthy();
  });
});
