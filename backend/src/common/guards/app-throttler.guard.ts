import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { sha256 } from '@nestjs/throttler/dist/hash';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(AppThrottlerGuard.name);

  /**
   * Derive a safe, authenticated tracker key.
   * - If the request has an authenticated user (verified by SupabaseAuthGuard),
   *   track by the authenticated user's ID and facility ID.
   * - If unauthenticated, track by the client's IP without blindly trusting spoofed headers.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user;
    if (user && typeof user.id === 'string' && user.id.trim()) {
      const facilityId =
        typeof user.facility_id === 'string' && user.facility_id.trim()
          ? user.facility_id.trim()
          : null;
      return facilityId
        ? `fac_${facilityId}:usr_${user.id.trim()}`
        : `usr_${user.id.trim()}`;
    }

    // Unauthenticated requests: fallback to validated Fastify connection IP
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    return `ip_${clientIp}`;
  }

  /**
   * Generate an identity- and controller-scoped storage key.
   * Scoping by controller ensures that the controller-wide rate limit (e.g. 120 req/min)
   * applies collectively across all routes in the controller, preventing abuse where
   * an attacker cycles through multiple handlers to multiply their throughput.
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const controller = context.getClass()?.name || 'controller';
    const prefix = `${controller}-${name}`;
    return sha256(`${prefix}-${suffix}`);
  }

  /**
   * Add structured logging and standard HTTP 429 response formatting.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: any,
  ): Promise<void> {
    const { req, res } = this.getRequestResponse(context);
    const handler = context.getHandler()?.name || 'unknown';
    const controller = context.getClass()?.name || 'unknown';
    const tracker = throttlerLimitDetail?.tracker || 'unknown';
    const limit = throttlerLimitDetail?.limit;
    const ttl = throttlerLimitDetail?.ttl;
    const timeToBlockExpire = throttlerLimitDetail?.timeToBlockExpire || Math.ceil((ttl || 60000) / 1000);

    this.logger.warn(
      `[THROTTLER_RATE_LIMIT_EXCEEDED] controller=${controller} handler=${handler} tracker=${tracker} limit=${limit} ttl=${ttl}ms retryAfter=${timeToBlockExpire}s path="${req.url || req.raw?.url}" method="${req.method}"`,
    );

    if (res && typeof res.header === 'function') {
      res.header('Retry-After', timeToBlockExpire);
    }

    throw new ThrottlerException(
      'Rate limit exceeded. Please wait a moment before trying again.',
    );
  }
}
