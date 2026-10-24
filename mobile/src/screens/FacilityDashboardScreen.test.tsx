jest.setTimeout(15000);

import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import FacilityDashboardScreen from './FacilityDashboardScreen';
import {getAvailableDeliveryDrivers, getFacilityDashboard, reassignFacilityDelivery} from '../services/facilityDashboardApi';
import {confirmFacilityReceiptByOrderId} from '../services/facilityIntakeApi';

let mockFacilityRealtimeCallback: ((event: any) => void) | null = null;

jest.mock('../hooks/useRealtime', () => ({
  useFacilityRealtime: jest.fn((facilityId, callback) => {
    mockFacilityRealtimeCallback = callback;
  }),
}));

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
    driverArrivedAtFacility: true,
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

test('shows In Transit and disables receiving when driver has not arrived at facility', async () => {
  load.mockResolvedValue({
    ...dashboard,
    orders: [{
      ...dashboard.orders[0],
      driverArrivedAtFacility: false,
    }],
  });
  const view = await render(<FacilityDashboardScreen accessToken="staff-token" onLogout={jest.fn()} onIntake={jest.fn()} onOrder={jest.fn()} />);
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
  expect(view.getByText('In Transit')).toBeTruthy();
  expect(view.getByText('Awaiting Arrival')).toBeTruthy();
  expect(view.getByText('Driver en route to facility')).toBeTruthy();
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

test('handles multiple incoming orders with mixed arrival states and scopes warnings', async () => {
  const mixedDashboard = {
    ...dashboard,
    summary: {incoming: 2, received: 0, processing: 0, ready: 0},
    orders: [
      {
        id: 'order-arrived',
        order_number: 'BW-ARRIVED',
        current_status: 'in_transit_to_facility',
        pickupDriverName: 'Ramesh Patel',
        deliveryAssignment: null,
        driverArrivedAtFacility: true,
      },
      {
        id: 'order-transit',
        order_number: 'BW-TRANSIT',
        current_status: 'in_transit_to_facility',
        pickupDriverName: 'Suresh Kumar',
        deliveryAssignment: null,
        driverArrivedAtFacility: false,
      },
    ],
  };
  load.mockResolvedValue(mixedDashboard);
  confirmReceipt.mockResolvedValue({orderId: 'order-arrived', orderStatus: 'received_at_facility'});

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('BW-ARRIVED')).toBeTruthy());
  expect(view.getByText('BW-TRANSIT')).toBeTruthy();

  // Arrived order displays DRIVER ARRIVED badge and enabled Receive Order button
  expect(view.getByText('DRIVER ARRIVED')).toBeTruthy();
  expect(view.getByText('Receive Order')).toBeTruthy();

  // In-transit order displays In Transit and Awaiting Arrival
  expect(view.getByText('In Transit')).toBeTruthy();
  expect(view.getByText('Awaiting Arrival')).toBeTruthy();

  // Receive arrived order succeeds without showing arrival warning
  fireEvent.press(view.getByText('Receive Order'));
  await waitFor(() => expect(confirmReceipt).toHaveBeenCalledWith('staff-token', 'BW-ARRIVED'));
});

test('updates driver arrival immediately via realtime event without manual refresh', async () => {
  load.mockResolvedValue({
    ...dashboard,
    orders: [{
      ...dashboard.orders[0],
      driverArrivedAtFacility: false,
    }],
  });

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
  expect(view.getByText('In Transit')).toBeTruthy();
  expect(view.getByText('Awaiting Arrival')).toBeTruthy();

  // Driver arrives at facility
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'DRIVER_ARRIVED_AT_FACILITY',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        driverName: 'Ramesh Patel',
        assignmentType: 'pickup',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // UI immediately updates without page reload or manual refresh
  await waitFor(() => expect(view.getByText('DRIVER ARRIVED')).toBeTruthy());
  expect(view.getByText('Receive Order')).toBeTruthy();
  expect(view.getByText('Incoming 1')).toBeTruthy();
});

test('moves order from Incoming to Received dynamically on FACILITY_INTAKE and recalculates counts', async () => {
  load.mockResolvedValue(dashboard);

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('Incoming 1')).toBeTruthy());
  expect(view.getByText('Received 0')).toBeTruthy();
  expect(view.getByText('BW-1001')).toBeTruthy();

  // Intake event received
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'FACILITY_INTAKE',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        status: 'received_at_facility',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Tab counts dynamically update immediately
  await waitFor(() => expect(view.getByText('Incoming 0')).toBeTruthy());
  expect(view.getByText('Received 1')).toBeTruthy();

  // Order is no longer in Incoming
  expect(view.getByText('No incoming orders')).toBeTruthy();

  // Switch to Received tab and verify card is there
  fireEvent.press(view.getByText('Received 1'));
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
  expect(view.getByText(/Verify garments/)).toBeTruthy();
  expect(view.getAllByText('received at facility').length).toBeGreaterThan(0);
});

test('advances order through verification and processing stages dynamically', async () => {
  load.mockResolvedValue({
    ...dashboard,
    summary: {incoming: 0, received: 1, processing: 0, ready: 0},
    orders: [{
      ...dashboard.orders[0],
      current_status: 'received_at_facility',
    }],
  });

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('Received 1')).toBeTruthy());

  // 1. Verification completed
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'FACILITY_VERIFICATION',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        status: 'verification',
      },
      timestamp: new Date().toISOString(),
    });
  });

  await waitFor(() => expect(view.getByText('Received 0')).toBeTruthy());
  expect(view.getByText('Processing 1')).toBeTruthy();

  // Switch to Processing tab
  fireEvent.press(view.getByText('Processing 1'));
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
  expect(view.getByText('VERIFICATION')).toBeTruthy();

  // 2. Processing stage: Washing started
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'PROCESSING_STAGE_STARTED',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        status: 'processing',
        stage: 'washing',
      },
      timestamp: new Date().toISOString(),
    });
  });

  await waitFor(() => expect(view.getByText('WASHING')).toBeTruthy());

  // 3. Processing stage: Drying started
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'PROCESSING_STAGE_STARTED',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        status: 'processing',
        stage: 'drying',
      },
      timestamp: new Date().toISOString(),
    });
  });

  await waitFor(() => expect(view.getByText('DRYING')).toBeTruthy());
});

