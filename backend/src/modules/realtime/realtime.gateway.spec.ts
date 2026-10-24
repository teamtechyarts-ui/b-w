import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway, AuthenticatedSocket } from './realtime.gateway';
import { SupabaseService } from '../supabase/supabase.service';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let mockSupabase: any;
  let mockSocket: any;

  beforeEach(async () => {
    mockSupabase = {
      getUser: jest.fn(),
      admin: {
        from: jest.fn(),
      },
    };

    mockSocket = {
      id: 'socket-123',
      handshake: {
        auth: { token: 'valid-jwt-token' },
        headers: {},
      },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: {},
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    gateway.server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('authenticates valid token and joins user and role rooms', async () => {
      mockSupabase.getUser.mockResolvedValue({
        id: 'user-abc',
        email: 'user@example.com',
      });

      mockSupabase.admin.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'user-abc', is_active: true, facility_id: 'facility-10' },
            }),
          };
        }
        if (table === 'profile_roles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [{ roles: { code: 'driver' } }],
            }),
          };
        }
        if (table === 'drivers') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'driver-1', is_active: true },
            }),
          };
        }
        if (table === 'facility_employees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { facility_id: 'facility-10', is_active: true },
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        };
      });

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith('user:user-abc');
      expect(mockSocket.join).toHaveBeenCalledWith('customer:user-abc');
      expect(mockSocket.join).toHaveBeenCalledWith('orders:all');
      expect(mockSocket.join).toHaveBeenCalledWith('role:driver');
      expect(mockSocket.join).toHaveBeenCalledWith('facility:facility-10');
      expect(mockSocket.join).toHaveBeenCalledWith('facility:all');
      expect(mockSocket.join).toHaveBeenCalledWith('driver:driver-1');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'connection_established',
        expect.objectContaining({
          userId: 'user-abc',
          rooms: expect.arrayContaining([
            'user:user-abc',
            'customer:user-abc',
            'orders:all',
            'role:driver',
            'facility:facility-10',
            'facility:all',
            'driver:driver-1',
          ]),
        }),
      );
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('rejects connection if token is missing', async () => {
      mockSocket.handshake.auth = {};
      mockSocket.handshake.headers = {};

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'auth_error',
        expect.objectContaining({ message: 'Authentication token required' }),
      );
      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects connection if token is invalid', async () => {
      mockSupabase.getUser.mockResolvedValue(null);

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'auth_error',
        expect.objectContaining({ message: 'Invalid or expired session token' }),
      );
      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects connection if profile is inactive', async () => {
      mockSupabase.getUser.mockResolvedValue({ id: 'user-inactive' });
      mockSupabase.admin.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'user-inactive', is_active: false },
        }),
      });

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'auth_error',
        expect.objectContaining({ message: 'Inactive user profile' }),
      );
      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleSubscribeOrder', () => {
    it('allows customer to subscribe to their own order', async () => {
      mockSocket.data = {
        user: { id: 'cust-1', roles: ['customer'] },
        subscribedRooms: new Set<string>(),
      };

      mockSupabase.admin.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'order-1', customer_id: 'cust-1' },
        }),
      });

      const result = await gateway.handleSubscribeOrder(mockSocket, {
        orderId: 'order-1',
      });

      expect(result).toEqual({ ok: true, room: 'order:order-1' });
      expect(mockSocket.join).toHaveBeenCalledWith('order:order-1');
    });

    it('rejects customer subscribing to another customer order', async () => {
      mockSocket.data = {
        user: { id: 'cust-attacker', roles: ['customer'] },
        subscribedRooms: new Set<string>(),
      };

      mockSupabase.admin.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'order-1', customer_id: 'cust-victim' },
        }),
      });

      const result = await gateway.handleSubscribeOrder(mockSocket, {
        orderId: 'order-1',
      });

      expect(result).toEqual({ ok: false, error: 'Access denied to this order' });
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('allows staff roles to subscribe to any order', async () => {
      mockSocket.data = {
        user: { id: 'admin-1', roles: ['admin'] },
        subscribedRooms: new Set<string>(),
      };

      const result = await gateway.handleSubscribeOrder(mockSocket, {
        orderId: 'order-1',
      });

      expect(result).toEqual({ ok: true, room: 'order:order-1' });
      expect(mockSocket.join).toHaveBeenCalledWith('order:order-1');
    });
  });

  describe('handleSubscribeChannel', () => {
    it('allows staff to subscribe to facility channel', async () => {
      mockSocket.data = {
        user: { id: 'mgr-1', roles: ['manager'], facilityId: 'fac-1' },
        subscribedRooms: new Set<string>(),
      };

      const result = await gateway.handleSubscribeChannel(mockSocket, {
        channel: 'facility:all',
      });

      expect(result).toEqual({ ok: true, room: 'facility:all' });
      expect(mockSocket.join).toHaveBeenCalledWith('facility:all');
    });

    it('allows driver to subscribe to available driver jobs pool', async () => {
      mockSocket.data = {
        user: { id: 'drv-1', roles: ['driver'] },
        subscribedRooms: new Set<string>(),
      };

      const result = await gateway.handleSubscribeChannel(mockSocket, {
        channel: 'driver:available',
      });

      expect(result).toEqual({ ok: true, room: 'driver:available' });
      expect(mockSocket.join).toHaveBeenCalledWith('driver:available');
    });

    it('unsubscribes client from channel on handleUnsubscribeChannel', () => {
      mockSocket.data = {
        user: { id: 'usr-1', roles: ['customer'] },
        subscribedRooms: new Set<string>(['customer:usr-1']),
      };

      const result = gateway.handleUnsubscribeChannel(mockSocket, {
        channel: 'customer:usr-1',
      });

      expect(result).toEqual({ ok: true, room: 'customer:usr-1' });
      expect(mockSocket.leave).toHaveBeenCalledWith('customer:usr-1');
    });
  });
});
