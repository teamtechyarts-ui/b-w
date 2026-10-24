import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import ProfileScreen from './ProfileScreen';
import {getCustomerProfile, updateCustomerName} from '../services/profileApi';
jest.mock('../services/profileApi', () => ({getCustomerProfile: jest.fn(), updateCustomerName: jest.fn(), validateName: jest.requireActual('../services/profileApi').validateName}));
test('profile loads verified phone and saves a valid name', async () => {
  (getCustomerProfile as jest.Mock).mockResolvedValue({id: 'customer', profiles: {id: 'profile', full_name: 'Asha', phone: '+919999999999'}});
  (updateCustomerName as jest.Mock).mockResolvedValue({id: 'profile', full_name: 'Asha Reddy', phone: '+919999999999'});
  const view = await render(<ProfileScreen accessToken="token" onBack={jest.fn()} onAddresses={jest.fn()} onLogout={jest.fn()} />);
  await waitFor(() => expect(view.getByText('+919999999999')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('Full name'), 'Asha Reddy');
  await fireEvent.press(view.getByText('Save name'));
  await waitFor(() => expect(updateCustomerName).toHaveBeenCalledWith('token', 'Asha Reddy'));
  expect(view.getByText('Phone changes require a new verified login.')).toBeTruthy();
});

test('notifies onProfileUpdated and suppresses full loading spinner once record is loaded', async () => {
  const onProfileUpdated = jest.fn();
  (getCustomerProfile as jest.Mock).mockResolvedValue({id: 'cust-1', profiles: {id: 'prof-1', full_name: 'Priya', phone: '+919888888888'}});
  (updateCustomerName as jest.Mock).mockResolvedValue({id: 'prof-1', full_name: 'Priya Sharma'});

  const view = await render(
    <ProfileScreen
      accessToken="token-abc"
      onBack={jest.fn()}
      onAddresses={jest.fn()}
      onLogout={jest.fn()}
      onProfileUpdated={onProfileUpdated}
    />,
  );

  await waitFor(() => expect(view.getByText('+919888888888')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('Full name'), 'Priya Sharma');
  await fireEvent.press(view.getByText('Save name'));

  await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledWith('Priya Sharma'));
  expect(view.queryByLabelText('Loading profile')).toBeNull();
});
