import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeService } from './realtime.service';
import { RealtimeGateway } from './realtime.gateway';
import { SupabaseService } from '../supabase/supabase.service';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let gateway: RealtimeGateway;
  let mockServer: any;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const mockGateway = {
      server: mockServer,
    };

    const mockSupabase = {
      admin: {
        from: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        { provide: RealtimeGateway, useValue: mockGateway },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<RealtimeService>(RealtimeService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('emitToUser', () => {
    it('emits event to user room with enriched payload', () => {
      service.emitToUser('user-123', 'order.updated', {
        orderId: 'order-1',
        status: 'in_transit',
      });

      expect(mockServer.to).toHaveBeenCalledWith('user:user-123');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'order.updated',
        expect.objectContaining({
          eventId: expect.any(String),
          eventType: 'order.updated',
          orderId: 'order-1',
          status: 'in_transit',
          timestamp: expect.any(String),
        }),
      );
      // Also emits alternative uppercase event for backwards compatibility
      expect(mockServer.emit).toHaveBeenCalledWith(
        'ORDER_STATUS_CHANGED',
        expect.objectContaining({
          orderId: 'order-1',
        }),
      );
    });

    it('strips sensitive fields from emitted payload', () => {
      service.emitToUser('user-123', 'order.updated', {
        orderId: 'order-1',
        password: 'secret_password',
        otp: '123456',
        driverPin: '9999',
      });

      const emittedCall = mockServer.emit.mock.calls[0];
      const payload = emittedCall[1];
      expect(payload.data.password).toBeUndefined();
      expect(payload.data.otp).toBeUndefined();
      expect(payload.data.driverPin).toBeUndefined();
    });
  });

  describe('emitToRole', () => {
    it('emits event to role room', () => {
      service.emitToRole('driver', 'JOB_AVAILABLE', {
        assignmentId: 'assign-1',
      });

      expect(mockServer.to).toHaveBeenCalledWith('role:driver');
      expect(mockServer.emit).toHaveBeenCalledWith('JOB_AVAILABLE', expect.any(Object));
    });
  });

  describe('emitToFacility', () => {
    it('emits event to facility room', () => {
      service.emitToFacility('facility-1', 'FACILITY_INTAKE', {
        orderId: 'order-99',
      });

      expect(mockServer.to).toHaveBeenCalledWith('facility:facility-1');
      expect(mockServer.emit).toHaveBeenCalledWith('FACILITY_INTAKE', expect.any(Object));
    });
  });

  describe('emitToOrder', () => {
    it('emits event to order room', () => {
      service.emitToOrder('order-99', 'order.updated', {
        status: 'delivered',
      });

      expect(mockServer.to).toHaveBeenCalledWith('order:order-99');
      expect(mockServer.emit).toHaveBeenCalledWith('order.updated', expect.any(Object));
    });
  });

  describe('Business event helpers', () => {
    it('emitOrderCreated notifies customer, facility, and roles', () => {
      service.emitOrderCreated(
        { id: 'order-1', order_number: 'BW-001', current_status: 'placed' },
        'cust-1',
        'fac-1',
      );

      expect(mockServer.to).toHaveBeenCalledWith('user:cust-1');
      expect(mockServer.to).toHaveBeenCalledWith('facility:fac-1');
      expect(mockServer.to).toHaveBeenCalledWith('role:admin');
      expect(mockServer.to).toHaveBeenCalledWith('role:driver');
    });

    it('emitNotificationCreated notifies specific user profile', () => {
      service.emitNotificationCreated('cust-1', {
        id: 'notif-1',
        title: 'Order Ready',
        order_id: 'order-1',
      });

      expect(mockServer.to).toHaveBeenCalledWith('user:cust-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'notification.created',
        expect.objectContaining({
          notification: expect.objectContaining({ id: 'notif-1' }),
        }),
      );
    });
  });
});
