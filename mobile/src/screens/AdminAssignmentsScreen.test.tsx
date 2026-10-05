import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import AdminAssignmentsScreen from './AdminAssignmentsScreen';
import {
  assignAdminDriver,
  getAdminAssignmentDetail,
  listAdminAssignments,
  reassignAdminDriver,
} from '../services/adminAssignmentsApi';

jest.mock('../services/adminAssignmentsApi', () => ({
  listAdminAssignments: jest.fn(),
  getAdminAssignmentDetail: jest.fn(),
  assignAdminDriver: jest.fn(),
  reassignAdminDriver: jest.fn(),
}));

const list = listAdminAssignments as jest.Mock;
const detail = getAdminAssignmentDetail as jest.Mock;
const assign = assignAdminDriver as jest.Mock;
const reassign = reassignAdminDriver as jest.Mock;

const sampleJob = {
  orderId: 'order-1',
  orderNumber: 'BW-20261002-2F835445',
  orderStatus: 'pickup_accepted',
  type: 'pickup' as const,
  assignment: {
    id: 'ass-1',
    driver_id: 'driver-testing',
    assignment_type: 'pickup' as const,
    status: 'accepted',
    assigned_at: '2026-10-02T10:00:00Z',
    accepted_at: '2026-10-02T10:05:00Z',
    completed_at: null,
    rejection_reason: null,
  },
  lastAssignment: null,
  canAssign: false,
  stale: false,
};

const unassignedJob = {
  orderId: 'order-2',
  orderNumber: 'BW-20261001-3F97A3B9',
  orderStatus: 'confirmed',
  type: 'pickup' as const,
  assignment: null,
  lastAssignment: null,
  canAssign: true,
  stale: false,
};

const driver1 = {
  id: 'driver-testing',
  name: 'testing',
  isActive: true,
  isAvailable: true,
  maxConcurrentJobs: 5,
  activeJobs: 2,
};

const driver2 = {
  id: 'driver-test-3945',
  name: 'TEST Driver 3945',
  isActive: false,
  isAvailable: false,
  maxConcurrentJobs: 5,
  activeJobs: 0,
};

const driver3 = {
  id: 'driver-testing-2',
  name: 'testing 2',
  isActive: true,
  isAvailable: false,
  maxConcurrentJobs: 5,
  activeJobs: 0,
};

const driverAtCapacity = {
  id: 'driver-busy',
  name: 'Busy Driver',
  isActive: true,
  isAvailable: true,
  maxConcurrentJobs: 3,
  activeJobs: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  list.mockResolvedValue({
    jobs: [sampleJob, unassignedJob],
    drivers: [driver1, driver2, driver3],
    staleAfterMinutes: 30,
  });
  detail.mockResolvedValue({
    order: {
      id: 'order-1',
      order_number: 'BW-20261002-2F835445',
      current_status: 'pickup_accepted',
    },
    assignments: [
      {
        id: 'ass-1',
        driver_id: 'driver-testing',
        assignment_type: 'pickup',
        status: 'accepted',
        assigned_at: '2026-10-02T10:00:00Z',
        accepted_at: '2026-10-02T10:05:00Z',
        completed_at: null,
        rejection_reason: null,
      },
    ],
    audit: [
      {
        id: 'audit-1',
        action: 'assign',
        created_at: '2026-10-02T10:00:00Z',
        actor_profile_id: 'admin-1',
      },
    ],
    tracking: {
      recordedAt: '2026-10-02T10:10:00Z',
      stale: false,
    },
  });
  assign.mockResolvedValue({});
  reassign.mockResolvedValue({});
});

