import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PasswordResetService, StoredChallenge } from './password-reset.service';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let supabaseMock: any;
  let mailServiceMock: any;
  let configMock: any;

  let userStorage: Map<string, any>;
  let challengeList: StoredChallenge[];

  const registeredUserId = 'user-uuid-1234';
  const registeredEmail = 'customer@example.com';

  beforeEach(async () => {
    userStorage = new Map();
    challengeList = [];

    userStorage.set(registeredUserId, {
      id: registeredUserId,
      email: registeredEmail,
      app_metadata: {},
    });

    supabaseMock = {
      admin: {
        from: jest.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({
                data: { id: registeredUserId, is_active: true },
                error: null,
              }),
            };
          }
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
                    purpose: 'password_reset',
                    expires_at: match.expiresAt,
                    resend_available_at: match.resendAvailableAt,
                    attempt_count: match.attemptCount,
                    max_attempts: match.maxAttempts,
                    consumed: match.consumed,
                    reset_token_hash: match.grantId,
                    reset_token_expires_at: match.grantExpiresAt,
                    reset_token_consumed: match.grantConsumed,
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
                  expiresAt: record.expires_at,
                  resendAvailableAt: record.resend_available_at,
                  attemptCount: record.attempt_count,
                  maxAttempts: record.max_attempts,
                  consumed: record.consumed,
                  grantId: record.reset_token_hash,
                  grantExpiresAt: record.reset_token_expires_at,
                  grantConsumed: record.reset_token_consumed,
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
                        if (updates.reset_token_hash !== undefined) c.grantId = updates.reset_token_hash;
                        if (updates.reset_token_expires_at !== undefined) c.grantExpiresAt = updates.reset_token_expires_at;
                        if (updates.reset_token_consumed !== undefined) c.grantConsumed = updates.reset_token_consumed;
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
              if (email === registeredEmail) {
                return {
                  data: {
                    user: userStorage.get(registeredUserId),
                  },
                  error: null,
                };
              }
              return { data: null, error: { message: 'User with this email not found' } };
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
                if (attributes.password) {
                  u.password = attributes.password;
                }
              }
              return { data: { user: u }, error: null };
            }),
          },
        },
      },
      createUserClient: jest.fn((token: string) => ({
        auth: {
          updateUser: jest.fn(async () => {
            if (token === 'forged.invalid.token' || !token.startsWith('eyJ')) {
              return { error: { message: 'Invalid JWT' } };
            }
            return { error: null };
          }),
        },
      })),
    };

    mailServiceMock = {
      sendPasswordResetOtp: jest.fn().mockResolvedValue(true),
    };

    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'OTP_SECRET') return 'test-secret-salt-key';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: MailService, useValue: mailServiceMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);
  });

  describe('requestResetOtp', () => {
    it('returns a generic response for a valid registered email and dispatches email OTP', async () => {
      const res = await service.requestResetOtp(registeredEmail);

      expect(res).toEqual({
        message: 'If the account is eligible, a password-reset OTP will be sent to the registered email address.',
      });
      expect(mailServiceMock.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
      const [emailArg, otpArg] = mailServiceMock.sendPasswordResetOtp.mock.calls[0];
      expect(emailArg).toBe(registeredEmail);
      expect(otpArg).toMatch(/^\d{6}$/);

      // Verify OTP is NOT returned in response
      expect((res as any).otp).toBeUndefined();
    });

    it('returns the same generic response for an unknown email without sending email', async () => {
      const res = await service.requestResetOtp('unknown@example.com');

      expect(res).toEqual({
        message: 'If the account is eligible, a password-reset OTP will be sent to the registered email address.',
      });
      expect(mailServiceMock.sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it('enforces a resend cooldown within 60 seconds', async () => {
      await service.requestResetOtp(registeredEmail);

      // Second request immediately after
      await expect(service.requestResetOtp(registeredEmail)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('invalidates superseded OTPs when a new OTP is requested after cooldown', async () => {
      await service.requestResetOtp(registeredEmail);
      const firstOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];

      // Simulate cooldown expiration
      for (const c of challengeList) {
        c.resendAvailableAt = new Date(Date.now() - 1000).toISOString();
      }

      await service.requestResetOtp(registeredEmail);
      const secondOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[1][1];

      // Attempting to verify the first superseded OTP must fail
      await expect(service.verifyResetOtp(registeredEmail, firstOtp)).rejects.toThrow(
        BadRequestException,
      );

      // Verifying the second OTP must succeed
      const verifyRes = await service.verifyResetOtp(registeredEmail, secondOtp);
      expect(verifyRes.resetToken).toBeDefined();
    });

    it('handles SMTP email sending failure by invalidating challenge and throwing ServiceUnavailableException', async () => {
      mailServiceMock.sendPasswordResetOtp.mockRejectedValueOnce(new Error('SMTP Connection Refused'));

      await expect(service.requestResetOtp(registeredEmail)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Challenge should be consumed/invalidated
      for (const c of challengeList) {
        expect(c.consumed).toBe(true);
      }
    });
  });

  describe('verifyResetOtp', () => {
    it('successfully verifies correct OTP and issues short-lived single-use reset token', async () => {
      await service.requestResetOtp(registeredEmail);
      const issuedOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];

      const verifyRes = await service.verifyResetOtp(registeredEmail, issuedOtp);
      expect(verifyRes.resetToken).toBeDefined();
      expect(verifyRes.message).toBe('OTP verified successfully.');
    });

    it('rejects incorrect OTP and increments attempt count', async () => {
      await service.requestResetOtp(registeredEmail);

      await expect(service.verifyResetOtp(registeredEmail, '999999')).rejects.toThrow(
        BadRequestException,
      );

      const challenge = challengeList[0];
      expect(challenge.attemptCount).toBe(1);
    });

    it('rejects verification when attempt limit is exceeded', async () => {
      await service.requestResetOtp(registeredEmail);

      for (let i = 0; i < 5; i++) {
        await expect(service.verifyResetOtp(registeredEmail, '000000')).rejects.toThrow(
          BadRequestException,
        );
      }

      // Next attempt with even correct OTP is rejected
      const correctOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];
      await expect(service.verifyResetOtp(registeredEmail, correctOtp)).rejects.toThrow(
        'Too many failed attempts. Please request a new password-reset OTP.',
      );
    });

    it('rejects expired OTP', async () => {
      await service.requestResetOtp(registeredEmail);
      const issuedOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];

      // Expire challenge
      for (const c of challengeList) {
        c.expiresAt = new Date(Date.now() - 1000).toISOString();
      }

      await expect(service.verifyResetOtp(registeredEmail, issuedOtp)).rejects.toThrow(
        'OTP has expired. Please request a new one.',
      );
    });
  });

  describe('resetPassword', () => {
    it('successfully resets password with valid token and matching passwords', async () => {
      await service.requestResetOtp(registeredEmail);
      const issuedOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];
      const { resetToken } = await service.verifyResetOtp(registeredEmail, issuedOtp);

      const res = await service.resetPassword(resetToken, 'NewSecurePass123!', 'NewSecurePass123!');
      expect(res.success).toBe(true);

      expect(supabaseMock.admin.auth.admin.updateUserById).toHaveBeenCalledWith(
        registeredUserId,
        { password: 'NewSecurePass123!' },
      );
    });

    it('rejects reset if passwords do not match', async () => {
      await service.requestResetOtp(registeredEmail);
      const issuedOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];
      const { resetToken } = await service.verifyResetOtp(registeredEmail, issuedOtp);

      await expect(
        service.resetPassword(resetToken, 'NewSecurePass123!', 'DifferentPass123!'),
      ).rejects.toThrow('Passwords do not match.');
    });

    it('rejects reset if password is shorter than 6 characters', async () => {
      await service.requestResetOtp(registeredEmail);
      const issuedOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];
      const { resetToken } = await service.verifyResetOtp(registeredEmail, issuedOtp);

      await expect(service.resetPassword(resetToken, '12345', '12345')).rejects.toThrow(
        'Password must be at least 6 characters long.',
      );
    });

    it('prevents replay of an already used reset token', async () => {
      await service.requestResetOtp(registeredEmail);
      const issuedOtp = mailServiceMock.sendPasswordResetOtp.mock.calls[0][1];
      const { resetToken } = await service.verifyResetOtp(registeredEmail, issuedOtp);

      await service.resetPassword(resetToken, 'ValidPassword123!', 'ValidPassword123!');

      // Replay attempt
      await expect(
        service.resetPassword(resetToken, 'AnotherPass123!', 'AnotherPass123!'),
      ).rejects.toThrow('This reset token has already been used.');
    });

    it('rejects tampered or forged reset token', async () => {
      await expect(
        service.resetPassword('forged.invalid.token', 'ValidPass123!', 'ValidPass123!'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
