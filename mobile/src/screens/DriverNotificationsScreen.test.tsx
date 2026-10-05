import React from 'react';
import {cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import DriverNotificationsScreen from './DriverNotificationsScreen';
import {getNotifications} from '../services/notificationsApi';
import {openDriverNotification} from '../services/driverNotifications';

jest.mock('../services/notificationsApi', () => ({
  getNotifications: jest.fn(),
  notificationOrderNumber: jest.requireActual('../services/notificationsApi').notificationOrderNumber,
}));
jest.mock('../services/driverNotifications', () => ({openDriverNotification: jest.fn()}));
const notification = {id: 'n-1', title: 'Assigned pickup', body: 'New job for Order BW-20261003-7CB85C51', is_read: false,
  data: {assignmentId: 'job-1', orderNumber: 'BW-20261003-7CB85C51'}};
beforeEach(() => {jest.clearAllMocks(); (getNotifications as jest.Mock).mockResolvedValue([notification]);
  (openDriverNotification as jest.Mock).mockImplementation(async (_token, _role, item, onJob) => onJob(item.data.assignmentId));});
afterEach(() => cleanup());

test('shows an owned Driver notification and taps through to the selected job', async () => {
  const onJob = jest.fn();
  const view = await render(<DriverNotificationsScreen accessToken="driver-token" role="driver" onBack={jest.fn()} onJob={onJob} />);
  await waitFor(() => expect(view.getByText('Assigned pickup')).toBeTruthy());
  await fireEvent.press(view.getByText('View assigned job →'));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('job-1'));
  expect(getNotifications).toHaveBeenCalledWith('driver-token');
  expect(openDriverNotification).toHaveBeenCalledWith('driver-token', 'driver', notification, onJob);
});

test('never loads notifications for a non-Driver role', async () => {
  const view = await render(<DriverNotificationsScreen accessToken="customer-token" role="customer" onBack={jest.fn()} onJob={jest.fn()} />);
  expect(view.getByText('Sign in as a Driver to view notifications.')).toBeTruthy();
  expect(getNotifications).not.toHaveBeenCalled();
});

test('stale or wrong assignment errors leave the Driver in the inbox', async () => {
  (openDriverNotification as jest.Mock).mockRejectedValue(new Error('Assignment unavailable or no longer assigned to you.'));
  const onJob = jest.fn();
  const view = await render(<DriverNotificationsScreen accessToken="driver-token" role="driver" onBack={jest.fn()} onJob={onJob} />);
  await waitFor(() => expect(view.getByText('Assigned pickup')).toBeTruthy());
  await fireEvent.press(view.getByText('View assigned job →'));
  await waitFor(() => expect(view.getByText('Assignment unavailable or no longer assigned to you.')).toBeTruthy());
  expect(onJob).not.toHaveBeenCalled();
});

test('shows loading, empty, and retry states', async () => {
  (getNotifications as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  const view = await render(<DriverNotificationsScreen accessToken="driver-token" role="driver" onBack={jest.fn()} onJob={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Retry notifications')).toBeTruthy());
  await fireEvent.press(view.getByText('Retry notifications'));
  await waitFor(() => expect(view.getByText('No Driver notifications yet.')).toBeTruthy());
});
