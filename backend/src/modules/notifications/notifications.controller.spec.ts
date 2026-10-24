import { ForbiddenException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let notificationsService: any;
  let notificationDispatcher: any;

  beforeEach(() => {
    notificationsService = {
      registerDevice: jest.fn().mockResolvedValue({ id: 'token-1' }),
      deactivateDevice: jest.fn().mockResolvedValue({ deactivated: true }),
      list: jest.fn().mockResolvedValue([]),
      markRead: jest.fn().mockResolvedValue({ id: 'notif-1', is_read: true }),
      markAllRead: jest.fn().mockResolvedValue({ updatedCount: 2 }),
      create: jest.fn().mockResolvedValue({
        id: 'notif-test-1',
        title: 'Bright & White Test',
      }),
    };

    notificationDispatcher = {
      dispatchPersisted: jest.fn().mockResolvedValue({
        notificationId: 'notif-test-1',
        dispatched: true,
        status: 'sent',
        attemptedDeviceCount: 1,
        sentCount: 1,
        failedCount: 0,
      }),
    };

    controller = new NotificationsController(
      notificationsService,
      notificationDispatcher,
    );
  });

  describe('sendTestNotification', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('successfully triggers a test notification in development for the authenticated user', async () => {
      process.env.NODE_ENV = 'development';

      const result = await controller.sendTestNotification(
        { user: { id: 'user-uuid-1' } },
        { title: 'Test Title', body: 'Test Message' },
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-uuid-1',
        'dev_test_notification',
        'Test Title',
        'Test Message',
        expect.objectContaining({ isDevTest: true }),
      );
      expect(notificationDispatcher.dispatchPersisted).toHaveBeenCalledWith(
        'notif-test-1',
      );
      expect(result).toEqual({
        ok: true,
        notificationId: 'notif-test-1',
        status: 'sent',
        attemptedDeviceCount: 1,
        sentCount: 1,
        failedCount: 0,
        reason: undefined,
        acceptanceNote: expect.any(String),
      });
    });

    it('rejects test notification requests when running in production', async () => {
      process.env.NODE_ENV = 'production';

      await expect(
        controller.sendTestNotification(
          { user: { id: 'user-uuid-1' } },
          { title: 'Test', body: 'Test' },
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(notificationDispatcher.dispatchPersisted).not.toHaveBeenCalled();
    });

    it('reports failure when no devices were reached', async () => {
      process.env.NODE_ENV = 'development';
      notificationDispatcher.dispatchPersisted.mockResolvedValue({
        notificationId: 'notif-test-1',
        dispatched: true,
        status: 'failed',
        attemptedDeviceCount: 0,
        sentCount: 0,
        failedCount: 0,
        reason: 'no_active_devices',
      });

      const result = await controller.sendTestNotification(
        { user: { id: 'user-uuid-1' } },
        {},
      );

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('no_active_devices');
    });
  });

  describe('device token endpoints', () => {
    it('registers a device token for authenticated user', async () => {
      const result = await controller.device(
        { user: { id: 'user-uuid-1' } },
        { token: 'fcm-token-123', platform: 'android' },
      );

      expect(notificationsService.registerDevice).toHaveBeenCalledWith(
        'user-uuid-1',
        'fcm-token-123',
        'android',
      );
      expect(result).toEqual({ id: 'token-1' });
    });

    it('deactivates a device token for authenticated user', async () => {
      const result = await controller.deactivate(
        { user: { id: 'user-uuid-1' } },
        { token: 'fcm-token-123' },
      );

      expect(notificationsService.deactivateDevice).toHaveBeenCalledWith(
        'user-uuid-1',
        'fcm-token-123',
      );
      expect(result).toEqual({ deactivated: true });
    });
  });
});
