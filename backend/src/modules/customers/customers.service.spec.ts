import { CustomersService } from './customers.service';
import { ConflictException } from '@nestjs/common';
import * as authGuard from '../../common/guards/supabase-auth.guard';
import * as ordersService from '../orders/orders.service';

describe('CustomersService deleteAccount', () => {
  let service: CustomersService;
  let supabaseMock: any;

  beforeEach(() => {
    supabaseMock = {
      admin: {
        from: jest.fn(),
        auth: {
          admin: {
            deleteUser: jest.fn().mockResolvedValue({}),
            updateUserById: jest.fn().mockResolvedValue({}),
          },
        },
      },
    };
    service = new CustomersService(supabaseMock);
  });

  it('rejects account deletion if active orders exist in progress', async () => {
    supabaseMock.admin.from.mockImplementation((table: string) => {
      if (table === 'customers') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'cust-1' }, error: null }),
        };
      }
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ id: 'order-1', current_status: 'processing' }],
            error: null,
          }),
        };
      }
      return {};
    });

    await expect(service.deleteAccount('user-1')).rejects.toThrow(ConflictException);
  });

  it('deletes account, deactivates profile, and invalidates auth/customer caches', async () => {
    const invalidateAuthSpy = jest.spyOn(authGuard, 'invalidateAuthSessionsForUser');
    const invalidateCustomerSpy = jest.spyOn(ordersService, 'invalidateCustomerCache');

    supabaseMock.admin.from.mockImplementation((table: string) => {
      if (table === 'customers') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'cust-1' }, error: null }),
        };
      }
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'device_tokens' || table === 'push_devices') {
        return {
          delete: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'customer_addresses') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'profiles') {
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      }
      return {};
    });

    const result = await service.deleteAccount('user-1');
    expect(result.deleted).toBe(true);
    expect(invalidateAuthSpy).toHaveBeenCalledWith('user-1');
    expect(invalidateCustomerSpy).toHaveBeenCalledWith('user-1');
  });
});
