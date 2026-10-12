jest.setTimeout(15000);

import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import FacilityDashboardScreen from './FacilityDashboardScreen';
import {getAvailableDeliveryDrivers, getFacilityDashboard, reassignFacilityDelivery} from '../services/facilityDashboardApi';
import {confirmFacilityReceiptByOrderId} from '../services/facilityIntakeApi';

jest.mock('../services/facilityDashboardApi', () => ({
  getFacilityDashboard: jest.fn(),
  getAvailableDeliveryDrivers: jest.fn(),
  reassignFacilityDelivery: jest.fn(),
  handoverFacilityOrderToDriver: jest.fn(),
}));
jest.mock('../services/facilityIntakeApi', () => ({
  confirmFacilityReceiptByOrderId: jest.fn(),
}));

const load = getFacilityDashboard as jest.Mock;
const available = getAvailableDeliveryDrivers as jest.Mock;
const reassign = reassignFacilityDelivery as jest.Mock;
const confirmReceipt = confirmFacilityReceiptByOrderId as jest.Mock;

const dashboard = {
  facility: {id: 'facility-1', name: 'Hyderabad Facility', address: 'Banjara Hills, Hyderabad'},
  role: 'manager',
  summary: {incoming: 1, received: 0, processing: 0, ready: 0},
  orders: [{
    id: 'order-1',
    order_number: 'BW-1001',
    current_status: 'in_transit_to_facility',
    pickupDriverName: 'Ramesh Patel',
    deliveryAssignment: null,
  }],
};

beforeEach(() => {jest.clearAllMocks();});

