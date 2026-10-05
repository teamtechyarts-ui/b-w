// @ts-ignore
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(15000);

import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import {
  getCurrentDeviceLocation,
  requestAndroidLocationPermission,
} from '../services/deviceLocationService';
import { startDriverTripIos } from '../services/driverTripBackground';
import DriverJobDetailScreen from './DriverJobDetailScreen';
import {
  acceptDriverJob,
  beginFacilityTransit,
  getDriverHandoffQr,
  getDriverJob,
  markDriverArrived,
  publishDriverTripLocation,
  rejectDriverJob,
  startDriverNavigation,
  verifyDriverPickupOtp,
} from '../services/driverAssignmentsApi';
import {
  chooseDeliveryPhoto,
  completeDriverDelivery,
  uploadDeliveryPhoto,
} from '../services/driverDeliveryApi';

jest.mock('../services/driverAssignmentsApi', () => ({
  getDriverJob: jest.fn(),
  acceptDriverJob: jest.fn(),
  rejectDriverJob: jest.fn(),
  startDriverNavigation: jest.fn(),
  markDriverArrived: jest.fn(),
  verifyDriverPickupOtp: jest.fn(),
  beginFacilityTransit: jest.fn(),
  getDriverHandoffQr: jest.fn(),
  publishDriverTripLocation: jest.fn(),
  formatDriverAddress: jest.fn(() => '1 Test Road'),
}));
jest.mock('../services/deviceLocationService', () => ({
  requestAndroidLocationPermission: jest.fn().mockResolvedValue(true),
  getCurrentDeviceLocation: jest
    .fn()
    .mockResolvedValue({ latitude: 17.4, longitude: 78.4 }),
}));
jest.mock('../services/driverTripBackground', () => ({
  startDriverTripBackground: jest.fn().mockResolvedValue(undefined),
  startDriverTripIos: jest.fn().mockResolvedValue(undefined),
  stopDriverTripBackground: jest.fn().mockResolvedValue(undefined),
  subscribeDriverTripStatus: jest.fn(() => jest.fn()),
}));
jest.mock('../services/driverDeliveryApi', () => ({
  chooseDeliveryPhoto: jest.fn(),
  uploadDeliveryPhoto: jest.fn(),
  completeDriverDelivery: jest.fn(),
}));
const load = getDriverJob as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  load.mockReset();
  (acceptDriverJob as jest.Mock).mockReset();
  (rejectDriverJob as jest.Mock).mockReset();
  (startDriverNavigation as jest.Mock).mockReset();
  (markDriverArrived as jest.Mock).mockReset();
  (verifyDriverPickupOtp as jest.Mock).mockReset();
  (chooseDeliveryPhoto as jest.Mock).mockReset();
  (uploadDeliveryPhoto as jest.Mock).mockReset();
  (completeDriverDelivery as jest.Mock).mockReset();
  (publishDriverTripLocation as jest.Mock).mockReset();
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockResolvedValue({
    latitude: 17.4,
    longitude: 78.4,
  });
});

afterEach(() => cleanup());

const offeredJob = {
  id: 'job-1',
  orderId: 'order-123456',
  orderNumber: 'BW-20260921-ABC12345',
  type: 'pickup',
  assignmentStatus: 'assigned',
  orderStatus: 'pickup_assigned',
  assignedAt: '2026-09-18T09:00:00Z',
  acceptedAt: null,
  completedAt: null,
  pickupScheduledAt: null,
  pickupSlotLabel: null,
  address: {},
  facility: null,
  customer: null,
};

test('requires reason before rejecting, then refreshes after successful rejection', async () => {
  load.mockResolvedValueOnce(offeredJob).mockResolvedValueOnce(null);
  (rejectDriverJob as jest.Mock).mockResolvedValue({});
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() => expect(view.getByText('Reject job')).toBeTruthy());
  await fireEvent.press(view.getByText('Reject job'));
  await waitFor(() =>
    expect(view.getByText('A rejection reason is required.')).toBeTruthy(),
  );
  await fireEvent.changeText(
    view.getByPlaceholderText('Reason for rejection'),
    'Cannot reach address',
  );
  await fireEvent.press(view.getByText('Reject job'));
  await waitFor(() =>
    expect(rejectDriverJob).toHaveBeenCalledWith(
      'token',
      'job-1',
      'Cannot reach address',
    ),
  );
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(view.getByText('Job rejected. Admin can reassign it.')).toBeTruthy(),
  );
});

