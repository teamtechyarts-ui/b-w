import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import { invalidateAuthSessionsForUser } from '../../common/guards/supabase-auth.guard';

export interface StoredChallenge {
  id: string;
  userId: string;
  email: string;
  otpHash: string;
  expiresAt: string;
  resendAvailableAt: string;
  attemptCount: number;
  maxAttempts: number;
  consumed: boolean;
  grantId?: string;
  grantExpiresAt?: string;
  grantConsumed?: boolean;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private hasDbTable: boolean | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  private getHmacSecret(): string {
    return (
      this.config.get<string>('OTP_SECRET') ||
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      process.env.OTP_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      'bw-secure-default-secret-salt-2026'
    );
  }

  private hashOtp(otp: string, challengeId: string): string {
    const secret = this.getHmacSecret();
    return crypto.createHmac('sha256', secret).update(`${otp}:${challengeId}`).digest('hex');
  }

  private timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  private generateToken(userId: string, email: string, grantId: string): string {
    const secret = this.getHmacSecret();
    const payload = {
      userId,
      email,
      grantId,
      exp: Date.now() + 15 * 60 * 1000, // 15 minutes validity
    };
    const sig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url');
  }

  private verifyToken(token: string): { userId: string; email: string; grantId: string; exp: number } | null {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      const { sig, ...payload } = decoded;
      if (!sig || !payload?.userId || !payload?.grantId || !payload?.exp) return null;
      const secret = this.getHmacSecret();
      const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
      if (sig !== expectedSig) return null;
      if (payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const name = parts[0];
    const maskedName = name.length <= 2 ? `${name[0]}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
    return `${maskedName}@${parts[1]}`;
  }

  private async checkTableAvailable(): Promise<boolean> {
    if (this.hasDbTable !== null) return this.hasDbTable;
    try {
      const res = await this.supabase.admin
        .from('password_reset_challenges')
        .select('id')
        .limit(1);
      this.hasDbTable = !res.error;
    } catch {
      this.hasDbTable = false;
    }
    return this.hasDbTable;
  }

  private async saveChallenge(challenge: StoredChallenge): Promise<void> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        const { error } = await this.supabase.admin.from('password_reset_challenges').insert({
          id: challenge.id,
          user_id: challenge.userId,
          email: challenge.email,
          otp_hash: challenge.otpHash,
          purpose: 'password_reset',
          expires_at: challenge.expiresAt,
          resend_available_at: challenge.resendAvailableAt,
          attempt_count: challenge.attemptCount,
          max_attempts: challenge.maxAttempts,
          consumed: challenge.consumed,
          reset_token_hash: challenge.grantId || null,
          reset_token_expires_at: challenge.grantExpiresAt || null,
          reset_token_consumed: challenge.grantConsumed || false,
        });
        if (!error) return;
      } catch (err: any) {
        this.logger.warn(`Failed writing challenge to table: ${err.message}. Falling back to metadata.`);
      }
    }

    // High-resilience fallback: Save to auth.users app_metadata
    const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(challenge.userId);
    if (userRecord?.user) {
      const existingMeta = userRecord.user.app_metadata || {};
      await this.supabase.admin.auth.admin.updateUserById(challenge.userId, {
        app_metadata: {
          ...existingMeta,
          password_reset_challenge: challenge,
        },
      });
    }
  }

  private async updateChallenge(challenge: StoredChallenge): Promise<void> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        const { error } = await this.supabase.admin
          .from('password_reset_challenges')
          .update({
            attempt_count: challenge.attemptCount,
            consumed: challenge.consumed,
            reset_token_hash: challenge.grantId || null,
            reset_token_expires_at: challenge.grantExpiresAt || null,
            reset_token_consumed: challenge.grantConsumed || false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', challenge.id);
        if (!error) return;
      } catch (err: any) {
        this.logger.warn(`Failed updating challenge in table: ${err.message}. Updating metadata.`);
      }
    }

    const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(challenge.userId);
    if (userRecord?.user) {
      const existingMeta = userRecord.user.app_metadata || {};
      await this.supabase.admin.auth.admin.updateUserById(challenge.userId, {
        app_metadata: {
          ...existingMeta,
          password_reset_challenge: challenge,
        },
      });
    }
  }

  private async getLatestChallenge(email: string): Promise<StoredChallenge | null> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        const { data, error } = await this.supabase.admin
          .from('password_reset_challenges')
          .select('*')
          .eq('email', email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          return {
            id: data.id,
            userId: data.user_id,
            email: data.email,
            otpHash: data.otp_hash,
            expiresAt: data.expires_at,
            resendAvailableAt: data.resend_available_at,
            attemptCount: data.attempt_count,
            maxAttempts: data.max_attempts,
            consumed: data.consumed,
            grantId: data.reset_token_hash || undefined,
            grantExpiresAt: data.reset_token_expires_at || undefined,
            grantConsumed: data.reset_token_consumed || false,
          };
        }
      } catch {
        // Fall back to metadata check
      }
    }

    // Lookup through user metadata
    try {
      const { data: linkRes } = await this.supabase.admin.auth.admin.generateLink({
        type: 'recovery',
        email,
      });
      const user = linkRes?.user;
      if (user?.app_metadata?.password_reset_challenge) {
        const c = user.app_metadata.password_reset_challenge as StoredChallenge;
        if (c.email === email) {
          return c;
        }
      }
    } catch {
      // Ignore user lookup error
    }

    return null;
  }

  private async invalidateActiveChallenges(userId: string, email: string): Promise<void> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        await this.supabase.admin
          .from('password_reset_challenges')
          .update({ consumed: true, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('consumed', false);
      } catch {
        // Non-blocking
      }
    }

    try {
      const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(userId);
      if (userRecord?.user?.app_metadata?.password_reset_challenge) {
        const meta = { ...userRecord.user.app_metadata };
        delete meta.password_reset_challenge;
        await this.supabase.admin.auth.admin.updateUserById(userId, {
          app_metadata: meta,
        });
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Request an OTP for password reset.
   * Dispatches branded email via Gmail SMTP using Nodemailer.
   * Always returns a generic response to prevent account enumeration.
   */
  async requestResetOtp(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      message: 'If the account is eligible, a password-reset OTP will be sent to the registered email address.',
    };

    // 1. Check existing challenge for resend cooldown
    const existing = await this.getLatestChallenge(normalizedEmail);
    if (existing && !existing.consumed) {
      const resendAvailableTime = new Date(existing.resendAvailableAt).getTime();
      const now = Date.now();
      if (now < resendAvailableTime) {
        const remainingSeconds = Math.ceil((resendAvailableTime - now) / 1000);
        throw new BadRequestException(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        );
      }
    }

    // 2. Authoritative lookup of user by email
    let targetUser: any = null;
    try {
      const { data: linkData, error: linkErr } = await this.supabase.admin.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
      });
      if (!linkErr && linkData?.user) {
        targetUser = linkData.user;
      }
    } catch {
      // Suppress specific error to prevent account enumeration
    }

    if (!targetUser) {
      // Simulate cryptographic delay to mitigate timing analysis
      await new Promise((resolve) => setTimeout(resolve, 150));
      return genericResponse;
    }

    // 3. Verify user account is not deactivated
    try {
      const { data: profile } = await this.supabase.admin
        .from('profiles')
        .select('id, is_active')
        .eq('id', targetUser.id)
        .maybeSingle();

      if (profile && profile.is_active === false) {
        this.logger.warn(`Password reset requested for deactivated account: ${this.maskEmail(normalizedEmail)}`);
        return genericResponse;
      }
    } catch {
      // Non-fatal if profile lookup fails
    }

    // 4. Invalidate any previously active challenges
    await this.invalidateActiveChallenges(targetUser.id, normalizedEmail);

    // 5. Generate secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const challengeId = crypto.randomUUID();
    const otpHash = this.hashOtp(otp, challengeId);
    const now = Date.now();
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString(); // 10 minutes
    const resendAvailableAt = new Date(now + 60 * 1000).toISOString(); // 60s cooldown

    const challenge: StoredChallenge = {
      id: challengeId,
      userId: targetUser.id,
      email: normalizedEmail,
      otpHash,
      expiresAt,
      resendAvailableAt,
      attemptCount: 0,
      maxAttempts: 5,
      consumed: false,
    };

    await this.saveChallenge(challenge);

    // 6. Send OTP via Nodemailer & Gmail SMTP
    try {
      await this.mailService.sendPasswordResetOtp(normalizedEmail, otp);
    } catch (sendErr: any) {
      // Safely invalidate the unusable challenge
      await this.invalidateActiveChallenges(targetUser.id, normalizedEmail);
      this.logger.error(
        `Failed delivering password reset OTP to ${this.maskEmail(normalizedEmail)}: ${sendErr?.message || 'SMTP error'}`,
      );
      throw new ServiceUnavailableException(
        'Unable to deliver password reset email right now. Please verify your SMTP settings or try again later.',
      );
    }

    return genericResponse;
  }

  /**
   * Securely verify an OTP submitted by the user.
   * Returns a single-use, short-lived reset authorization token.
   */
  async verifyResetOtp(
    email: string,
    otp: string,
  ): Promise<{ resetToken: string; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Locate latest challenge
    const challenge = await this.getLatestChallenge(normalizedEmail);
    if (!challenge) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    // 2. Check if attempts were exhausted
    if (challenge.attemptCount >= challenge.maxAttempts) {
      throw new BadRequestException(
        'Too many failed attempts. Please request a new password-reset OTP.',
      );
    }

    if (challenge.consumed) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    // 3. Validate expiration
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      challenge.consumed = true;
      await this.updateChallenge(challenge);
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    // 4. Secure constant-time hash verification
    const computedHash = this.hashOtp(otp, challenge.id);
    const isMatch = this.timingSafeCompare(computedHash, challenge.otpHash);

    if (!isMatch) {
      challenge.attemptCount += 1;
      if (challenge.attemptCount >= challenge.maxAttempts) {
        challenge.consumed = true;
      }
      await this.updateChallenge(challenge);
      throw new BadRequestException('Invalid or expired OTP.');
    }

    // 5. Consume OTP challenge and issue single-use reset authorization grant
    const grantId = crypto.randomUUID();
    const grantExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    challenge.consumed = true;
    challenge.grantId = grantId;
    challenge.grantExpiresAt = grantExpiresAt;
    challenge.grantConsumed = false;
    await this.updateChallenge(challenge);

    const resetToken = this.generateToken(challenge.userId, normalizedEmail, grantId);

    return {
      resetToken,
      message: 'OTP verified successfully.',
    };
  }

  /**
   * Complete password reset using single-use authorization token.
   */
  async resetPassword(
    resetToken: string,
    newPassword?: string,
    confirmPassword?: string,
  ): Promise<{ success: boolean; message: string }> {
    const password = newPassword;

    if (!password) {
      throw new BadRequestException('Password is required.');
    }

    if (confirmPassword !== undefined && confirmPassword !== password) {
      throw new BadRequestException('Passwords do not match.');
    }

    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters long.');
    }

    // 1. Verify reset authorization token signature & expiration
    const payload = this.verifyToken(resetToken);
    if (!payload) {
      // Check if it is a legacy Supabase access token (standard 3-part JWT starting with eyJ)
      if (typeof resetToken === 'string' && resetToken.startsWith('eyJ') && resetToken.split('.').length === 3) {
        try {
          const client = this.supabase.createUserClient(resetToken);
          const { error } = await client.auth.updateUser({ password });
          if (error) {
            throw new BadRequestException(error.message || 'Unable to update password.');
          }
          return { success: true, message: 'Password has been reset successfully.' };
        } catch (err: any) {
          if (err instanceof BadRequestException) throw err;
          throw new BadRequestException('Invalid or expired password reset token.');
        }
      }
      throw new BadRequestException('Invalid or expired password reset token.');
    }

    // 2. Ensure grant has not been used (single-use enforcement)
    const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(payload.userId);
    if (!userRecord?.user) {
      throw new BadRequestException('Account not found.');
    }

    // Check challenge grant consumption
    const latestChallenge = await this.getLatestChallenge(payload.email);
    if (latestChallenge && latestChallenge.grantId === payload.grantId && latestChallenge.grantConsumed) {
      throw new BadRequestException('This reset token has already been used.');
    }

    const metaChallenge = (userRecord.user.app_metadata?.password_reset_challenge || {}) as StoredChallenge;
    if (metaChallenge.grantId === payload.grantId && metaChallenge.grantConsumed) {
      throw new BadRequestException('This reset token has already been used.');
    }

    // 3. Atomically consume the grant
    if (latestChallenge) {
      latestChallenge.grantConsumed = true;
      await this.updateChallenge(latestChallenge);
    } else {
      metaChallenge.grantConsumed = true;
      await this.updateChallenge(metaChallenge);
    }

    // 4. Update password authoritatively via Supabase Admin API
    const { error: updateErr } = await this.supabase.admin.auth.admin.updateUserById(payload.userId, {
      password,
    });

    if (updateErr) {
      this.logger.error(`Failed updating password for user ${payload.userId}: ${updateErr.message}`);
      throw new BadRequestException(updateErr.message || 'Unable to update password. Please try again.');
    }

    // 5. Invalidate all pending challenges and active in-memory auth sessions for the account
    await this.invalidateActiveChallenges(payload.userId, payload.email);
    invalidateAuthSessionsForUser(payload.userId);

    return {
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    };
  }
}