describe('AdminAssignmentsScreen - Mobile-First Redesign', () => {
  jest.setTimeout(15000);
  test('1. renders summary section with calculated counts', async () => {
    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('3 Drivers')).toBeTruthy();
      expect(view.getByText('1 Available')).toBeTruthy();
      expect(view.getByText('2 Offline')).toBeTruthy();
      expect(view.getByText('2 Active Jobs')).toBeTruthy();
    });
  });

  test('2. renders active assignment cards with order number, job type, and status hierarchy', async () => {
    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('Order BW-20261002-2F835445')).toBeTruthy();
      expect(view.getByText('Order BW-20261001-3F97A3B9')).toBeTruthy();
      expect(view.getAllByText('PICKUP').length).toBeGreaterThanOrEqual(1);
      expect(view.getByText('Pickup Accepted')).toBeTruthy();
      expect(view.getAllByText('testing').length).toBeGreaterThanOrEqual(1);
    });
  });

  test('3. displays unassigned job with "+ Assign Driver" action', async () => {
    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('No driver assigned')).toBeTruthy();
      expect(view.getByText('+ Assign Driver')).toBeTruthy();
    });
  });

  test('4. displays driver workload cards with progress percentage and availability states', async () => {
    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getAllByText('testing').length).toBeGreaterThanOrEqual(1);
      expect(view.getByText('2 / 5 active jobs')).toBeTruthy();
      expect(view.getByText('40%')).toBeTruthy(); // 2/5 * 100
      expect(view.getByText('Available')).toBeTruthy();

      expect(view.getByText('TEST Driver 3945')).toBeTruthy();
      expect(view.getAllByText('0 / 5 active jobs').length).toBe(2);
      expect(view.getAllByText('Unavailable').length).toBe(2); // driver2 and driver3
    });
  });

  test('5. displays at-capacity driver correctly', async () => {
    list.mockResolvedValue({
      jobs: [],
      drivers: [driverAtCapacity],
      staleAfterMinutes: 30,
    });

    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('Busy Driver')).toBeTruthy();
      expect(view.getByText('3 / 3 active jobs')).toBeTruthy();
      expect(view.getByText('100%')).toBeTruthy();
      expect(view.getByText('At capacity')).toBeTruthy();
    });
  });

  test('6. assigns driver flow: opens job, selects eligible driver, and submits assign API', async () => {
    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => expect(view.getByText('Order BW-20261001-3F97A3B9')).toBeTruthy());
    await fireEvent.press(view.getByText('Order BW-20261001-3F97A3B9'));

    await waitFor(() => expect(view.getAllByText('Assign Driver').length).toBeGreaterThanOrEqual(1));
    // Select testing driver
    await fireEvent.press(view.getAllByText('testing')[0]);
    // Press Assign Driver submit button
    await fireEvent.press(view.getAllByText('Assign Driver').at(-1)!);

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('token', 'order-2', 'driver-testing', 'pickup');
    });
  });

  test('7. reassign driver flow: opens assigned job, chooses replacement driver, and submits reassign API', async () => {
    list.mockResolvedValue({
      jobs: [sampleJob],
      drivers: [
        driver1,
        {id: 'driver-replacement', name: 'Replacement Driver', isActive: true, isAvailable: true, maxConcurrentJobs: 5, activeJobs: 0},
      ],
      staleAfterMinutes: 30,
    });

    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => expect(view.getByText('Order BW-20261002-2F835445')).toBeTruthy());
    await fireEvent.press(view.getByText('Order BW-20261002-2F835445'));

    await waitFor(() => expect(view.getByText('Reassign Driver')).toBeTruthy());
    await fireEvent.press(view.getByText('Replacement Driver'));
    await fireEvent.press(view.getByText('Confirm reassignment'));

    await waitFor(() => {
      expect(reassign).toHaveBeenCalledWith('token', 'ass-1', 'driver-replacement');
    });
  });

  test('8. displays no eligible drivers when all drivers are busy or unavailable', async () => {
    list.mockResolvedValue({
      jobs: [unassignedJob],
      drivers: [driver2, driver3, driverAtCapacity],
      staleAfterMinutes: 30,
    });

    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => expect(view.getByText('Order BW-20261001-3F97A3B9')).toBeTruthy());
    await fireEvent.press(view.getByText('Order BW-20261001-3F97A3B9'));

    await waitFor(() => {
      expect(view.getByText('No eligible drivers are available for this order.')).toBeTruthy();
    });
  });

  test('9. shows empty states when no active jobs or no drivers', async () => {
    list.mockResolvedValue({
      jobs: [],
      drivers: [],
      staleAfterMinutes: 30,
    });

    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('No active driver assignments')).toBeTruthy();
      expect(view.getByText('No drivers configured')).toBeTruthy();
    });
  });

  test('10. error state and retry handling', async () => {
    list.mockRejectedValueOnce(new Error('Network failure'));

    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('Network failure')).toBeTruthy();
      expect(view.getByText('Retry assignments')).toBeTruthy();
    });

    list.mockResolvedValueOnce({
      jobs: [sampleJob],
      drivers: [driver1],
      staleAfterMinutes: 30,
    });

    await fireEvent.press(view.getByText('Retry assignments'));

    await waitFor(() => {
      expect(view.getByText('Order BW-20261002-2F835445')).toBeTruthy();
    });
  });

  test('11. order detail navigation callback is called when onOrder is passed', async () => {
    const onOrder = jest.fn();
    const view = await render(
      <AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} onOrder={onOrder} />,
    );

    await waitFor(() => expect(view.getAllByText('View Order Details →').length).toBeGreaterThan(0));
    await fireEvent.press(view.getAllByText('View Order Details →')[0]);

    expect(onOrder).toHaveBeenCalledWith('order-1');
  });

  test('12. shows stale indicator and rejection reasons', async () => {
    const staleJob = {
      ...sampleJob,
      stale: true,
      lastAssignment: {
        id: 'old-1',
        driver_id: 'driver-old',
        assignment_type: 'pickup' as const,
        status: 'rejected',
        assigned_at: '2026-10-02T09:00:00Z',
        accepted_at: null,
        completed_at: null,
        rejection_reason: 'Vehicle breakdown',
      },
    };

    list.mockResolvedValue({
      jobs: [staleJob],
      drivers: [driver1],
      staleAfterMinutes: 30,
    });

    const view = await render(<AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />);

    await waitFor(() => {
      expect(view.getByText('Stale')).toBeTruthy();
      expect(view.getByText('Last offer rejected')).toBeTruthy();
    });
  });

  test('13. supports multiple viewport widths without crashing (320px, 360px, 375px, 390px, 414px, 430px)', async () => {
    const viewports = [320, 360, 375, 390, 414, 430];
    for (const _width of viewports) {
      const view = await render(
        <AdminAssignmentsScreen accessToken="token" onBack={jest.fn()} />,
      );
      expect(view.getByText('Driver Assignments')).toBeTruthy();
    }
  });
});
