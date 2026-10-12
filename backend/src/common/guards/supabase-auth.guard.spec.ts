import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SupabaseAuthGuard,
  invalidateAuthSessionCache,
  invalidateAuthSessionsForUser,
  getAuthSessionCacheSize,
} from './supabase-auth.guard';
import * as crypto from 'crypto';

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let reflector: jest.Mocked<Reflector>;
  let supabaseMock: any;

  function createMockContext(headers: Record<string, string> = {}, handlerMetadata?: any): ExecutionContext {
    const request: any = {
      headers: { ...headers },
    };
    return {
      getHandler: jest.fn().mockReturnValue(handlerMetadata),
      getClass: jest.fn().mockReturnValue(null),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  }

  function makeMockJwt(userId: string, expInSeconds: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        exp: Math.floor(Date.now() / 1000) + expInSeconds,
      }),
    ).toString('base64url');
    const sig = 'mock_signature';
    return `${header}.${payload}.${sig}`;
  }

  beforeEach(() => {
    invalidateAuthSessionCache(); // Clean cache
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as any;

    supabaseMock = {
      getUser: jest.fn(),
      admin: {
        from: jest.fn(),
      },
    };

    guard = new SupabaseAuthGuard(reflector, supabaseMock);
  });

  afterEach(() => {
    invalidateAuthSessionCache();
  });

  it('allows public routes without authentication headers', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createMockContext();
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(supabaseMock.getUser).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when authorization header is missing', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Missing Bearer token'),
    );
  });

  it('throws UnauthorizedException when Bearer token is empty', async () => {
    const context = createMockContext({ authorization: 'Bearer   ' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Missing Bearer token'),
    );
  });

  it('authenticates valid token, builds user context, and caches for 30s', async () => {
    const token = makeMockJwt('user-1', 3600);
    const mockUser = { id: 'user-1', phone: '+919876543210', email: 'test@example.com' };

    supabaseMock.getUser.mockResolvedValue(mockUser);
    supabaseMock.admin.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'user-1', is_active: true }, error: null }),
        };
      }
      if (table === 'profile_roles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ roles: { code: 'customer', role_permissions: [] } }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const context1 = createMockContext({ authorization: `Bearer ${token}` });
    const req1 = context1.switchToHttp().getRequest<any>();

    const ok1 = await guard.canActivate(context1);
    expect(ok1).toBe(true);
    expect(req1.user.id).toBe('user-1');
    expect(req1.user.roles).toEqual(['customer']);
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(1);

    // Second request with same token must hit cache without querying Supabase again
    const context2 = createMockContext({ authorization: `Bearer ${token}` });
    const req2 = context2.switchToHttp().getRequest<any>();

    const ok2 = await guard.canActivate(context2);
    expect(ok2).toBe(true);
    expect(req2.user.id).toBe('user-1');
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(1); // Cached! No 2nd call
  });

  it('caps cache TTL when JWT exp is shorter than 30s default', async () => {
    // Token expires in 1 second
    const shortToken = makeMockJwt('user-exp', 1);
    const mockUser = { id: 'user-exp', phone: null, email: 'exp@example.com' };

    supabaseMock.getUser.mockResolvedValue(mockUser);
    supabaseMock.admin.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'user-exp', is_active: true }, error: null }),
        };
      }
      if (table === 'profile_roles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const context = createMockContext({ authorization: `Bearer ${shortToken}` });
    await guard.canActivate(context);
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(1);

    // Fast forward past 1s JWT expiration
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);

    const contextExpired = createMockContext({ authorization: `Bearer ${shortToken}` });
    await guard.canActivate(contextExpired);
    // Because token expired, cache was invalidated on read and getUser was called again
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(2);

    jest.restoreAllMocks();
  });

  it('invalidates cache by token', async () => {
    const token = makeMockJwt('user-inv', 3600);
    supabaseMock.getUser.mockResolvedValue({ id: 'user-inv', phone: null, email: 'inv@example.com' });
    supabaseMock.admin.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'user-inv', is_active: true }, error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const ctx1 = createMockContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx1);
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(1);

    // Explicitly invalidate token
    invalidateAuthSessionCache(token);

    const ctx2 = createMockContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx2);
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(2);
  });

  it('invalidates all cached sessions for a given user ID', async () => {
    const token = makeMockJwt('user-to-purge', 3600);
    supabaseMock.getUser.mockResolvedValue({ id: 'user-to-purge', phone: null, email: 'purge@example.com' });
    supabaseMock.admin.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'user-to-purge', is_active: true }, error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const ctx1 = createMockContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx1);
    expect(getAuthSessionCacheSize()).toBe(1);

    // Invalidate by user ID (e.g. account deleted or password reset)
    invalidateAuthSessionsForUser('user-to-purge');
    expect(getAuthSessionCacheSize()).toBe(0);

    const ctx2 = createMockContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx2);
    expect(supabaseMock.getUser).toHaveBeenCalledTimes(2);
  });

  it('rejects inactive profile and does not cache it', async () => {
    const token = makeMockJwt('user-inactive', 3600);
    supabaseMock.getUser.mockResolvedValue({ id: 'user-inactive', phone: null, email: 'inactive@example.com' });
    supabaseMock.admin.from.mockImplementation((table: string) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'user-inactive', is_active: false }, error: null }),
    }));

    const ctx = createMockContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException('Inactive or missing profile'),
    );
    expect(getAuthSessionCacheSize()).toBe(0);
  });

  it('throws and purges token on Supabase session validation failure', async () => {
    const token = makeMockJwt('user-bad', 3600);
    supabaseMock.getUser.mockResolvedValue(null);

    const ctx = createMockContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException('Invalid Supabase session'),
    );
    expect(getAuthSessionCacheSize()).toBe(0);
  });
});
