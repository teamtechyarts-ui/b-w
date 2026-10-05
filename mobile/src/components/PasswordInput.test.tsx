import React, { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import PasswordInput from './PasswordInput';
import { View } from 'react-native';

describe('PasswordInput component', () => {
  it('starts with hidden password and toggles visibility via eye icon', async () => {
    const onChangeText = jest.fn();
    const view = await render(
      <PasswordInput
        placeholder="Enter password"
        value="Secret123"
        onChangeText={onChangeText}
      />,
    );

    expect(view.getByPlaceholderText('Enter password').props.secureTextEntry).toBe(true);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Show password'));
    });

    expect(view.getByPlaceholderText('Enter password').props.secureTextEntry).toBe(false);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Hide password'));
    });

    expect(view.getByPlaceholderText('Enter password').props.secureTextEntry).toBe(true);
  });

  it('keeps two password visibility states completely independent', async () => {
    function DualPasswordForm() {
      const [pwd, setPwd] = useState('Password1');
      const [confirm, setConfirm] = useState('Password2');
      return (
        <View>
          <PasswordInput
            placeholder="Main password"
            value={pwd}
            onChangeText={setPwd}
          />
          <PasswordInput
            placeholder="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
          />
        </View>
      );
    }

    const view = await render(<DualPasswordForm />);
    expect(view.getByPlaceholderText('Main password').props.secureTextEntry).toBe(true);
    expect(view.getByPlaceholderText('Confirm password').props.secureTextEntry).toBe(true);

    const buttons = view.getAllByRole('button');
    expect(buttons).toHaveLength(2);

    // Toggle only the first password
    await act(async () => {
      fireEvent.press(buttons[0]);
    });

    expect(view.getByPlaceholderText('Main password').props.secureTextEntry).toBe(false);
    expect(view.getByPlaceholderText('Confirm password').props.secureTextEntry).toBe(true);

    // Toggle only the second password
    const updatedButtons = view.getAllByRole('button');
    await act(async () => {
      fireEvent.press(updatedButtons[1]);
    });

    expect(view.getByPlaceholderText('Main password').props.secureTextEntry).toBe(false);
    expect(view.getByPlaceholderText('Confirm password').props.secureTextEntry).toBe(false);
  });
});