test('accepts offered job and reloads its updated status', async () => {
  load
    .mockResolvedValueOnce(offeredJob)
    .mockResolvedValueOnce({
      ...offeredJob,
      assignmentStatus: 'accepted',
      orderStatus: 'pickup_accepted',
    });
  (acceptDriverJob as jest.Mock).mockResolvedValue({});
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() => expect(view.getByText('Accept job')).toBeTruthy());
  fireEvent.press(view.getByText('Accept job'));
  await waitFor(() => expect(view.getByText('Job accepted.')).toBeTruthy());
  expect(view.queryByText('Accept job')).toBeNull();
});

test('starts an accepted pickup trip and offers native directions to its address', async () => {
  const accepted = {
    ...offeredJob,
    assignmentStatus: 'accepted',
    orderStatus: 'pickup_accepted',
    address: { address_line1: '1 Test Road', latitude: 17.4, longitude: 78.4 },
  };
  load
    .mockResolvedValueOnce(accepted)
    .mockResolvedValue({
      ...accepted,
      assignmentStatus: 'en_route',
      orderStatus: 'en_route_pickup',
    });
  (startDriverNavigation as jest.Mock).mockResolvedValue({
    status: 'en_route',
  });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() => expect(view.getByText('Start trip')).toBeTruthy());
  await fireEvent.press(view.getByText('Start trip'));
  await waitFor(() =>
    expect(view.getByText('Navigate to pickup')).toBeTruthy(),
  );
  expect(startDriverNavigation).toHaveBeenCalledWith('token', 'job-1');
  await fireEvent.press(view.getByText('Navigate to pickup'));
  expect(open).toHaveBeenCalledWith(expect.stringContaining('17.4,78.4'));
  open.mockRestore();
});

test('shows a permission-denied state instead of publishing GPS', async () => {
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(false);
  load.mockResolvedValue({
    ...offeredJob,
    assignmentStatus: 'en_route',
    orderStatus: 'en_route_pickup',
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      view.getByText(
        'Location permission denied. Enable location in Settings.',
      ),
    ).toBeTruthy(),
  );
});

test('continues active-trip GPS when B&W moves to the background', async () => {
  const previousState = Object.getOwnPropertyDescriptor(
    AppState,
    'currentState',
  );
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
  let onState: ((state: string) => void) | undefined;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback: any) => {
      onState = callback;
      return { remove: jest.fn() } as any;
    });
  load.mockResolvedValue({
    ...offeredJob,
    assignmentStatus: 'en_route',
    orderStatus: 'en_route_pickup',
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(startDriverTripIos).toHaveBeenCalledWith('job-1', 'token'),
  );
  onState?.('background');
  await waitFor(() =>
    expect(
      view.getByText('Location sharing continues for this active trip.'),
    ).toBeTruthy(),
  );
  listener.mockRestore();
  if (previousState)
    Object.defineProperty(AppState, 'currentState', previousState);
});

test('shows operational contact and facility only for an assigned active job', async () => {
  load.mockResolvedValue({
    id: 'job-1',
    orderId: 'order-123456',
    type: 'pickup',
    assignmentStatus: 'assigned',
    orderStatus: 'pickup_assigned',
    assignedAt: '2026-09-18T09:00:00Z',
    acceptedAt: null,
    completedAt: null,
    pickupScheduledAt: null,
    pickupSlotLabel: null,
    address: {},
    facility: { name: 'Local Facility', address: '2 Work Road' },
    customer: { name: 'Fictional Customer', phone: '+16505550101' },
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Fictional Customer')).toBeTruthy(),
  );
  expect(view.getByText('+16505550101')).toBeTruthy();
  expect(view.getByText('Local Facility · 2 Work Road')).toBeTruthy();
  expect(load).toHaveBeenCalledWith('token', 'job-1');
});

test('completed job omits customer contact', async () => {
  load.mockResolvedValue({
    id: 'job-1',
    orderId: 'order-123456',
    type: 'delivery',
    assignmentStatus: 'completed',
    orderStatus: 'delivered',
    assignedAt: '2026-09-18T09:00:00Z',
    acceptedAt: null,
    completedAt: '2026-09-18T10:00:00Z',
    pickupScheduledAt: null,
    pickupSlotLabel: null,
    address: null,
    facility: null,
    customer: null,
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() => expect(view.getByText('Job details')).toBeTruthy());
  expect(view.queryByText('Customer contact')).toBeNull();
});

test('missing or unauthorized job shows an error and retry', async () => {
  load.mockRejectedValue(new Error('Assignment not found'));
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="other-driver-job"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Assignment not found')).toBeTruthy(),
  );
  expect(view.getByText('Retry job')).toBeTruthy();
});

const arrivedPickup = {
  ...offeredJob,
  assignmentStatus: 'arrived',
  orderStatus: 'pickup_otp_pending',
  items: [
    {
      id: 'item-1',
      item_name: 'Shirts',
      quantity: 2,
      weight_kg: 1.5,
      customer_notes: 'Blue bag',
    },
  ],
};

test('arrival reveals the existing pickup OTP handover flow', async () => {
  load
    .mockResolvedValueOnce({
      ...offeredJob,
      assignmentStatus: 'en_route',
      orderStatus: 'en_route_pickup',
    })
    .mockResolvedValue(arrivedPickup);
  (markDriverArrived as jest.Mock).mockResolvedValue({});
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('I arrived at pickup')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('I arrived at pickup'));
  await waitFor(() =>
    expect(markDriverArrived).toHaveBeenCalledWith('token', 'job-1'),
  );
  await waitFor(() =>
    expect(view.getByText('Verify OTP and complete pickup')).toBeTruthy(),
  );
  expect(view.getByText('Shirts · 2 items · 1.5 kg · Blue bag')).toBeTruthy();
});

