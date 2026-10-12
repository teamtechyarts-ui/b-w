import {
  realtimeService,
  RealtimeEventPayload,
  RealtimeEventType,
} from './realtimeService';

describe('RealtimeService Mobile Integration & Performance Tests', () => {
  test('subscribes to role channels and dispatches events to registered listeners', () => {
    const receivedCustomerEvents: RealtimeEventPayload[] = [];
    const receivedDriverEvents: RealtimeEventPayload[] = [];
    const receivedAdminEvents: RealtimeEventPayload[] = [];

    const unsubscribeCustomer = realtimeService.registerLocalListener(
      'customer:cust_123',
      (e) => receivedCustomerEvents.push(e),
    );

    const unsubscribeDriver = realtimeService.registerLocalListener(
      'driver:available',
      (e) => receivedDriverEvents.push(e),
    );

    const unsubscribeAdmin = realtimeService.registerLocalListener(
      'admin:operations',
      (e) => receivedAdminEvents.push(e),
    );

    const testEvent: RealtimeEventPayload = {
      eventType: 'ORDER_STATUS_CHANGED',
      entityId: 'ord_999',
      orderId: 'ord_999',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
    };

    realtimeService.emitLocalEvent('customer:cust_123', testEvent);
    expect(receivedCustomerEvents).toHaveLength(1);
    expect(receivedCustomerEvents[0].status).toBe('confirmed');
    expect(receivedDriverEvents).toHaveLength(0);

    const jobEvent: RealtimeEventPayload = {
      eventType: 'JOB_AVAILABLE',
      entityId: 'ord_999',
      orderId: 'ord_999',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
    };

    realtimeService.emitLocalEvent('driver:available', jobEvent);
    expect(receivedDriverEvents).toHaveLength(1);
    expect(receivedDriverEvents[0].eventType).toBe('JOB_AVAILABLE');

    unsubscribeCustomer();
    unsubscribeDriver();
    unsubscribeAdmin();
  });

  test('measures local UI propagation latency under 500 ms budget (strictly < 100 ms target)', () => {
    const start = performance.now();
    let end = 0;

    const unsubscribe = realtimeService.registerLocalListener('order:ord_benchmark', (e) => {
      end = performance.now();
      expect(e.status).toBe('in_transit_to_facility');
    });

    realtimeService.emitLocalEvent('order:ord_benchmark', {
      eventType: 'ORDER_STATUS_CHANGED',
      entityId: 'ord_benchmark',
      orderId: 'ord_benchmark',
      status: 'in_transit_to_facility',
      timestamp: new Date().toISOString(),
    });

    const elapsedMs = end - start;
    expect(elapsedMs).toBeLessThan(100); // Sub-100ms local event-to-handler execution
    unsubscribe();
  });

  test('handles driver claim conflict notifications instantly', () => {
    const driver1Events: RealtimeEventPayload[] = [];
    const driver2Events: RealtimeEventPayload[] = [];

    const unsub1 = realtimeService.registerLocalListener('driver:available', (e) =>
      driver1Events.push(e),
    );
    const unsub2 = realtimeService.registerLocalListener('driver:available', (e) =>
      driver2Events.push(e),
    );

    // Broadcast that job was claimed by driver 1
    realtimeService.emitLocalEvent('driver:available', {
      eventType: 'JOB_CLAIMED',
      entityId: 'ord_compete_1',
      orderId: 'ord_compete_1',
      driverId: 'drv_1',
      timestamp: new Date().toISOString(),
    });

    expect(driver1Events).toHaveLength(1);
    expect(driver2Events).toHaveLength(1);
    expect(driver2Events[0].eventType).toBe('JOB_CLAIMED');
    expect(driver2Events[0].driverId).toBe('drv_1');

    unsub1();
    unsub2();
  });

  test('reconciliation listener triggers on foreground / reconnect', () => {
    let reconcileCalled = false;
    const unsub = realtimeService.onReconnect(() => {
      reconcileCalled = true;
    });

    // Simulate foreground reconciliation trigger
    realtimeService.triggerReconciliation();
    expect(reconcileCalled).toBe(true);

    unsub();
  });

  test('deduplicates foreground reconciliation notifications when a listener is registered on multiple channels', () => {
    let callCount = 0;
    const multiChannelListener = (event: RealtimeEventPayload) => {
      if (event.eventType === 'RECONNECT_RECONCILE') {
        callCount += 1;
      }
    };

    // Register same callback on 2 different channels (e.g. orders:all and customer:456)
    const unsub1 = realtimeService.registerLocalListener('orders:all', multiChannelListener);
    const unsub2 = realtimeService.registerLocalListener('customer:456', multiChannelListener);

    realtimeService.triggerReconciliation();

    // Must be invoked exactly once, not twice!
    expect(callCount).toBe(1);

    unsub1();
    unsub2();
  });
});
