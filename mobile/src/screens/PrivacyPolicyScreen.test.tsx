import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PrivacyPolicyScreen from './PrivacyPolicyScreen';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
} from '../content/privacyPolicy';

describe('Privacy Policy Screen & Modal', () => {
  test('renders PrivacyPolicyScreen with title, version, last updated, and back button', async () => {
    const handleBack = jest.fn();
    const view = await render(<PrivacyPolicyScreen onBack={handleBack} />);

    expect(view.getByText('Privacy Policy')).toBeTruthy();
    expect(
      view.getByText(`Bright & White Laundry • v${PRIVACY_POLICY_VERSION}`)
    ).toBeTruthy();
    expect(
      view.getByText(`Last Updated: ${PRIVACY_POLICY_LAST_UPDATED}`)
    ).toBeTruthy();

    // Verify key sections exist
    expect(view.getByText('1. Scope and Application')).toBeTruthy();
    expect(view.getByText('3. Information We Collect')).toBeTruthy();
    expect(view.getByText('8. Account Deletion and User Rights')).toBeTruthy();
    expect(
      view.getByText('12. Grievance Officer and Redressal Mechanism')
    ).toBeTruthy();

    // Verify back navigation
    const backBtn = view.getByLabelText('Go back');
    fireEvent.press(backBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  test('renders PrivacyPolicyModal and triggers close button', async () => {
    const handleClose = jest.fn();
    const view = await render(
      <PrivacyPolicyModal visible={true} onClose={handleClose} />
    );

    expect(view.getByText(`Version ${PRIVACY_POLICY_VERSION}`)).toBeTruthy();
    expect(view.getByText('DATA PROTECTION')).toBeTruthy();

    const closeButtons = view.getAllByLabelText('Close privacy policy');
    expect(closeButtons.length).toBeGreaterThan(0);
    fireEvent.press(closeButtons[0]);
    expect(handleClose).toHaveBeenCalled();
  });
});