test('requires garment review and six-digit OTP, and displays backend rejection', async () => {
  load.mockResolvedValue(arrivedPickup);
  (verifyDriverPickupOtp as jest.Mock).mockRejectedValue(
    new Error('Invalid OTP'),
  );
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Verify OTP and complete pickup')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Verify OTP and complete pickup'));
  await waitFor(() =>
    expect(
      view.getByText('Review and confirm the garments handed over.'),
    ).toBeTruthy(),
  );
  await fireEvent.press(view.getByLabelText('I checked the garments handed over'));
  await waitFor(() =>
    expect(view.getByText('I checked the garments handed over')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Verify OTP and complete pickup'));
  await waitFor(() =>
    expect(view.getByText('Enter the six-digit pickup OTP.')).toBeTruthy(),
  );
  await fireEvent.changeText(
    view.getByPlaceholderText('Six-digit pickup OTP'),
    '000000',
  );
  await fireEvent.press(view.getByText('Verify OTP and complete pickup'));
  await waitFor(() => expect(view.getByText('Invalid OTP')).toBeTruthy());
  expect(verifyDriverPickupOtp).toHaveBeenCalledWith(
    'token',
    'order-123456',
    '000000',
  );
});

test('successful pickup OTP refreshes the job and shows the next valid state', async () => {
  load
    .mockResolvedValueOnce(arrivedPickup)
    .mockResolvedValue({ ...arrivedPickup, orderStatus: 'picked_up' });
  (verifyDriverPickupOtp as jest.Mock).mockResolvedValue({
    verified: true,
    orderStatus: 'picked_up',
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Verify OTP and complete pickup')).toBeTruthy(),
  );
  await fireEvent.press(view.getByLabelText('I checked the garments handed over'));
  await waitFor(() =>
    expect(view.getByText('I checked the garments handed over')).toBeTruthy(),
  );
  await fireEvent.changeText(
    view.getByPlaceholderText('Six-digit pickup OTP'),
    '123456',
  );
  await fireEvent.press(view.getByText('Verify OTP and complete pickup'));
  await waitFor(() =>
    expect(verifyDriverPickupOtp).toHaveBeenCalledWith(
      'token',
      'order-123456',
      '123456',
    ),
  );
  await waitFor(() =>
    expect(
      view.getByText(
        'Pickup complete. Take the garments to the assigned facility.',
      ),
    ).toBeTruthy(),
  );
  expect(view.queryByText('Verify OTP and complete pickup')).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});

test('only a picked-up job can start facility transit and show its scoped handoff code', async () => {
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  const transit = { ...picked, orderStatus: 'in_transit_to_facility' };
  load.mockResolvedValueOnce(picked).mockResolvedValue(transit);
  (beginFacilityTransit as jest.Mock).mockResolvedValue({
    orderStatus: 'in_transit_to_facility',
  });
  (getDriverHandoffQr as jest.Mock).mockResolvedValue({
    orderId: picked.orderId,
    payload: 'BW1:fictional-code',
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  expect(view.getByText('Order ID')).toBeTruthy();
  expect(view.getByText('BW-20260921-ABC12345')).toBeTruthy();
  expect(view.getByText('Assigned facility')).toBeTruthy();
  expect(view.getByText('Local Facility · 2 Work Road')).toBeTruthy();
  fireEvent.press(view.getByText('Start facility transit'));
  await waitFor(() =>
    expect(view.getByText('Show facility handoff QR')).toBeTruthy(),
  );
  expect(beginFacilityTransit).toHaveBeenCalledWith('token', 'job-1');
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining('17.4,78.4')),
  );
  fireEvent.press(view.getByText('Show facility handoff QR'));
  await waitFor(() =>
    expect(view.getByLabelText('Facility handoff QR code')).toBeTruthy(),
  );
  expect(view.getByText('Order BW-20260921-ABC12345')).toBeTruthy();
  expect(getDriverHandoffQr).toHaveBeenCalledWith('token', 'job-1');
  openUrl.mockRestore();
});

test('facility receipt clears Driver handoff controls', async () => {
  load.mockResolvedValue({
    ...arrivedPickup,
    orderStatus: 'received_at_facility',
    assignmentStatus: 'completed',
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      view.getByText(
        'Facility confirmed receipt. Pickup responsibility is complete.',
      ),
    ).toBeTruthy(),
  );
  expect(view.queryByText('Start facility transit')).toBeNull();
  expect(view.queryByText('Show facility handoff QR')).toBeNull();
});

const arrivedDelivery = {
  ...offeredJob,
  type: 'delivery',
  assignmentStatus: 'arrived',
  orderStatus: 'delivery_otp_pending',
};

test('delivery arrival opens required OTP and photograph handover', async () => {
  load
    .mockResolvedValueOnce({
      ...arrivedDelivery,
      assignmentStatus: 'en_route',
      orderStatus: 'en_route_delivery',
    })
    .mockResolvedValue(arrivedDelivery);
  (markDriverArrived as jest.Mock).mockResolvedValue({});
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('I arrived at delivery')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('I arrived at delivery'));
  await waitFor(() =>
    expect(view.getByText('Verify OTP and complete delivery')).toBeTruthy(),
  );
  expect(view.getByText('No delivery photograph uploaded.')).toBeTruthy();
});