test('transitions order to Ready for Delivery when QC passes', async () => {
  load.mockResolvedValue({
    ...dashboard,
    summary: {incoming: 0, received: 0, processing: 1, ready: 0},
    orders: [{
      ...dashboard.orders[0],
      current_status: 'processing',
      processingStage: 'packaging',
    }],
  });

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('Processing 1')).toBeTruthy());
  expect(view.getByText('Ready 0')).toBeTruthy();

  // QC Passed
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'QC_DECIDED',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        approved: true,
        status: 'ready_for_delivery',
      },
      timestamp: new Date().toISOString(),
    });
  });

  await waitFor(() => expect(view.getByText('Processing 0')).toBeTruthy());
  expect(view.getByText('Ready 1')).toBeTruthy();

  // Switch to Ready tab
  fireEvent.press(view.getByText('Ready 1'));
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());
  expect(view.getAllByText('ready for delivery').length).toBeGreaterThan(0);
});

test('removes order from Ready tab when driver departs facility', async () => {
  load.mockResolvedValue({
    ...dashboard,
    summary: {incoming: 0, received: 0, processing: 0, ready: 1},
    orders: [{
      ...dashboard.orders[0],
      current_status: 'ready_for_delivery',
      deliveryAssignment: {
        id: 'del-1',
        driverId: 'driver-1',
        driverName: 'Suresh Kumar',
        status: 'collected',
        rejectionReason: null,
        handedOver: true,
        collected: true,
      },
    }],
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
  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());

  // Driver starts delivery trip (leaves facility)
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'ORDER_STATUS_CHANGED',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        status: 'en_route_delivery',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Ready tab count drops to 0 and empty queue rendered
  await waitFor(() => expect(view.getByText('Ready 0')).toBeTruthy());
  expect(view.getByText('No ready orders')).toBeTruthy();
});

test('protects against stale in-flight API response overwriting newer event status', async () => {
  const initialDashboard = {
    ...dashboard,
    summary: {incoming: 1, received: 0, processing: 0, ready: 0},
    orders: [{
      ...dashboard.orders[0],
      current_status: 'in_transit_to_facility',
      updated_at: new Date(Date.now() - 7200000).toISOString(),
    }],
  };
  load.mockResolvedValueOnce(initialDashboard);

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('Incoming 1')).toBeTruthy());

  // Realtime event updates order to received_at_facility
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'FACILITY_INTAKE',
      entityId: 'order-1',
      orderId: 'order-1',
      orderNumber: 'BW-1001',
      payload: {
        status: 'received_at_facility',
      },
      timestamp: new Date().toISOString(),
    });
  });

  await waitFor(() => expect(view.getByText('Received 1')).toBeTruthy());

  // A stale background response resolves with old timestamp and old status
  load.mockResolvedValueOnce({
    ...dashboard,
    orders: [{
      ...dashboard.orders[0],
      current_status: 'in_transit_to_facility',
      updated_at: new Date(Date.now() - 3600000).toISOString(), // older than local event time
    }],
  });

  // Trigger manual refresh
  fireEvent.press(view.getByText('Refresh'));

  // Newer event-driven state is preserved!
  await waitFor(() => expect(view.getByText('Received 1')).toBeTruthy());
  expect(view.getByText('Incoming 0')).toBeTruthy();
});

test('deduplicates identical realtime events without creating duplicate cards', async () => {
  load.mockResolvedValue(dashboard);

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('Incoming 1')).toBeTruthy());

  const eventPayload = {
    eventType: 'FACILITY_INTAKE' as const,
    entityId: 'order-1',
    orderId: 'order-1',
    orderNumber: 'BW-1001',
    payload: {
      status: 'received_at_facility',
      timestamp: '2026-10-16T12:00:00.000Z',
    },
    timestamp: '2026-10-16T12:00:00.000Z',
  };

  // Fire event twice
  await act(async () => {
    mockFacilityRealtimeCallback?.(eventPayload);
  });
  await act(async () => {
    mockFacilityRealtimeCallback?.(eventPayload);
  });

  await waitFor(() => expect(view.getByText('Received 1')).toBeTruthy());
  expect(view.getByText('Incoming 0')).toBeTruthy();

  fireEvent.press(view.getByText('Received 1'));
  // Ensure exactly 1 card rendered, not 2
  await waitFor(() => expect(view.getAllByText('BW-1001')).toHaveLength(1));
});

test('handles RECONNECT_RECONCILE by silently reconciling data without full-page spinner', async () => {
  load.mockResolvedValue(dashboard);

  const view = await render(
    <FacilityDashboardScreen
      accessToken="staff-token"
      onLogout={jest.fn()}
      onIntake={jest.fn()}
      onOrder={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('BW-1001')).toBeTruthy());

  // Trigger reconnect reconcile event
  await act(async () => {
    mockFacilityRealtimeCallback?.({
      eventType: 'RECONNECT_RECONCILE',
      entityId: 'global',
      timestamp: new Date().toISOString(),
    });
  });

  // Expect getFacilityDashboard to have been called for background reconciliation
  expect(load).toHaveBeenCalledTimes(2);
  // Existing view was not replaced by empty or full-page spinner
  expect(view.getByText('BW-1001')).toBeTruthy();
});
