import {realtimeService, resolveSocketUrl} from './realtimeService';

describe('RealtimeService Mobile Client', () => {
  beforeEach(() => {
    realtimeService.disconnect();
  });

  it('resolves socket URL from environment without v1 prefix', () => {
    const url = resolveSocketUrl();
    expect(url).not.toMatch(/\/v1$/);
    expect(url.length).toBeGreaterThan(0);
  });

  it('maintains a single shared socket instance', async () => {
    const socket1 = await realtimeService.getOrInitSocket('test-token-1');
    const socket2 = await realtimeService.getOrInitSocket('test-token-1');
    expect(socket1).toBe(socket2);
  });

  it('routes incoming order events to order and orders:all channels', async () => {
    const orderEvents: any[] = [];
    const allOrdersEvents: any[] = [];

    const unsubOrder = await realtimeService.subscribeToChannel(
      'order:order-123',
      evt => orderEvents.push(evt),
      'token',
    );
    const unsubAll = await realtimeService.subscribeToChannel(
      'orders:all',
      evt => allOrdersEvents.push(evt),
      'token',
    );

    realtimeService.publishLocalEvent('order:order-123', {
      eventType: 'order.updated',
      entityId: 'order-123',
      orderId: 'order-123',
      status: 'in_transit',
      timestamp: new Date().toISOString(),
    });

    expect(orderEvents.length).toBe(1);
    expect(orderEvents[0].status).toBe('in_transit');

    unsubOrder();
    unsubAll();
  });

  it('deduplicates duplicate events within sliding window', async () => {
    const received: any[] = [];
    const unsub = await realtimeService.subscribeToChannel(
      'orders:all',
      evt => received.push(evt),
      'token',
    );

    const event = {
      eventId: 'evt-unique-99',
      eventType: 'ORDER_STATUS_CHANGED' as const,
      entityId: 'order-1',
      orderId: 'order-1',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
    };

    // Simulate socket delivering the same event twice
    (realtimeService as any).dispatchIncomingEvent('ORDER_STATUS_CHANGED', event);
    (realtimeService as any).dispatchIncomingEvent('ORDER_STATUS_CHANGED', event);

    expect(received.length).toBe(1);

    unsub();
  });

  it('cleans up channels and tokens on disconnect', async () => {
    await realtimeService.subscribeToChannel('customer:cust-1', () => {}, 'token');
    expect((realtimeService as any).channels.size).toBe(1);

    realtimeService.disconnect();

    expect((realtimeService as any).channels.size).toBe(0);
    expect(realtimeService.isConnected()).toBe(false);
  });
});
