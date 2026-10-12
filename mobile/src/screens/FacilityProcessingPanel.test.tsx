import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import FacilityProcessingPanel from './FacilityProcessingPanel';
import {
  getFacilityProcessing,
  startFacilityStage,
  completeFacilityStage,
  recordFacilityQualityDecision,
} from '../services/facilityProcessingApi';
jest.mock('../services/facilityProcessingApi', () => ({
  getFacilityProcessing: jest.fn(),
  startFacilityStage: jest.fn(),
  completeFacilityStage: jest.fn(),
  recordFacilityQualityDecision: jest.fn(),
}));
const get = getFacilityProcessing as jest.Mock;
const start = startFacilityStage as jest.Mock;
const complete = completeFacilityStage as jest.Mock;
const decide = recordFacilityQualityDecision as jest.Mock;
const empty = {
  orderId: 'order-1',
  orderStatus: 'verification',
  stages: [],
  activeOperationId: null,
  nextStage: 'washing',
  openDiscrepancies: 0,
  completedStageCount: 0,
};
beforeEach(() => jest.resetAllMocks());
test('starts only the allowed stage and shows completion control after refresh', async () => {
  get
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce({
      ...empty,
      orderStatus: 'processing',
      nextStage: null,
      activeOperationId: 'operation-1',
      stages: [
        {
          id: 'operation-1',
          operation_type: 'washing',
          started_at: 'today',
          completed_at: null,
        },
      ],
    });
  start.mockResolvedValue({ operationId: 'operation-1' });
  const changed = jest.fn();
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={changed}
    />,
  );
  await waitFor(() => expect(view.getByText('Start Wash')).toBeTruthy());
  expect(view.queryByText('Start Dry')).toBeNull();
  fireEvent.press(view.getByText('Start Wash'));
  await waitFor(() => expect(view.getByText('Complete Wash')).toBeTruthy());
  expect(start).toHaveBeenCalledWith('token', 'order-1', 'washing');
  expect(changed).toHaveBeenCalled();
});
test('blocks controls for open discrepancies and completes current operation once', async () => {
  get.mockResolvedValueOnce({
    ...empty,
    nextStage: null,
    openDiscrepancies: 1,
  });
  const blocked = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      blocked.getByText('Resolve all intake discrepancies before processing.'),
    ).toBeTruthy(),
  );
  expect(blocked.queryByText('Start Wash')).toBeNull();
  await blocked.unmount();
  get
    .mockResolvedValueOnce({
      ...empty,
      orderStatus: 'processing',
      nextStage: null,
      activeOperationId: 'operation-1',
      stages: [
        {
          id: 'operation-1',
          operation_type: 'washing',
          started_at: 'today',
          completed_at: null,
        },
      ],
    })
    .mockResolvedValueOnce({
      ...empty,
      orderStatus: 'processing',
      nextStage: 'drying',
      activeOperationId: null,
      completedStageCount: 1,
      stages: [
        {
          id: 'operation-1',
          operation_type: 'washing',
          started_at: 'today',
          completed_at: 'later',
        },
      ],
    });
  complete.mockResolvedValue({ processingCompleted: true });
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() => expect(view.getByText('Complete Wash')).toBeTruthy());
  fireEvent.press(view.getByText('Complete Wash'));
  await waitFor(() => expect(view.getByText('Start Dry')).toBeTruthy());
  expect(complete).toHaveBeenCalledWith('token', 'operation-1');
});
test('shows an API error and retry', async () => {
  get.mockRejectedValue(new Error('Network unavailable'));
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Network unavailable')).toBeTruthy(),
  );
  expect(view.getByText('Retry processing')).toBeTruthy();
});
test('Facility Staff sees QC controls, must explain failure, and history survives rewash', async () => {
  const ready = {
    ...empty,
    orderStatus: 'processing',
    nextStage: null,
    role: 'facility_employee',
    canQualityCheck: true,
    stages: [
      {
        id: 'pack-1',
        operation_type: 'packaging',
        started_at: 'earlier',
        completed_at: 'now',
        rewash_cycle: 0,
      },
    ],
  };
  get
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce({
      ...ready,
      orderStatus: 'rework_required',
      canQualityCheck: false,
      nextStage: 'washing',
      rewashCycle: 1,
      qualityDecisions: [
        {
          id: 'qc-1',
          cycle_number: 0,
          approved: false,
          rewash_required: true,
          defect_code: 'stain',
          reason: 'Stain remains',
          affected_item_ids: ['item-1'],
          created_at: 'now',
        },
      ],
    });
  decide.mockResolvedValue({ rewashRequired: true });
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
      items={[{ id: 'item-1', item_name: 'Shirt' }]}
    />,
  );
  await waitFor(() => expect(view.getByText('Pass QC')).toBeTruthy());
  await fireEvent.press(view.getByText('Fail QC — require rewash'));
  await waitFor(() =>
    expect(
      view.getByText(
        'Choose a defect and enter a reason of at least 5 characters.',
      ),
    ).toBeTruthy(),
  );
  expect(decide).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('stain'));
  await fireEvent.changeText(view.getByLabelText('QC reason'), 'Stain remains');
  await fireEvent.press(view.getByLabelText('Shirt'));
  await fireEvent.press(view.getByText('Fail QC — require rewash'));
  await waitFor(() =>
    expect(view.getByText('Cycle 0 · Failed — rewash required')).toBeTruthy(),
  );
  expect(decide).toHaveBeenCalledWith('token', 'order-1', {
    approved: false,
    notes: 'Stain remains',
    defectCode: 'stain',
    affectedItemIds: ['item-1'],
  });
  expect(view.getByText('Start Wash')).toBeTruthy();
});
test('Facility Staff can approve QC and sees the rewash cap', async () => {
  const ready = {
    ...empty,
    orderStatus: 'processing',
    nextStage: null,
    role: 'facility_employee',
    canQualityCheck: true,
    rewashCycle: 2,
    stages: [
      {
        id: 'pack-1',
        operation_type: 'packaging',
        started_at: 'earlier',
        completed_at: 'now',
      },
    ],
  };
  get.mockResolvedValueOnce(ready);
  const staff = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
      packingReady={true}
    />,
  );
  await waitFor(() =>
    expect(
      staff.getByText(
        'Rewash limit reached. Reconciliation notes are required for final approval.',
      ),
    ).toBeTruthy(),
  );
  await fireEvent.press(staff.getByText('Pass QC'));
  expect(
    staff.getByText(
      'Reconciliation notes are required after two rewash cycles.',
    ),
  ).toBeTruthy();
  expect(decide).not.toHaveBeenCalled();
  expect(staff.getByText('Fail QC — require rewash').props).toBeTruthy();
});