test('delivery blocks missing OTP and photo, then refreshes after atomic completion', async () => {
  load
    .mockResolvedValueOnce(arrivedDelivery)
    .mockResolvedValue({
      ...arrivedDelivery,
      assignmentStatus: 'completed',
      orderStatus: 'claim_period_active',
    });
  (chooseDeliveryPhoto as jest.Mock).mockResolvedValue({
    uri: 'file:///photo.jpg',
    name: 'photo.jpg',
    type: 'image/jpeg',
  });
  (uploadDeliveryPhoto as jest.Mock).mockResolvedValue(
    'order-123456/photo.jpg',
  );
  (completeDriverDelivery as jest.Mock).mockResolvedValue({
    delivered: true,
    orderStatus: 'claim_period_active',
  });
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Verify OTP and complete delivery')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Verify OTP and complete delivery'));
  await waitFor(() =>
    expect(view.getByText('Enter the six-digit delivery OTP.')).toBeTruthy(),
  );
  await fireEvent.changeText(
    view.getByPlaceholderText('Six-digit delivery OTP'),
    '123456',
  );
  await fireEvent.press(view.getByText('Verify OTP and complete delivery'));
  await waitFor(() =>
    expect(
      view.getByText('Take and upload a delivery photograph first.'),
    ).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Take delivery photo'));
  expect(chooseDeliveryPhoto).toHaveBeenCalledWith('camera');
  await waitFor(() =>
    expect(view.getByText('Delivery photograph uploaded')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Verify OTP and complete delivery'));
  await waitFor(() =>
    expect(completeDriverDelivery).toHaveBeenCalledWith(
      'token',
      'order-123456',
      '123456',
      'order-123456/photo.jpg',
    ),
  );
  await waitFor(() =>
    expect(
      view.getByText('Delivery complete. Proof retained; tracking ended.'),
    ).toBeTruthy(),
  );
  expect(view.queryByText('Verify OTP and complete delivery')).toBeNull();
});

test('upload or OTP rejection leaves delivery handover available for retry', async () => {
  load.mockResolvedValue(arrivedDelivery);
  (chooseDeliveryPhoto as jest.Mock).mockResolvedValue({
    uri: 'file:///photo.jpg',
    name: 'photo.jpg',
    type: 'image/jpeg',
  });
  (uploadDeliveryPhoto as jest.Mock)
    .mockRejectedValueOnce(new Error('Photograph upload failed'))
    .mockResolvedValueOnce('order-123456/photo.jpg');
  (completeDriverDelivery as jest.Mock).mockRejectedValue(
    new Error('Invalid delivery OTP'),
  );
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Take delivery photo')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Take delivery photo'));
  await waitFor(() =>
    expect(view.getByText('Photograph upload failed')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Take delivery photo'));
  await waitFor(() =>
    expect(view.getByText('Delivery photograph uploaded')).toBeTruthy(),
  );
  await fireEvent.changeText(
    view.getByPlaceholderText('Six-digit delivery OTP'),
    '000000',
  );
  await fireEvent.press(view.getByText('Verify OTP and complete delivery'));
  await waitFor(() =>
    expect(view.getByText('Invalid delivery OTP')).toBeTruthy(),
  );
  expect(view.getByText('Verify OTP and complete delivery')).toBeTruthy();
});

test('driver can choose delivery proof from the phone', async () => {
  load.mockResolvedValue(arrivedDelivery);
  (chooseDeliveryPhoto as jest.Mock).mockResolvedValue({
    uri: 'file:///proof.png',
    name: 'proof.png',
    type: 'image/png',
  });
  (uploadDeliveryPhoto as jest.Mock).mockResolvedValue(
    'order-123456/proof.png',
  );
  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Choose photo from phone')).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Choose photo from phone'));
  await waitFor(() =>
    expect(chooseDeliveryPhoto).toHaveBeenCalledWith('library'),
  );
  await waitFor(() =>
    expect(view.getByText('Delivery photograph uploaded')).toBeTruthy(),
  );
});

