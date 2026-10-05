import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import CustomerBottomNavigation from './CustomerBottomNavigation';

test('customer bottom navigation exposes Home, Orders, Account and does NOT render Packages', async () => {
  const handlers = {
    onHome: jest.fn(),
    onOrders: jest.fn(),
    onAccount: jest.fn(),
  };

  const view = await render(
    <CustomerBottomNavigation active="home" {...handlers} />,
  );

  expect(view.getByLabelText('Home').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('Orders')).toBeTruthy();
  expect(view.getByLabelText('Account')).toBeTruthy();
  expect(view.queryByLabelText('Packages')).toBeNull();

  fireEvent.press(view.getByLabelText('Orders'));
  expect(handlers.onOrders).toHaveBeenCalled();

  fireEvent.press(view.getByLabelText('Account'));
  expect(handlers.onAccount).toHaveBeenCalled();
});
