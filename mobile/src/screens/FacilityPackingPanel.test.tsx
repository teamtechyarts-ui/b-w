import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import FacilityPackingPanel from './FacilityPackingPanel';
import {
  confirmFacilityPacking,
  getFacilityPacking,
} from '../services/facilityPackingApi';
jest.mock('../services/facilityPackingApi', () => ({
  confirmFacilityPacking: jest.fn(),
  getFacilityPacking: jest.fn(),
}));
const get = getFacilityPacking as jest.Mock;
const confirm = confirmFacilityPacking as jest.Mock;
const base = {
  orderId: 'order-1',
  orderStatus: 'processing',
  facility: 'Local Facility',
  cycleNumber: 0,
  packingRequired: true,
  canPack: true,
  items: [
    { id: 'item-1', item_name: 'Shirt', quantity: 3, verifiedQuantity: 2 },
  ],
  history: [],
};
beforeEach(() => jest.resetAllMocks());
test('compares packed count with verified intake, confirms without a parcel ID, and refreshes audit', async () => {
  get
    .mockResolvedValueOnce(base)
    .mockResolvedValueOnce({
      ...base,
      canPack: false,
      history: [
        {
          id: 'pack-1',
          parcel_id: 'BW-PARCEL-1',
          cycle_number: 0,
          packed_by: 'staff-1',
          packed_at: 'today',
          notes: 'Packed clean',
          items: [
            {
              order_item_id: 'item-1',
              verified_quantity: 2,
              packed_quantity: 2,
            },
          ],
        },
      ],
    });
  confirm.mockResolvedValue({ packingId: 'pack-1' });
  const changed = jest.fn();
  const ready = jest.fn();
  const view = await render(
    <FacilityPackingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={changed}
      onReadiness={ready}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Shirt · verified 2')).toBeTruthy(),
  );
  expect(view.getByText('No final packing recorded yet.')).toBeTruthy();
  await fireEvent.changeText(
    view.getByLabelText('Packed count for Shirt'),
    '1',
  );
  await fireEvent.press(view.getByText('Confirm final packing'));
  expect(
    view.getByText(
      'Packed counts must match the Facility-verified intake count for every item.',
    ),
  ).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  await fireEvent.changeText(
    view.getByLabelText('Packed count for Shirt'),
    '2',
  );
  await fireEvent.changeText(
    view.getByLabelText('Final packing notes'),
    'Packed clean',
  );
  await fireEvent.press(view.getByText('Confirm final packing'));
  await waitFor(() =>
    expect(view.getByText('Cycle 1 · Packing confirmed')).toBeTruthy(),
  );
  expect(view.queryByLabelText('Parcel ID')).toBeNull();
  expect(confirm).toHaveBeenCalledWith(
    'token',
    'order-1',
    [{ orderItemId: 'item-1', packedQuantity: 2 }],
    'Packed clean',
  );
  expect(ready).toHaveBeenLastCalledWith(true);
  expect(changed).toHaveBeenCalled();
});
test('shows prerequisite and network retry states', async () => {
  get.mockResolvedValueOnce({ ...base, canPack: false });
  const view = await render(
    <FacilityPackingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
      onReadiness={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      view.getByText('Complete the Pack processing step before final packing.'),
    ).toBeTruthy(),
  );
  expect(view.queryByText('Confirm final packing')).toBeNull();
  await view.unmount();
  get.mockRejectedValue(new Error('Network unavailable'));
  const errorView = await render(
    <FacilityPackingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
      onReadiness={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(errorView.getByText('Network unavailable')).toBeTruthy(),
  );
  expect(errorView.getByText('Retry packing')).toBeTruthy();
});