test('rapid duplicate taps send only one assignment accept request', async () => {
  let resolveAccept!: () => void;
  const acceptPromise = new Promise<void>(res => {
    resolveAccept = res;
  });
  (acceptDriverJob as jest.Mock).mockImplementation(() => acceptPromise);
  load
    .mockResolvedValueOnce(offeredJob)
    .mockResolvedValue({
      ...offeredJob,
      assignmentStatus: 'accepted',
      orderStatus: 'pickup_accepted',
    });

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );
  await waitFor(() => expect(view.getByText('Accept job')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Accept job'));
    fireEvent.press(view.getByText('Accept job'));
    expect(acceptDriverJob).toHaveBeenCalledTimes(1);
    resolveAccept();
  });

  await waitFor(() => expect(view.getByText('Job accepted.')).toBeTruthy());
  await waitFor(() => expect(view.queryByText('Accept job')).toBeNull());
});

test('facility transit shows permission guidance if device location permission is denied', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(false);

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() =>
    expect(view.getByText('Open Location Settings')).toBeTruthy(),
  );
  expect(view.getByText('Try Again')).toBeTruthy();
  expect(
    view.getByText('We need your current location to start facility transit.'),
  ).toBeTruthy();
  expect(beginFacilityTransit).not.toHaveBeenCalled();
});

test('facility transit shows GPS error guidance if device GPS is unavailable', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockRejectedValue(
    new Error('GPS timeout'),
  );

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() =>
    expect(
      view.getByText('Unable to get your current location.'),
    ).toBeTruthy(),
  );
  expect(
    view.getByText('Please move to an area with GPS access and try again.'),
  ).toBeTruthy();
  expect(beginFacilityTransit).not.toHaveBeenCalled();
});

test('maps backend location error to human readable guidance', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockResolvedValue({
    latitude: 17.4,
    longitude: 78.4,
  });
  (beginFacilityTransit as jest.Mock).mockRejectedValue(
    new Error('Driver location is required for facility transit'),
  );

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() =>
    expect(
      view.getByText(
        'Your current location is required before you can start facility transit.',
      ),
    ).toBeTruthy(),
  );
});

test('maps RPC schema cache failure to human readable guidance', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockResolvedValue({
    latitude: 17.4,
    longitude: 78.4,
  });
  (publishDriverTripLocation as jest.Mock).mockRejectedValue(
    new Error(
      'Could not find the function public.publish_driver_trip_location_atomic(p_accuracy_m, p_assignment_id, p_driver_id, p_latitude, p_longitude) in the schema cache',
    ),
  );

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() =>
    expect(
      view.getByText('Unable to update your location. Please try again.'),
    ).toBeTruthy(),
  );
});

