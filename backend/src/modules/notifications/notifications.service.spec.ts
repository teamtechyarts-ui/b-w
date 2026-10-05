import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

function updateQuery(data: any, error: any = null) {
  const query: any = {
    update: jest.fn(() => query),
    eq: jest.fn(() => query),
    select: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe('NotificationsService', () => {
  it('lists only the authenticated Driver profile notifications', async () => {
    const query: any = {select: jest.fn(), eq: jest.fn(), order: jest.fn().mockResolvedValue({data: [{id: 'own-assignment'}], error: null})};
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    const service = new NotificationsService({admin: {from: jest.fn(() => query)}} as any);
    await expect(service.list('driver-profile')).resolves.toEqual([{id: 'own-assignment'}]);
    expect(query.eq).toHaveBeenCalledWith('profile_id', 'driver-profile');
  });
  it('marks both notification read fields for the owning profile', async () => {
    const query = updateQuery({
      id: 'notification-1',
      profile_id: 'profile-1',
      is_read: true,
    });
    const service = new NotificationsService({
      admin: { from: jest.fn(() => query) },
    } as any);

    await expect(
      service.markRead('profile-1', 'notification-1'),
    ).resolves.toMatchObject({ is_read: true });
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_read: true,
        read_at: expect.any(String),
      }),
    );
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'notification-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'profile_id', 'profile-1');
  });

  it('does not reveal another profile notification through mark-read', async () => {
    const query = updateQuery(null);
    const service = new NotificationsService({
      admin: { from: jest.fn(() => query) },
    } as any);

    await expect(
      service.markRead('profile-2', 'notification-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivates only the calling profile device token', async () => {
    const query = updateQuery({ id: 'device-1' });
    const service = new NotificationsService({
      admin: { from: jest.fn(() => query) },
    } as any);

    await expect(
      service.deactivateDevice('profile-1', 'device-token'),
    ).resolves.toEqual({ deactivated: true });
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        updated_at: expect.any(String),
      }),
    );
    expect(query.eq).toHaveBeenNthCalledWith(1, 'profile_id', 'profile-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'push_token', 'device-token');
  });

  it('makes repeated or unknown device deactivation safe', async () => {
    const query = updateQuery(null);
    const service = new NotificationsService({
      admin: { from: jest.fn(() => query) },
    } as any);

    await expect(
      service.deactivateDevice('profile-1', 'inactive-token'),
    ).resolves.toEqual({ deactivated: false });
  });

  it('marks all unread notifications read for the calling profile', async () => {
    const query: any = {
      update: jest.fn(() => query),
      eq: jest.fn(() => query),
      select: jest.fn().mockResolvedValue({ data: [{ id: 'n-1' }, { id: 'n-2' }], error: null }),
    };
    const service = new NotificationsService({
      admin: { from: jest.fn(() => query) },
    } as any);

    const result = await service.markAllRead('profile-1');
    expect(result).toEqual({ updatedCount: 2 });
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_read: true,
        read_at: expect.any(String),
      }),
    );
    expect(query.eq).toHaveBeenCalledWith('profile_id', 'profile-1');
    expect(query.eq).toHaveBeenCalledWith('is_read', false);
  });

  it('creates an authoritative order-specific notification', async () => {
    const insertedRow = {
      id: 'n-123',
      profile_id: 'profile-1',
      order_id: 'order-123',
      notification_type: 'order.confirmed',
      event_type: 'order.confirmed',
      title: 'Order confirmed',
      body: 'Order BW-20261003-7CB85C51 has been placed and confirmed.',
      data: { orderId: 'order-123', orderNumber: 'BW-20261003-7CB85C51' },
      status: 'queued',
    };
    const query: any = {
      insert: jest.fn(() => query),
      select: jest.fn(() => query),
      single: jest.fn().mockResolvedValue({ data: insertedRow, error: null }),
    };
    const service = new NotificationsService({
      admin: { from: jest.fn(() => query) },
    } as any);

    const result = await service.create(
      'profile-1',
      'order.confirmed',
      'Order confirmed',
      'Order BW-20261003-7CB85C51 has been placed and confirmed.',
      { orderId: 'order-123', orderNumber: 'BW-20261003-7CB85C51' },
    );
    expect(result).toEqual(insertedRow);
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'profile-1',
        order_id: 'order-123',
        notification_type: 'order.confirmed',
        title: 'Order confirmed',
      }),
    );
  });
});
