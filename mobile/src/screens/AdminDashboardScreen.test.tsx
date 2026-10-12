import React from 'react';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import AdminDashboardScreen from './AdminDashboardScreen';
import {getAdminDashboard} from '../services/adminDashboardApi';

jest.mock('../services/adminDashboardApi', () => ({
  getAdminDashboard: jest.fn(),
}));
const load = getAdminDashboard as jest.Mock;

const dashboard = {
  totalOrders: 6,
  activeOrders: 4,
  cancelledOrders: 0,
  grossRevenue: 1250.5,
  activeDrivers: 3,
  activeFacilities: 2,
  processingOrders: 2,
  readyOrders: 1,
  ordersByStatus: [
    {status: 'confirmed', count: 1},
    {status: 'pickup_otp_pending', count: 1},
    {status: 'processing', count: 2},
    {status: 'ready_for_delivery', count: 1},
    {status: 'delivered', count: 1},
  ],
};

describe('AdminDashboardScreen', () => {
  beforeEach(() => {
    load.mockReset().mockResolvedValue(dashboard);
  });

  afterEach(() => cleanup());

  test('renders live overview, needs attention, operations, and management cards', async () => {
    const handlers = {
      onCustomers: jest.fn(),
      onStaff: jest.fn(),
      onAssignments: jest.fn(),
      onCatalogue: jest.fn(),
      onIssues: jest.fn(),
      onGrowth: jest.fn(),
      onFacilities: jest.fn(),
      onReports: jest.fn(),
      onLocations: jest.fn(),
      onLogout: jest.fn(),
    };

    const view = await render(
      <AdminDashboardScreen accessToken="admin-token" {...handlers} />,
    );

    // Header
    await waitFor(() => {
      expect(view.getByText('Operations Centre')).toBeTruthy();
    });

    // Live Overview
    expect(view.getByText('Active orders')).toBeTruthy();
    expect(view.getByText('₹1250.50')).toBeTruthy();
    expect(view.getByText('Drivers')).toBeTruthy();
    expect(view.getByText('Facilities')).toBeTruthy();

    // Needs Attention
    expect(view.getByText('Ready for delivery')).toBeTruthy();
    expect(view.getByText('Facility processing')).toBeTruthy();

    // Operations Cards
    expect(view.getByText('Orders & Customers')).toBeTruthy();
    expect(view.getByText('Driver Dispatch')).toBeTruthy();
    expect(
      view.getByText('Available jobs, assignments and live driver activity'),
    ).toBeTruthy();
    expect(view.getByText('Facility Operations')).toBeTruthy();
    expect(view.getByText('Claims & Refunds')).toBeTruthy();

    // Management Cards
    expect(view.getByText('Staff Management')).toBeTruthy();
    expect(view.getByText('Services & Pricing')).toBeTruthy();
    expect(view.getByText('Laundry Locations')).toBeTruthy();
    expect(view.getByText('Growth Programs')).toBeTruthy();
    expect(view.getByText('Analytics & Reports')).toBeTruthy();
  });

  test('every operational and management card is fully clickable and triggers exact route', async () => {
    const handlers = {
      onCustomers: jest.fn(),
      onStaff: jest.fn(),
      onAssignments: jest.fn(),
      onCatalogue: jest.fn(),
      onIssues: jest.fn(),
      onGrowth: jest.fn(),
      onFacilities: jest.fn(),
      onReports: jest.fn(),
      onLocations: jest.fn(),
      onLogout: jest.fn(),
    };

    const view = await render(
      <AdminDashboardScreen accessToken="admin-token" {...handlers} />,
    );

    await waitFor(() => {
      expect(view.getByText('Orders & Customers')).toBeTruthy();
    });

    // Test tapping anywhere in Orders & Customers card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Orders and Customers'));
    });
    expect(handlers.onCustomers).toHaveBeenCalledTimes(1);

    // Test tapping Driver Dispatch card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Driver Dispatch'));
    });
    expect(handlers.onAssignments).toHaveBeenCalledTimes(1);

    // Test tapping Facility Operations card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Facility Operations'));
    });
    expect(handlers.onFacilities).toHaveBeenCalledTimes(1);

    // Test tapping Claims & Refunds card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Claims and Refunds'));
    });
    expect(handlers.onIssues).toHaveBeenCalledTimes(1);

    // Test tapping Staff Management card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Staff Management'));
    });
    expect(handlers.onStaff).toHaveBeenCalledTimes(1);

    // Test tapping Services & Pricing card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Services and Pricing'));
    });
    expect(handlers.onCatalogue).toHaveBeenCalledTimes(1);

    // Test tapping Laundry Locations card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Laundry Locations'));
    });
    expect(handlers.onLocations).toHaveBeenCalledTimes(1);

    // Test tapping Growth Programs card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Growth Programs'));
    });
    expect(handlers.onGrowth).toHaveBeenCalledTimes(1);

    // Test tapping Analytics & Reports card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Analytics and Reports'));
    });
    expect(handlers.onReports).toHaveBeenCalledTimes(1);
  });

  test('tapping live overview and needs attention cards navigates properly', async () => {
    const handlers = {
      onCustomers: jest.fn(),
      onStaff: jest.fn(),
      onAssignments: jest.fn(),
      onCatalogue: jest.fn(),
      onIssues: jest.fn(),
      onGrowth: jest.fn(),
      onFacilities: jest.fn(),
      onReports: jest.fn(),
      onLocations: jest.fn(),
      onLogout: jest.fn(),
    };

    const view = await render(
      <AdminDashboardScreen accessToken="admin-token" {...handlers} />,
    );

    await waitFor(() => {
      expect(view.getByText('Active orders')).toBeTruthy();
    });

    // Tap active orders overview card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Active orders: 4'));
    });
    expect(handlers.onCustomers).toHaveBeenCalled();

    // Tap drivers overview card
    await act(async () => {
      fireEvent.press(view.getByLabelText('Active drivers: 3'));
    });
    expect(handlers.onStaff).toHaveBeenCalled();

    // Tap ready for delivery attention card
    await act(async () => {
      fireEvent.press(view.getByLabelText('1 orders ready for delivery'));
    });
    expect(handlers.onAssignments).toHaveBeenCalled();
  });

  test('toggles detailed order status list', async () => {
    const view = await render(
      <AdminDashboardScreen accessToken="admin-token" onLogout={jest.fn()} />,
    );

    await waitFor(() => {
      expect(view.getByText('View all order statuses')).toBeTruthy();
    });

    // Expand status list
    await act(async () => {
      fireEvent.press(view.getByText('View all order statuses'));
    });
    expect(view.getByText('Hide detailed status list')).toBeTruthy();
    expect(view.getByText('Pickup OTP Pending')).toBeTruthy();
    expect(view.getByText('Ready For Delivery')).toBeTruthy();

    // Collapse status list
    await act(async () => {
      fireEvent.press(view.getByText('Hide detailed status list'));
    });
    expect(view.getByText('View all order statuses')).toBeTruthy();
  });

  test('shows refresh action and handles logout', async () => {
    const logout = jest.fn();
    const view = await render(
      <AdminDashboardScreen accessToken="admin-token" onLogout={logout} />,
    );

    await waitFor(() => {
      expect(view.getByText('Refresh')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByText('Refresh'));
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    await act(async () => {
      fireEvent.press(view.getByText('Log out'));
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('shows error banner and recovers with retry', async () => {
    load
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({
        ...dashboard,
        readyOrders: 0,
        processingOrders: 0,
        ordersByStatus: [],
      });

    const view = await render(
      <AdminDashboardScreen accessToken="admin-token" onLogout={jest.fn()} />,
    );

    await waitFor(() => {
      expect(view.getByText('Network unavailable')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByText('Retry dashboard'));
    });
    await waitFor(() => {
      expect(view.getByText('All operations are up to date')).toBeTruthy();
    });
  });
});