test('shows assigned facility, status counts and orders from authenticated endpoint', async () => {
  load.mockResolvedValue(dashboard);
  const view = await render(<FacilityDashboardScreen accessToken="staff-token" onLogout={jest.fn()} onIntake={jest.fn()} onOrder={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Hyderabad Facility')).toBeTruthy());
  expect(load).toHaveBeenCalledWith('staff-token');
  expect(view.getByText('Facility Manager')).toBeTruthy();
  expect(view.getByText('Incoming 1')).toBeTruthy();
  expect(view.getByText('BW-1001')).toBeTruthy();
  expect(view.getByText('Driver: Ramesh Patel')).toBeTruthy();
  expect(view.getByText('Receive Order')).toBeTruthy();
});

test('allows facility employee to directly receive incoming order', async () => {
  load.mockResolvedValue(dashboard);
  confirmReceipt.mockResolvedValue({orderId: 'order-1', orderStatus: 'received_at_facility'});
  const view = await render(<FacilityDashboardScreen accessToken="staff-token" onLogout={jest.fn()} onIntake={jest.fn()} onOrder={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Receive Order')).toBeTruthy());
  fireEvent.press(view.getByText('Receive Order'));
  await waitFor(() => expect(confirmReceipt).toHaveBeenCalledWith('staff-token', 'BW-1001'));
});

test('shows clear Incoming, Received, Processing and Ready tabs and empty queues', async () => {
  load.mockResolvedValue({...dashboard, role: 'facility_employee', orders: []});
  const view = await render(<FacilityDashboardScreen accessToken="staff-token" onLogout={jest.fn()} onIntake={jest.fn()} onOrder={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No incoming orders')).toBeTruthy());
  expect(view.getByText('Facility Employee')).toBeTruthy();
  expect(view.getByText('Received 0')).toBeTruthy();
  expect(view.getByText('Processing 0')).toBeTruthy();
  expect(view.getByText('Ready 0')).toBeTruthy();

  fireEvent.press(view.getByText('Received 0'));
  await waitFor(() => expect(view.getByText('No received orders')).toBeTruthy());
});

test('clears stale data after failure and retries', async () => {
  load.mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(dashboard);
  const view = await render(<FacilityDashboardScreen accessToken="staff-token" onLogout={jest.fn()} onIntake={jest.fn()} onOrder={jest.fn()} />);
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
  fireEvent.press(view.getByText('Refresh'));
  await waitFor(() => expect(view.getByText('Network unavailable')).toBeTruthy());
  expect(view.queryByText('BW-1001')).toBeNull();
  fireEvent.press(view.getByText('Retry dashboard'));
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
});

test('keeps an unaccepted delivery in Ready and reassigns a rejected delivery', async () => {
  const readyDashboard = {
    ...dashboard,
    summary: {incoming: 0, received: 0, processing: 0, ready: 2},
    orders: [
      {id: 'assigned-order', order_number: 'BW-ASSIGNED', current_status: 'delivery_assigned',
        deliveryAssignment: {id: 'assignment-1', driverId: 'driver-1', status: 'assigned', rejectionReason: null}},
      {id: 'rejected-order', order_number: 'BW-REJECTED', current_status: 'delivery_failed',
        deliveryAssignment: {id: 'assignment-2', driverId: 'driver-2', status: 'rejected', rejectionReason: 'Route unavailable'}},
    ],
  };
  load.mockResolvedValue(readyDashboard);
  available.mockResolvedValue({drivers: [{id: 'driver-3', name: 'Meera Shah', activeJobs: 1}]});
  reassign.mockResolvedValue({assignment: {id: 'replacement'}});
  const view = await render(<FacilityDashboardScreen accessToken="staff-token" onLogout={jest.fn()} onIntake={jest.fn()} onOrder={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Ready 2')).toBeTruthy());
  fireEvent.press(view.getByText('Ready 2'));
  await waitFor(() => expect(view.getByText('Waiting for Driver acceptance.')).toBeTruthy());
  expect(view.getByText('Driver rejected the delivery: Route unavailable')).toBeTruthy();
  fireEvent.press(view.getByText('Reassign Driver'));
  await waitFor(() => expect(available).toHaveBeenCalledWith('staff-token', 'rejected-order'));
  await waitFor(() => expect(view.getByText('Meera Shah')).toBeTruthy());
  fireEvent.press(view.getByText('Meera Shah'));
  await waitFor(() => expect(reassign).toHaveBeenCalledWith('staff-token', 'rejected-order', 'driver-3'));
  await waitFor(() => expect(view.getByText('Delivery assigned to Meera Shah. Waiting for acceptance.')).toBeTruthy());
});

test('shows delivery_accepted order with arrived driver in Ready tab and allows handover', async () => {
  const handoverDashboard = {
    ...dashboard,
    summary: {incoming: 0, received: 0, processing: 0, ready: 1},
    orders: [
      {
        id: 'ready-order-1',
        order_number: 'BW-20261001-3F97A3B9',
        current_status: 'delivery_accepted',
        deliveryAssignment: {
          id: 'assignment-1',
          driverId: 'driver-1',
          driverName: 'Suresh Kumar',
          status: 'arrived',
          rejectionReason: null,
          handedOver: false,
          handedOverAt: null,
        },
      },
    ],
  };
  load.mockResolvedValue(handoverDashboard);
  const {handoverFacilityOrderToDriver} = require('../services/facilityDashboardApi');
  (handoverFacilityOrderToDriver as jest.Mock).mockResolvedValue({
    handedOver: true,
  });

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('Ready 1')).toBeTruthy());
  fireEvent.press(view.getByText('Ready 1'));

  await waitFor(() => expect(view.getByText('DRIVER ARRIVED')).toBeTruthy());
  expect(view.getByText('Delivery Driver: Suresh Kumar')).toBeTruthy();
  expect(view.getByText('Driver arrived at facility (awaiting handover)')).toBeTruthy();
  expect(view.getByText('Hand Over Order')).toBeTruthy();

  fireEvent.press(view.getByText('Hand Over Order'));
  await waitFor(() =>
    expect(handoverFacilityOrderToDriver).toHaveBeenCalledWith(
      'staff-token',
      'ready-order-1',
      'driver-1',
    ),
  );
});