test('maps Maps API not configured error to readable non-blocking navigation guidance', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockResolvedValue({
    latitude: 17.4,
    longitude: 78.4,
  });
  (publishDriverTripLocation as jest.Mock).mockResolvedValue({
    published: true,
    recordedAt: '2026-10-02T12:00:00Z',
  });
  (beginFacilityTransit as jest.Mock).mockRejectedValue(
    new Error('Google Maps API is not configured for this environment.'),
  );

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() =>
    expect(
      view.getByText(
        'Navigation is unavailable. Your location has been updated. You can continue the facility handoff without in-app navigation.',
      ),
    ).toBeTruthy(),
  );
});

test('handles low GPS accuracy by displaying clear guidance and retry button', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Local Facility',
      address: '2 Work Road',
      latitude: 17.4,
      longitude: 78.4,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockRejectedValue(
    new Error('Your location accuracy is low (1500m). Move to an area with a clearer GPS signal and try again.'),
  );

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() =>
    expect(
      view.getByText('Your location accuracy is low.'),
    ).toBeTruthy(),
  );
  expect(view.getByText('Retry Location')).toBeTruthy();
});

test('supplies fresh device GPS coordinates as origin to external navigation', async () => {
  const picked = {
    ...arrivedPickup,
    orderStatus: 'picked_up',
    facility: {
      name: 'Central Facility',
      address: 'Hayathnagar',
      latitude: 17.3328,
      longitude: 78.5795,
    },
  };
  load.mockResolvedValue(picked);
  (requestAndroidLocationPermission as jest.Mock).mockResolvedValue(true);
  (getCurrentDeviceLocation as jest.Mock).mockResolvedValue({
    latitude: 17.3750,
    longitude: 78.5550,
    accuracy: 15,
  });
  (publishDriverTripLocation as jest.Mock).mockResolvedValue({
    published: true,
    recordedAt: '2026-10-02T12:00:00Z',
  });
  (beginFacilityTransit as jest.Mock).mockResolvedValue({
    assignmentId: 'job-1',
    orderId: 'order-1',
    assignmentStatus: 'arrived',
    orderStatus: 'in_transit_to_facility',
  });

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Start facility transit')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Start facility transit'));

  await waitFor(() => {
    expect(publishDriverTripLocation).toHaveBeenCalledWith(
      'token',
      'job-1',
      17.375,
      78.555,
      15,
    );
  });
});

test('Navigate to facility button fetches fresh GPS if not cached and opens external directions with mandatory origin', async () => {
  const inTransitJob = {
    ...arrivedPickup,
    assignmentStatus: 'arrived',
    orderStatus: 'in_transit_to_facility',
    facility: {
      name: 'Central Facility',
      address: 'Hayathnagar',
      latitude: 17.3328127,
      longitude: 78.5795357,
    },
  };
  load.mockResolvedValue(inTransitJob);
  (getCurrentDeviceLocation as jest.Mock).mockResolvedValue({
    latitude: 17.3751234,
    longitude: 78.5554321,
    accuracy: 10,
  });

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Navigate to facility')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Navigate to facility'));

  await waitFor(() => {
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringMatching(
        /(saddr=17\.3751234,78\.5554321|origin=17\.3751234%2C78\.5554321)/,
      ),
    );
  });
});

test('Navigate to facility button blocks navigation when GPS is unavailable and shows actionable error', async () => {
  const inTransitJob = {
    ...arrivedPickup,
    assignmentStatus: 'arrived',
    orderStatus: 'in_transit_to_facility',
    facility: {
      name: 'Central Facility',
      address: 'Hayathnagar',
      latitude: 17.3328127,
      longitude: 78.5795357,
    },
  };
  load.mockResolvedValue(inTransitJob);
  (getCurrentDeviceLocation as jest.Mock).mockRejectedValue(
    new Error('Unable to determine current location'),
  );

  const view = await render(
    <DriverJobDetailScreen
      accessToken="token"
      assignmentId="job-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() =>
    expect(view.getByText('Navigate to facility')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('Navigate to facility'));

  await waitFor(() => {
    expect(
      view.getByText(
        'Your current location is required to open directions. Please update your location and try again.',
      ),
    ).toBeTruthy();
  });
  expect(Linking.openURL).not.toHaveBeenCalled();
});





