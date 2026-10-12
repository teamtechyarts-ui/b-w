import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import OrdersScreen from './OrdersScreen';
import {getOrders} from '../services/ordersApi';

let mockFocus: () => void;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    mockFocus = callback;
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../services/ordersApi', () => ({getOrders: jest.fn()}));

describe('OrdersScreen', () => {
  test('returning from a cancelled order refreshes history and moves it to Past', async () => {
    const order = {id: 'order', order_number: 'BW-123', current_status: 'confirmed', total_amount: 100, order_items: []};
    (getOrders as jest.Mock).mockResolvedValueOnce([order]).mockResolvedValueOnce([{...order, current_status: 'cancelled'}]);
    const view = await render(<OrdersScreen accessToken="token" onBack={jest.fn()} onOpenOrder={jest.fn()} />);
    await waitFor(() => expect(view.getByText('Active (1)')).toBeTruthy());
    await act(async () => {mockFocus();});
    await waitFor(() => expect(view.getByText('Active (0)')).toBeTruthy());
    await fireEvent.press(view.getByText('Past (1)'));
    expect(view.getByText('BW-123')).toBeTruthy();
    expect(view.getByText('Cancelled')).toBeTruthy();
  });

  test('delivered order moves to Past Orders and displays Completed status', async () => {
    const deliveredOrder = {
      id: 'order-del',
      order_number: 'BW-20261001-3F97A3B9',
      current_status: 'delivered',
      delivered_at: '2026-10-08T12:08:00Z',
      total_amount: 942.82,
      order_items: [{id: 'item-1', quantity: 2}],
    };
    (getOrders as jest.Mock).mockResolvedValue([deliveredOrder]);
    const view = await render(<OrdersScreen accessToken="token" onBack={jest.fn()} onOpenOrder={jest.fn()} />);

    // Active tab has 0 items
    await waitFor(() => expect(view.getByText('Active (0)')).toBeTruthy());
    expect(view.getByText('Past (1)')).toBeTruthy();

    // Switch to Past tab
    await fireEvent.press(view.getByText('Past (1)'));
    expect(view.getByText('BW-20261001-3F97A3B9')).toBeTruthy();
    expect(view.getByText('Completed')).toBeTruthy();
    expect(view.getByText(/Delivered/)).toBeTruthy();
  });
});
