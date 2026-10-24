import React from 'react';
import { render } from '@testing-library/react-native';
import AppIcon, { IconName } from './AppIcon';

describe('AppIcon rendering audit test suite', () => {
  const iconList: IconName[] = [
    'cart',
    'search',
    'check',
    'circle-check',
    'close',
    'x',
    'location',
    'pin',
    'calendar',
    'clock',
    'card',
    'cash',
    'wallet',
    'lock',
    'truck',
    'delivery',
    'facility',
    'building-2',
    'wash',
    'wash-fold',
    'wash-iron',
    'washing-machine',
    'dry',
    'iron',
    'fold',
    'pack',
    'qc',
    'package',
    'box',
    'orders',
    'clipboard-list',
    'alert',
    'circle-alert',
    'warning',
    'triangle-alert',
    'user',
    'user-circle',
    'users',
    'gear',
    'settings',
    'phone',
    'tag',
    'info',
    'refresh',
    'refresh-cw',
    'arrow-right',
    'arrow-left',
    'back',
    'arrow-up',
    'arrow-down',
    'chevron-right',
    'chevron-left',
    'chevron-down',
    'chevron-up',
    'shield',
    'shield-check',
    'sparkles',
    'plus',
    'add',
    'minus',
    'edit',
    'pencil',
    'trash',
    'delete',
    'save',
    'play',
    'pause',
    'home',
    'house',
    'bell',
    'notifications',
    'hanger',
    'shoe',
    'bed',
    'chart',
    'analytics',
    'hand',
    'pickup',
    'more-vertical',
    'shirt',
  ];

  it('renders all registered IconNames without crashing on native platform', async () => {
    for (const name of iconList) {
      const view = await render(
        <AppIcon name={name} size={24} color="#111111" strokeWidth={2} />
      );
      expect(view).toBeTruthy();
    }
  });

  it('renders chevrons with dedicated geometry', async () => {
    const down = await render(<AppIcon name="chevron-down" size={24} color="#000" />);
    expect(down).toBeTruthy();

    const up = await render(<AppIcon name="chevron-up" size={24} color="#000" />);
    expect(up).toBeTruthy();

    const left = await render(<AppIcon name="chevron-left" size={24} color="#000" />);
    expect(left).toBeTruthy();

    const right = await render(<AppIcon name="chevron-right" size={24} color="#000" />);
    expect(right).toBeTruthy();
  });

  it('renders newly supported icons (washing-machine, triangle-alert, user-circle)', async () => {
    const wash = await render(<AppIcon name="washing-machine" size={24} color="#000" />);
    expect(wash).toBeTruthy();

    const alert = await render(<AppIcon name="triangle-alert" size={24} color="#000" />);
    expect(alert).toBeTruthy();

    const userCircle = await render(<AppIcon name="user-circle" size={24} color="#000" />);
    expect(userCircle).toBeTruthy();
  });

  it('preserves accessibilityLabel when provided', async () => {
    const view = await render(
      <AppIcon name="location" accessibilityLabel="Selected location pin" />
    );
    expect(view.getByLabelText('Selected location pin')).toBeTruthy();
  });
});