test('shows initial ready to start processing state for verified order with empty stages', async () => {
  get.mockResolvedValueOnce(empty);
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Ready to start processing')).toBeTruthy(),
  );
  expect(
    view.getByText(
      'Intake verification is complete. Start the first processing stage below.',
    ),
  ).toBeTruthy();
  expect(view.getByText('Start Wash')).toBeTruthy();
});

test('renders full processing history with completed and in-progress stages', async () => {
  get.mockResolvedValueOnce({
    ...empty,
    orderStatus: 'processing',
    nextStage: null,
    stages: [
      {
        id: 'stage-1',
        operation_type: 'washing',
        started_at: '2026-10-03T10:00:00Z',
        completed_at: '2026-10-03T10:30:00Z',
        rewash_cycle: 0,
      },
      {
        id: 'stage-2',
        operation_type: 'drying',
        started_at: '2026-10-03T10:35:00Z',
        completed_at: null,
        rewash_cycle: 0,
      },
    ],
  });
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.getByText('Cycle 0 · Wash · Completed')).toBeTruthy(),
  );
  expect(view.getByText('Cycle 0 · Dry · In progress')).toBeTruthy();
  expect(view.getByText('Complete Dry')).toBeTruthy();
  expect(view.queryByText('Ready to start processing')).toBeNull();
});

