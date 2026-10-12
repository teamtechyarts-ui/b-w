import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';
import { EmailVerificationService, StoredEmailChallenge } from './email-verification.service';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let supabaseMock: any;
  let mailServiceMock: any;
  let configMock: any;
  let authServiceMock: any;

  let userStorage: Map<string, any>;
  let challengeList: StoredEmailChallenge[];

  const unverifiedUserId = 'unverified-user-1234';
  const unverifiedEmail = 'newuser@example.com';

  beforeEach(async () => {
    userStorage = new Map();
    challengeList = [];

    userStorage.set(unverifiedUserId, {
      id: unverifiedUserId,
      email: unverifiedEmail,
      email_confirmed_at: null,
      app_metadata: {},
      user_metadata: {
        full_name: 'New Customer',
        phone: '+919876543210',
      },
    });

    supabaseMock = {
      admin: {
        from: jest.fn((table: string) => {
          if (table === 'password_reset_challenges') {
            const queryBuilder: any = {
              filters: [] as { field: string; val: any }[],
              select: jest.fn().mockReturnThis(),
              eq: jest.fn(function (field: string, val: any) {
                queryBuilder.filters.push({ field, val });
                return queryBuilder;
              }),
              order: jest.fn().mockReturnThis(),
              limit: jest.fn(function () {
                return queryBuilder;
              }),
              then: (resolve: any) => resolve({ data: [], error: null }),
              maybeSingle: jest.fn(async () => {
                let matches = [...challengeList].reverse();
                for (const f of queryBuilder.filters) {
                  matches = matches.filter((c: any) => {
                    if (f.field === 'email') return c.email === f.val;
                    if (f.field === 'user_id') return c.userId === f.val;
                    if (f.field === 'purpose') return c.purpose === f.val;
                    if (f.field === 'consumed') return c.consumed === f.val;
                    return true;
                  });
                }
                const match = matches[0];
                if (!match) return { data: null, error: null };
                return {
                  data: {
                    id: match.id,
                    user_id: match.userId,
                    email: match.email,
                    otp_hash: match.otpHash,
                    purpose: match.purpose,
                    expires_at: match.expiresAt,
                    resend_available_at: match.resendAvailableAt,
                    attempt_count: match.attemptCount,
                    max_attempts: match.maxAttempts,
                    consumed: match.consumed,
                  },
                  error: null,
                };
              }),
              insert: jest.fn(async (record: any) => {
                challengeList.push({
                  id: record.id,
                  userId: record.user_id,
                  email: record.email,
                  otpHash: record.otp_hash,
                  purpose: record.purpose,
                  expiresAt: record.expires_at,
                  resendAvailableAt: record.resend_available_at,
                  attemptCount: record.attempt_count,
                  maxAttempts: record.max_attempts,
                  consumed: record.consumed,
                });
                return { error: null };
              }),
              update: jest.fn((updates: any) => {
                const updateBuilder: any = {
                  filters: [] as { field: string; val: any }[],
                  eq: jest.fn(async (field: string, val: any) => {
                    for (const c of challengeList) {
                      if ((field === 'id' && c.id === val) || (field === 'user_id' && c.userId === val)) {
                        if (updates.consumed !== undefined) c.consumed = updates.consumed;
                        if (updates.attempt_count !== undefined) c.attemptCount = updates.attempt_count;
                      }
                    }
                    return { error: null };
                  }),
                };
                return updateBuilder;
              }),
            };
            return queryBuilder;
          }
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
        auth: {
          admin: {
            generateLink: jest.fn(async ({ email }: { email: string }) => {
              if (email === unverifiedEmail) {
                return {
                  data: {
                    user: userStorage.get(unverifiedUserId),
                  },
                  error: null,
                };
              }
              return { data: null, error: { message: 'User not found' } };
            }),
            getUserById: jest.fn(async (userId: string) => {
              const u = userStorage.get(userId);
              return { data: { user: u }, error: null };
            }),
            updateUserById: jest.fn(async (userId: string, attributes: any) => {
              const u = userStorage.get(userId);
              if (u) {
                if (attributes.app_metadata) {
                  u.app_metadata = { ...u.app_metadata, ...attributes.app_metadata };
                }
                if (attributes.email_confirm) {
                  u.email_confirmed_at = new Date().toISOString();
                }
              }
              return { data: { user: u }, error: null };
            }),
          },
        },
      },
    };

    mailServiceMock = {
      sendEmailVerificationOtp: jest.fn().mockResolvedValue(true),
    };

    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'OTP_SECRET') return 'test-email-otp-secret';
        return undefined;
      }),
    };

    authServiceMock = {
      ensureProfile: jest.fn().mockResolvedValue({
        id: unverifiedUserId,
        full_name: 'New Customer',
        phone: '+919876543210',
        accountRole: 'customer',
        is_active: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: MailService, useValue: mailServiceMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AuthService, useValue: authServiceMock },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
  });

  describe('issueAndSendVerificationOtp', () => {
    it('generates a 6-digit OTP and sends branded email via MailService without confirmation link', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);

      expect(mailServiceMock.sendEmailVerificationOtp).toHaveBeenCalledTimes(1);
      const [emailArg, otpArg] = mailServiceMock.sendEmailVerificationOtp.mock.calls[0];
      expect(emailArg).toBe(unverifiedEmail);
      expect(otpArg).toMatch(/^\d{6}$/);

      // Verify account remains unconfirmed
      const user = userStorage.get(unverifiedUserId);
      expect(user.email_confirmed_at).toBeNull();
    });

    it('handles email delivery failure by invalidating challenge and throwing ServiceUnavailableException', async () => {
      mailServiceMock.sendEmailVerificationOtp.mockRejectedValueOnce(new Error('SMTP Transport Error'));

      await expect(
        service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail),
      ).rejects.toThrow(ServiceUnavailableException);

      for (const c of challengeList) {
        expect(c.consumed).toBe(true);
      }
    });
  });

  describe('resendVerificationOtp', () => {
    it('enforces a 60-second cooldown on resending email verification OTP', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);

      await expect(service.resendVerificationOtp(unverifiedEmail)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('invalidates superseded OTPs when a new OTP is resent after cooldown', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);
      const firstOtp = mailServiceMock.sendEmailVerificationOtp.mock.calls[0][1];

      // Simulate cooldown expiry
      for (const c of challengeList) {
        c.resendAvailableAt = new Date(Date.now() - 1000).toISOString();
      }

      await service.resendVerificationOtp(unverifiedEmail);
      const secondOtp = mailServiceMock.sendEmailVerificationOtp.mock.calls[1][1];

      // Old superseded OTP must be rejected
      await expect(service.verifyEmailOtp(unverifiedEmail, firstOtp)).rejects.toThrow(
        BadRequestException,
      );

      // New OTP must verify
      const verifyRes = await service.verifyEmailOtp(unverifiedEmail, secondOtp);
      expect(verifyRes.verified).toBe(true);
      expect(verifyRes.message).toBe('Email Verified Successfully');
    });

    it('returns generic response for unknown email without sending email', async () => {
      const res = await service.resendVerificationOtp('unknown@example.com');
      expect(res.message).toContain('If the account is pending verification');
      expect(mailServiceMock.sendEmailVerificationOtp).not.toHaveBeenCalled();
    });

    it('does not send verification OTP if account is already confirmed', async () => {
      userStorage.get(unverifiedUserId).email_confirmed_at = new Date().toISOString();

      const res = await service.resendVerificationOtp(unverifiedEmail);
      expect(res.message).toContain('If the account is pending verification');
      expect(mailServiceMock.sendEmailVerificationOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmailOtp', () => {
    it('successfully validates correct OTP and marks email verified in Supabase Auth', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);
      const issuedOtp = mailServiceMock.sendEmailVerificationOtp.mock.calls[0][1];

      const res = await service.verifyEmailOtp(unverifiedEmail, issuedOtp);

      expect(res.verified).toBe(true);
      expect(res.message).toBe('Email Verified Successfully');

      // Verify authoritative Supabase update was invoked
      expect(supabaseMock.admin.auth.admin.updateUserById).toHaveBeenCalledWith(
        unverifiedUserId,
        { email_confirm: true },
      );
      expect(authServiceMock.ensureProfile).toHaveBeenCalledWith(
        unverifiedUserId,
        '+919876543210',
        'New Customer',
      );
    });

    it('rejects incorrect OTP and tracks failed attempts', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);

      await expect(service.verifyEmailOtp(unverifiedEmail, '000000')).rejects.toThrow(
        BadRequestException,
      );

      const challenge = challengeList[0];
      expect(challenge.attemptCount).toBe(1);
    });

    it('locks out verification when attempt limit (5) is exceeded', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);

      for (let i = 0; i < 5; i++) {
        await expect(service.verifyEmailOtp(unverifiedEmail, '000000')).rejects.toThrow(
          BadRequestException,
        );
      }

      const correctOtp = mailServiceMock.sendEmailVerificationOtp.mock.calls[0][1];
      await expect(service.verifyEmailOtp(unverifiedEmail, correctOtp)).rejects.toThrow(
        'Too many failed attempts. Please request a new verification code.',
      );
    });

    it('rejects expired verification OTP', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);
      const issuedOtp = mailServiceMock.sendEmailVerificationOtp.mock.calls[0][1];

      for (const c of challengeList) {
        c.expiresAt = new Date(Date.now() - 1000).toISOString();
      }

      await expect(service.verifyEmailOtp(unverifiedEmail, issuedOtp)).rejects.toThrow(
        'Verification code has expired. Please request a new one.',
      );
    });

    it('prevents replay of an already consumed OTP', async () => {
      await service.issueAndSendVerificationOtp(unverifiedUserId, unverifiedEmail);
      const issuedOtp = mailServiceMock.sendEmailVerificationOtp.mock.calls[0][1];

      await service.verifyEmailOtp(unverifiedEmail, issuedOtp);

      // Replay attempt
      await expect(service.verifyEmailOtp(unverifiedEmail, issuedOtp)).rejects.toThrow(
        'Invalid or expired verification code.',
      );
    });

    it('cannot use a password-reset OTP for email verification (purpose separation)', async () => {
      // Simulate a password_reset challenge in storage
      challengeList.push({
        id: 'reset-challenge-uuid',
        userId: unverifiedUserId,
        email: unverifiedEmail,
        otpHash: 'password-reset-hash',
        purpose: 'password_reset' as any,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        resendAvailableAt: new Date(Date.now() + 60 * 1000).toISOString(),
        attemptCount: 0,
        maxAttempts: 5,
        consumed: false,
      });

      await expect(service.verifyEmailOtp(unverifiedEmail, '123456')).rejects.toThrow(
        'Invalid or expired verification code.',
      );
    });
  });
});
