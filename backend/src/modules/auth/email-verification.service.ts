import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';

export interface StoredEmailChallenge {
  id: string;
  userId: string;
  email: string;
  otpHash: string;
  purpose: 'email_verification';
  expiresAt: string;
  resendAvailableAt: string;
  attemptCount: number;
  maxAttempts: number;
  consumed: boolean;
}

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private hasDbTable: boolean | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
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
    // Cryptographically bound to email_verification purpose
    return crypto
      .createHmac('sha256', secret)
      .update(`${otp}:${challengeId}:email_verification`)
      .digest('hex');
  }

  private timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const name = parts[0];
    const maskedName =
      name.length <= 2 ? `${name[0]}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
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

  private async saveChallenge(challenge: StoredEmailChallenge): Promise<void> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        const { error } = await this.supabase.admin.from('password_reset_challenges').insert({
          id: challenge.id,
          user_id: challenge.userId,
          email: challenge.email,
          otp_hash: challenge.otpHash,
          purpose: 'email_verification',
          expires_at: challenge.expiresAt,
          resend_available_at: challenge.resendAvailableAt,
          attempt_count: challenge.attemptCount,
          max_attempts: challenge.maxAttempts,
          consumed: challenge.consumed,
        });
        if (!error) return;
      } catch (err: any) {
        this.logger.warn(`Failed writing email challenge to table: ${err.message}. Falling back to metadata.`);
      }
    }

    // High-resilience fallback: Save to auth.users app_metadata
    const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(challenge.userId);
    if (userRecord?.user) {
      const existingMeta = userRecord.user.app_metadata || {};
      await this.supabase.admin.auth.admin.updateUserById(challenge.userId, {
        app_metadata: {
          ...existingMeta,
          email_verification_challenge: challenge,
        },
      });
    }
  }

  private async updateChallenge(challenge: StoredEmailChallenge): Promise<void> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        const { error } = await this.supabase.admin
          .from('password_reset_challenges')
          .update({
            attempt_count: challenge.attemptCount,
            consumed: challenge.consumed,
            updated_at: new Date().toISOString(),
          })
          .eq('id', challenge.id);
        if (!error) return;
      } catch (err: any) {
        this.logger.warn(`Failed updating email challenge in table: ${err.message}.`);
      }
    }

    const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(challenge.userId);
    if (userRecord?.user) {
      const existingMeta = userRecord.user.app_metadata || {};
      await this.supabase.admin.auth.admin.updateUserById(challenge.userId, {
        app_metadata: {
          ...existingMeta,
          email_verification_challenge: challenge,
        },
      });
    }
  }

  private async getLatestChallenge(email: string): Promise<StoredEmailChallenge | null> {
    const useTable = await this.checkTableAvailable();
    if (useTable) {
      try {
        const { data, error } = await this.supabase.admin
          .from('password_reset_challenges')
          .select('*')
          .eq('email', email)
          .eq('purpose', 'email_verification')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          return {
            id: data.id,
            userId: data.user_id,
            email: data.email,
            otpHash: data.otp_hash,
            purpose: 'email_verification',
            expiresAt: data.expires_at,
            resendAvailableAt: data.resend_available_at,
            attemptCount: data.attempt_count,
            maxAttempts: data.max_attempts,
            consumed: data.consumed,
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
      if (user?.app_metadata?.email_verification_challenge) {
        const c = user.app_metadata.email_verification_challenge as StoredEmailChallenge;
        if (c.email === email && c.purpose === 'email_verification') {
          return c;
        }
      }
    } catch {
      // Suppress lookup errors
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
          .eq('purpose', 'email_verification')
          .eq('consumed', false);
      } catch {
        // Non-blocking
      }
    }

    try {
      const { data: userRecord } = await this.supabase.admin.auth.admin.getUserById(userId);
      if (userRecord?.user?.app_metadata?.email_verification_challenge) {
        const meta = { ...userRecord.user.app_metadata };
        delete meta.email_verification_challenge;
        await this.supabase.admin.auth.admin.updateUserById(userId, {
          app_metadata: meta,
        });
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Issue and dispatch Email Verification OTP for a registered user
   */
  async issueAndSendVerificationOtp(userId: string, email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    // Invalidate earlier codes
    await this.invalidateActiveChallenges(userId, normalizedEmail);

    const otp = crypto.randomInt(100000, 1000000).toString();
    const challengeId = crypto.randomUUID();
    const otpHash = this.hashOtp(otp, challengeId);
    const now = Date.now();
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString(); // 10 minutes
    const resendAvailableAt = new Date(now + 60 * 1000).toISOString(); // 60s cooldown

    const challenge: StoredEmailChallenge = {
      id: challengeId,
      userId,
      email: normalizedEmail,
      otpHash,
      purpose: 'email_verification',
      expiresAt,
      resendAvailableAt,
      attemptCount: 0,
      maxAttempts: 5,
      consumed: false,
    };

    await this.saveChallenge(challenge);

    try {
      await this.mailService.sendEmailVerificationOtp(normalizedEmail, otp);
    } catch (err: any) {
      await this.invalidateActiveChallenges(userId, normalizedEmail);
      this.logger.error(
        `Failed to send verification OTP to ${this.maskEmail(normalizedEmail)}: ${err.message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to deliver email verification code right now. Please try again later.',
      );
    }
  }

  /**
   * Resend verification OTP with cooldown enforcement
   */
  async resendVerificationOtp(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      message: 'If the account is pending verification, a new code has been sent.',
    };

    // Check cooldown
    const existing = await this.getLatestChallenge(normalizedEmail);
    if (existing && !existing.consumed) {
      const resendAvailableTime = new Date(existing.resendAvailableAt).getTime();
      const now = Date.now();
      if (now < resendAvailableTime) {
        const remainingSeconds = Math.ceil((resendAvailableTime - now) / 1000);
        throw new BadRequestException(
          `Please wait ${remainingSeconds} seconds before requesting a new code.`,
        );
      }
    }

    // Look up user
    let userRecord: any = null;
    try {
      const { data: linkData } = await this.supabase.admin.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
      });
      userRecord = linkData?.user;
    } catch {
      // Suppress lookup errors
    }

    if (!userRecord) {
      await new Promise((r) => setTimeout(r, 120));
      return genericResponse;
    }

    // If user is already verified, do not send verification codes
    if (userRecord.email_confirmed_at) {
      return genericResponse;
    }

    await this.issueAndSendVerificationOtp(userRecord.id, normalizedEmail);
    return genericResponse;
  }

  /**
   * Verify Email OTP
   */
  async verifyEmailOtp(
    email: string,
    otp: string,
  ): Promise<{ verified: boolean; message: string; user?: any; profile?: any }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Locate latest challenge
    const challenge = await this.getLatestChallenge(normalizedEmail);
    if (!challenge) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    if (challenge.attemptCount >= challenge.maxAttempts) {
      throw new BadRequestException(
        'Too many failed attempts. Please request a new verification code.',
      );
    }

    if (challenge.consumed) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      challenge.consumed = true;
      await this.updateChallenge(challenge);
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }

    // 2. Constant-time verification
    const computedHash = this.hashOtp(otp, challenge.id);
    const isMatch = this.timingSafeCompare(computedHash, challenge.otpHash);

    if (!isMatch) {
      challenge.attemptCount += 1;
      if (challenge.attemptCount >= challenge.maxAttempts) {
        challenge.consumed = true;
      }
      await this.updateChallenge(challenge);
      throw new BadRequestException('Invalid or expired verification code.');
    }

    // 3. Mark challenge consumed
    challenge.consumed = true;
    await this.updateChallenge(challenge);

    // 4. Mark account email confirmed authoritatively in Supabase Auth (and clear metadata challenge in single call)
    const useTable = await this.checkTableAvailable();
    const updatePayload: any = { email_confirm: true };
    if (!useTable) {
      updatePayload.app_metadata = { email_verification_challenge: null };
    }

    const { data: updateRes, error: updateErr } = await this.supabase.admin.auth.admin.updateUserById(
      challenge.userId,
      updatePayload,
    );

    if (updateErr) {
      this.logger.error(`Failed confirming email for user ${challenge.userId}: ${updateErr.message}`);
      throw new BadRequestException('Unable to confirm email. Please try again.');
    }

    // 5. Ensure profile and assign role
    const updatedUser = updateRes?.user;
    const phone = updatedUser?.user_metadata?.phone || updatedUser?.phone;
    const fullName = updatedUser?.user_metadata?.full_name;
    const profile = await this.authService.ensureProfile(challenge.userId, phone, fullName);

    // Invalidate pending table challenges if table mode is active
    if (useTable) {
      await this.invalidateActiveChallenges(challenge.userId, normalizedEmail);
    }

    return {
      verified: true,
      message: 'Email Verified Successfully',
      user: {
        id: challenge.userId,
        email: normalizedEmail,
        phone: phone || null,
      },
      profile,
    };
  }
}
