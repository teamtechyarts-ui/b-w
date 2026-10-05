import React from 'react';
import {cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import AdminFacilityOversightScreen from './AdminFacilityOversightScreen';
import {getAdminFacility, getAdminFacilityOrder, listAdminFacilities} from '../services/adminFacilityOversightApi';

jest.mock('../services/adminFacilityOversightApi', () => ({
  listAdminFacilities: jest.fn(),
  getAdminFacility: jest.fn(),
  getAdminFacilityOrder: jest.fn(),
}));

const summaryA = {
  id: 'facility-a',
  name: 'Hyderabad Central Facility',
  address: 'Hitech City, Hyderabad',
  isActive: true,
  workload: 3,
  received: 1,
  verification: 1,
  openDiscrepancies: 1,
  stages: {washing: 1, drying: 0, ironing: 0, folding: 0, packaging: 0},
  qcFailures: 0,
  rewashCycles: 0,
  packed: 0,
  ready: 1,
  ageWarnings: 1,
  stuckOrders: 1,
  oldestActiveHours: 28,
  activeStaff: 4,
  activeMachines: 2,
  installedMachineCapacityKg: 50,
};

const summaryB = {
  id: 'facility-b',
  name: 'Karimnagar Facility',
  address: 'Collectorate Road, Karimnagar',
  isActive: false,
  workload: 0,
  received: 0,
  verification: 0,
  openDiscrepancies: 0,
  stages: {washing: 0, drying: 0, ironing: 0, folding: 0, packaging: 0},
  qcFailures: 0,
  rewashCycles: 0,
  packed: 0,
  ready: 0,
  ageWarnings: 0,
  stuckOrders: 0,
  oldestActiveHours: 0,
  activeStaff: 0,
  activeMachines: 1,
  installedMachineCapacityKg: 20,
};

const ordersList = [
  {
    id: 'order-1',
    order_number: 'BW-20261003-001',
    current_status: 'processing',
    latestStage: 'washing',
    processingAgeHours: 28,
    ageWarning: true,
    stuck: true,
    openDiscrepancies: 1,
    updated_at: '2026-10-02T12:00:00Z',
  },
  {
    id: 'order-2',
    order_number: 'BW-20261003-002',
    current_status: 'ready_for_delivery',
    latestStage: 'packaging',
    processingAgeHours: 2,
    ageWarning: false,
    stuck: false,
    openDiscrepancies: 0,
    updated_at: '2026-10-03T10:00:00Z',
  },
  {
    id: 'order-3',
    order_number: 'BW-20261003-003',
    current_status: 'received_at_facility',
    latestStage: null,
    processingAgeHours: 0.5,
    ageWarning: false,
    stuck: false,
    openDiscrepancies: 0,
    updated_at: '2026-10-03T11:00:00Z',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  (listAdminFacilities as jest.Mock).mockResolvedValue({
    monitoring: {ageWarningHours: 4, stuckHours: 24, contractualSla: false},
    facilities: [summaryA, summaryB],
  });
  (getAdminFacility as jest.Mock).mockResolvedValue({
    summary: summaryA,
    orders: ordersList,
  });
  (getAdminFacilityOrder as jest.Mock).mockResolvedValue({
    order: {id: 'order-1', order_number: 'BW-20261003-001', current_status: 'processing'},
    operations: [
      {
        id: 'op-1',
        operation_type: 'washing',
        current_status: 'started',
        started_at: '2026-10-02T14:00:00Z',
        completed_at: null,
      },
    ],
    inspections: [
      {
        id: 'insp-1',
        counted_quantity: 5,
        weight_kg: 3.5,
        condition_notes: 'Clean condition',
      },
    ],
    discrepancies: [
      {
        id: 'disc-1',
        kind: 'missing_garment',
        status: 'open',
        notes: 'Missing 1 shirt from count',
        resolution_notes: null,
      },
    ],
    qc: [{id: 'qc-1', cycle_number: 1, approved: true, defect_code: null, reason: null}],
    packings: [{id: 'pack-1', parcel_id: 'PARCEL-001', packed_at: '2026-10-03T09:00:00Z'}],
    history: [
      {
        id: 'hist-1',
        from_status: 'received_at_facility',
        to_status: 'processing',
        created_at: '2026-10-02T14:00:00Z',
      },
    ],
    qr: [
      {
        id: 'qr-1',
        is_active: true,
        scans: [
          {
            id: 'scan-1',
            scan_action: 'facility_intake',
            scanned_at: '2026-10-02T13:00:00Z',
          },
        ],
      },
    ],
  });
});

afterEach(async () => {
  await cleanup();
});

test('shows error and recovers on retry', async () => {
  (listAdminFacilities as jest.Mock).mockReset().mockRejectedValue(new Error('Network unavailable'));
  const view = await render(<AdminFacilityOversightScreen accessToken="admin" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Network unavailable')).toBeTruthy());
  expect(view.getByText("Facility oversight couldn't be loaded.")).toBeTruthy();

  (listAdminFacilities as jest.Mock).mockResolvedValue({
    monitoring: {ageWarningHours: 4, stuckHours: 24, contractualSla: false},
    facilities: [summaryA],
  });
  fireEvent.press(view.getByText('Retry oversight'));
  await waitFor(() => expect(view.getByText('Hyderabad Central Facility')).toBeTruthy());
});

test('renders multiple facilities dynamically with active/inactive badges and total metrics', async () => {
  const onFacility = jest.fn();
  const view = await render(
    <AdminFacilityOversightScreen accessToken="admin" onBack={jest.fn()} onFacility={onFacility} />,
  );

  await waitFor(() => expect(view.getByText('Hyderabad Central Facility')).toBeTruthy());
  expect(view.getByText('Karimnagar Facility')).toBeTruthy();

  // Active / Inactive Badges
  expect(view.getByText('ACTIVE')).toBeTruthy();
  expect(view.getByText('INACTIVE')).toBeTruthy();

  // Overview summary tiles
  expect(view.getByText('Active Facilities')).toBeTruthy();
  expect(view.getByText('Total Workload')).toBeTruthy();
  expect(view.getByText('Ready for Delivery')).toBeTruthy();

  // Needs Attention section
  expect(view.getByText('NEEDS ATTENTION')).toBeTruthy();
  expect(view.getByText(/1 Stuck Orders/)).toBeTruthy();
  expect(view.getByText(/1 Age Warnings/)).toBeTruthy();

  // Tap entire facility card
  fireEvent.press(view.getByLabelText(/Facility Hyderabad Central Facility/));
  expect(onFacility).toHaveBeenCalledWith('facility-a');
});

test('renders empty facilities state when no facilities exist', async () => {
  (listAdminFacilities as jest.Mock).mockResolvedValue({
    monitoring: {ageWarningHours: 4, stuckHours: 24, contractualSla: false},
    facilities: [],
  });

  const view = await render(<AdminFacilityOversightScreen accessToken="admin" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No facilities found')).toBeTruthy());
});

test('renders Facility Workload screen with health summary, stage filters, and orders list', async () => {
  const onOrder = jest.fn();
  const view = await render(
    <AdminFacilityOversightScreen
      accessToken="admin"
      facilityId="facility-a"
      onBack={jest.fn()}
      onOrder={onOrder}
    />,
  );

  await waitFor(() => expect(view.getByText('Hyderabad Central Facility')).toBeTruthy());
  expect(view.getByText('Hitech City, Hyderabad')).toBeTruthy();

  // Health summary metrics
  expect(view.getByText('Active Orders')).toBeTruthy();
  expect(view.getByText(/1 Stuck/)).toBeTruthy();

  // Filter chips
  expect(view.getByText(/All \(3\)/)).toBeTruthy();
  expect(view.getByText(/Received \(1\)/)).toBeTruthy();
  expect(view.getByText(/Processing \(1\)/)).toBeTruthy();
  expect(view.getByText(/Ready \(1\)/)).toBeTruthy();

  // Order cards
  expect(view.getByText('BW-20261003-001')).toBeTruthy();
  expect(view.getByText('BW-20261003-002')).toBeTruthy();
  expect(view.getByText('BW-20261003-003')).toBeTruthy();

  // Order statuses and tags
  expect(view.getByText('PROCESSING')).toBeTruthy();
  expect(view.getByText('READY FOR DELIVERY')).toBeTruthy();
  expect(view.getByText(/Stuck order/)).toBeTruthy();
  expect(view.getByText(/Delivery dispatch: Waiting for available driver/)).toBeTruthy();

  // Test stage filter switching to Ready
  fireEvent.press(view.getByLabelText('Filter ready for delivery orders'));
  await waitFor(() => {
    expect(view.getByText('BW-20261003-002')).toBeTruthy();
    expect(view.queryByText('BW-20261003-001')).toBeNull();
  });

  // Filter with no orders shows empty stage message (0 verification orders in ordersList)
  fireEvent.press(view.getByLabelText('Filter verification orders'));
  await waitFor(() => {
    expect(view.getByText('No orders found')).toBeTruthy();
    expect(view.getByText('No orders match the selected stage filter.')).toBeTruthy();
  });

  // Tap order card
  fireEvent.press(view.getByLabelText('Filter all orders'));
  await waitFor(() => expect(view.getByText('BW-20261003-001')).toBeTruthy());
  fireEvent.press(view.getByLabelText(/Order BW-20261003-001/));
  expect(onOrder).toHaveBeenCalledWith('facility-a', 'order-1');
});

test('renders order history audit screen with processing, inspections, and QR scans', async () => {
  const view = await render(
    <AdminFacilityOversightScreen
      accessToken="admin"
      facilityId="facility-a"
      orderId="order-1"
      onBack={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByText('BW-20261003-001')).toBeTruthy());
  expect(view.getByText('Facility Order Audit')).toBeTruthy();
  expect(view.getByText('Processing history')).toBeTruthy();
  expect(view.getByText(/washing · started/)).toBeTruthy();

  // Inspections and discrepancies
  expect(view.getByText('Intake and discrepancies')).toBeTruthy();
  expect(view.getByText(/1 garment verification records/)).toBeTruthy();
  expect(view.getByText(/Missing 1 shirt from count/)).toBeTruthy();

  // QC and QR
  expect(view.getByText('QC and packing')).toBeTruthy();
  expect(view.getByText(/Cycle 1 · Passed/)).toBeTruthy();
  expect(view.getByText(/PARCEL-001/)).toBeTruthy();
  expect(view.getByText('QR intake audit')).toBeTruthy();
  expect(view.getByText(/Action: facility intake/)).toBeTruthy();
});
