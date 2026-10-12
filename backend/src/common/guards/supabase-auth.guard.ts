import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import * as crypto from 'crypto';

interface CachedSession {
  user: {
    id: string;
    phone: string | null;
    email: string | null;
    roles: string[];
    permissions: string[];
  };
  expiresAt: number;
}

const SESSION_CACHE = new Map<string, CachedSession>();
const CACHE_TTL_MS = 30_000; // 30 seconds TTL
const MAX_CACHE_SIZE = 500;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload?.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // Malformed token or payload
  }
  return null;
}

export function invalidateAuthSessionCache(token?: string) {
  if (token) {
    SESSION_CACHE.delete(hashToken(token));
  } else {
    SESSION_CACHE.clear();
  }
}

export function invalidateAuthSessionsForUser(userId: string) {
  for (const [key, session] of SESSION_CACHE.entries()) {
    if (session.user.id === userId) {
      SESSION_CACHE.delete(key);
    }
  }
}

export function getAuthSessionCacheSize(): number {
  return SESSION_CACHE.size;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(
        IS_PUBLIC_KEY,
        [
          context.getHandler(),
          context.getClass(),
        ],
      );

    if (isPublic) {
      return true;
    }

    const request =
      context.switchToHttp().getRequest<any>();

    const authorization =
      request.headers?.authorization;

    if (
      !authorization ||
      !authorization.startsWith('Bearer ')
    ) {
      throw new UnauthorizedException(
        'Missing Bearer token',
      );
    }

    const accessToken =
      authorization.slice('Bearer '.length).trim();

    if (!accessToken) {
      throw new UnauthorizedException(
        'Missing Bearer token',
      );
    }

    // Check bounded in-memory session cache
    const tokenHash = hashToken(accessToken);
    const cached = SESSION_CACHE.get(tokenHash);
    const now = Date.now();

    if (cached) {
      if (cached.expiresAt > now) {
        request.user = cached.user;
        request.accessToken = accessToken;
        return true;
      }
      SESSION_CACHE.delete(tokenHash);
    }

    const user =
      await this.supabase.getUser(accessToken);

    if (!user) {
      SESSION_CACHE.delete(tokenHash);
      throw new UnauthorizedException(
        'Invalid Supabase session',
      );
    }

    /*
     * The token has already been validated.
     *
     * These are backend authorization lookups, so the
     * trusted server client is used deliberately.
     *
     * All returned data remains scoped to the authenticated
     * user's verified UUID.
     */
    const {
      data: profile,
      error: profileError,
    } = await this.supabase.admin
      .from('profiles')
      .select('id,is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (
      profileError ||
      !profile ||
      !profile.is_active
    ) {
      throw new UnauthorizedException(
        'Inactive or missing profile',
      );
    }

    const {
      data: rows,
      error: rolesError,
    } = await this.supabase.admin
      .from('profile_roles')
      .select(
        'roles(code,role_permissions(permissions(code)))',
      )
      .eq('profile_id', user.id);

    if (rolesError) {
      throw new UnauthorizedException(
        'Unable to resolve user authorization',
      );
    }

    const roles: string[] = [];
    const permissions: string[] = [];

    for (const row of rows ?? []) {
      const role: any = (row as any).roles;

      if (role?.code) {
        roles.push(role.code);
      }

      for (
        const rolePermission
        of role?.role_permissions ?? []
      ) {
        const permissionCode =
          rolePermission?.permissions?.code;

        if (permissionCode) {
          permissions.push(permissionCode);
        }
      }
    }

    if (roles.includes('admin') && roles.length !== 1) {
      throw new UnauthorizedException('Conflicting account roles');
    }
    if (roles.includes('driver')) {
      const { data: driver, error: driverError } = await this.supabase.admin
        .from('drivers').select('id,is_active').eq('profile_id', user.id).maybeSingle();
      if (driverError || !driver?.is_active) {
        throw new UnauthorizedException('Inactive driver account');
      }
    }
    if (roles.includes('facility_employee') || roles.includes('manager')) {
      const { data: staff, error: staffError } = await this.supabase.admin
        .from('facility_employees').select('id,facility_id,employee_role,is_active')
        .eq('profile_id', user.id).eq('is_active', true).maybeSingle();
      if (staffError || !staff) {
        throw new UnauthorizedException('Inactive facility account');
      }
      if (!roles.includes(staff.employee_role) || roles.length !== 1) {
        throw new UnauthorizedException('Facility role mismatch');
      }
      const { data: facility, error: facilityError } = await this.supabase.admin
        .from('facilities').select('id,is_active').eq('id', staff.facility_id).maybeSingle();
      if (facilityError || !facility?.is_active) {
        throw new UnauthorizedException('Inactive facility');
      }
    }

    const resolvedUser = {
      id: user.id,
      phone: user.phone ?? null,
      email: user.email ?? null,
      roles: [...new Set(roles)],
      permissions: [...new Set(permissions)],
    };

    request.user = resolvedUser;

    // Store in bounded in-memory cache (capped to JWT exp if shorter than TTL)
    const jwtExpMs = parseJwtExp(accessToken);
    let expiresAt = now + CACHE_TTL_MS;
    if (jwtExpMs && jwtExpMs < expiresAt) {
      expiresAt = jwtExpMs;
    }

    if (expiresAt > now) {
      if (SESSION_CACHE.size >= MAX_CACHE_SIZE) {
        const oldestKey = SESSION_CACHE.keys().next().value;
        if (oldestKey) SESSION_CACHE.delete(oldestKey);
      }
      SESSION_CACHE.set(tokenHash, {
        user: resolvedUser,
        expiresAt,
      });
    }

    /*
     * Preserve the access token in case a downstream service
     * intentionally needs an RLS-aware user Supabase client.
     */
    request.accessToken = accessToken;

    return true;
  }
}
