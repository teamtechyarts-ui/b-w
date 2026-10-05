import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import AccountScreen from './AccountScreen';

test('customer Account menu routes secondary functions and excludes Loyalty, Referrals, Packages', async () => {
  const open = jest.fn();
  const logout = jest.fn();
  const view = await render(<AccountScreen onOpen={open} onLogout={logout} />);

  // Verified active destinations
  const destinations = [
    ['Profile', 'profile'],
    ['Addresses', 'addresses'],
    ['Coupons & offers', 'offers'],
    ['Claims & refunds', 'claims'],
    ['Notifications', 'notifications'],
    ['Support', 'support'],
    ['Terms', 'terms'],
  ] as const;

  destinations.forEach(([label, destination]) => {
    expect(view.getByText(label)).toBeTruthy();
    fireEvent.press(view.getByText(label));
    expect(open).toHaveBeenLastCalledWith(destination);
  });

  // Verify removed items are not present
  expect(view.queryByText('Loyalty')).toBeNull();
  expect(view.queryByText('Referrals')).toBeNull();
  expect(view.queryByText('Packages')).toBeNull();
  expect(view.queryByText('Subscriptions')).toBeNull();

  // Log out
  fireEvent.press(view.getByText('Log out'));
  expect(logout).toHaveBeenCalled();
});