test('stepper strictly displays Wash as active/ready and Pack as waiting/locked on initial verified state', async () => {
  get.mockResolvedValueOnce({
    ...empty,
    orderStatus: 'verification',
    nextStage: 'washing',
    stages: [],
  });
  const view = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
      packingReady={true}
    />,
  );
  await waitFor(() =>
    expect(view.getByTestId('step-wash-active')).toBeTruthy(),
  );
  expect(view.getByTestId('step-dry-waiting')).toBeTruthy();
  expect(view.getByTestId('step-iron-waiting')).toBeTruthy();
  expect(view.getByTestId('step-fold-waiting')).toBeTruthy();
  expect(view.getByTestId('step-pack-waiting')).toBeTruthy();
  expect(view.getByTestId('step-qc-waiting')).toBeTruthy();
  expect(view.queryByTestId('step-pack-complete')).toBeNull();
});

test('stepper updates sequentially as stages complete: Wash -> Dry -> Iron -> Fold -> Pack -> QC', async () => {
  // 1. Wash completed, Dry ready
  get.mockResolvedValueOnce({
    ...empty,
    orderStatus: 'processing',
    nextStage: 'drying',
    stages: [
      {
        id: 'wash-1',
        operation_type: 'washing',
        started_at: '2026-10-03T10:00:00Z',
        completed_at: '2026-10-03T10:30:00Z',
      },
    ],
  });
  const view1 = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view1.getByTestId('step-wash-complete')).toBeTruthy(),
  );
  expect(view1.getByTestId('step-dry-active')).toBeTruthy();
  expect(view1.getByTestId('step-iron-waiting')).toBeTruthy();
  expect(view1.getByTestId('step-fold-waiting')).toBeTruthy();
  expect(view1.getByTestId('step-pack-waiting')).toBeTruthy();
  expect(view1.getByTestId('step-qc-waiting')).toBeTruthy();
  await view1.unmount();

  // 2. Wash, Dry, Iron, Fold completed, Pack active/ready
  get.mockResolvedValueOnce({
    ...empty,
    orderStatus: 'processing',
    nextStage: 'packaging',
    stages: [
      { id: 'w1', operation_type: 'washing', started_at: 't1', completed_at: 't2' },
      { id: 'd1', operation_type: 'drying', started_at: 't2', completed_at: 't3' },
      { id: 'i1', operation_type: 'ironing', started_at: 't3', completed_at: 't4' },
      { id: 'f1', operation_type: 'folding', started_at: 't4', completed_at: 't5' },
    ],
  });
  const view2 = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view2.getByTestId('step-wash-complete')).toBeTruthy(),
  );
  expect(view2.getByTestId('step-dry-complete')).toBeTruthy();
  expect(view2.getByTestId('step-iron-complete')).toBeTruthy();
  expect(view2.getByTestId('step-fold-complete')).toBeTruthy();
  expect(view2.getByTestId('step-pack-active')).toBeTruthy();
  expect(view2.getByTestId('step-qc-waiting')).toBeTruthy();
  await view2.unmount();

  // 3. Packaging completed, QC ready
  get.mockResolvedValueOnce({
    ...empty,
    orderStatus: 'processing',
    nextStage: null,
    canQualityCheck: true,
    stages: [
      { id: 'w1', operation_type: 'washing', started_at: 't1', completed_at: 't2' },
      { id: 'd1', operation_type: 'drying', started_at: 't2', completed_at: 't3' },
      { id: 'i1', operation_type: 'ironing', started_at: 't3', completed_at: 't4' },
      { id: 'f1', operation_type: 'folding', started_at: 't4', completed_at: 't5' },
      { id: 'p1', operation_type: 'packaging', started_at: 't5', completed_at: 't6' },
    ],
  });
  const view3 = await render(
    <FacilityProcessingPanel
      accessToken="token"
      orderId="order-1"
      onChanged={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(view3.getByTestId('step-pack-complete')).toBeTruthy(),
  );
  expect(view3.getByTestId('step-qc-active')).toBeTruthy();
});

