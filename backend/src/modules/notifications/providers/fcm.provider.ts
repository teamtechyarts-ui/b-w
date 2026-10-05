import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  App,
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import {
  PushMessage,
  PushProvider,
  PushSendResult,
} from './push.provider';

type Environment = Record<string, string | undefined>;

type FirebaseAdminAdapter = {
  applicationDefault: typeof applicationDefault;
  cert: typeof cert;
  getApps: typeof getApps;
  initializeApp: typeof initializeApp;
  getMessaging: typeof getMessaging;
};

export type FcmProviderOptions = {
  environment: Environment;
  firebase: FirebaseAdminAdapter;
};

export const FCM_PROVIDER_OPTIONS = Symbol('FCM_PROVIDER_OPTIONS');

const firebaseAdmin: FirebaseAdminAdapter = {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  getMessaging,
};

const invalidTokenCodes = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const transientCodes = new Set([
  'messaging/internal-error',
  'messaging/message-rate-exceeded',
  'messaging/quota-exceeded',
  'messaging/server-unavailable',
  'messaging/unknown-error',
]);

function value(environment: Environment, name: string) {
  const configured = environment[name];
  return configured?.trim() || undefined;
}

function firebaseErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return /^[a-z0-9][a-z0-9/_.-]{0,127}$/i.test(error.code)
      ? error.code
      : undefined;
  }

  return undefined;
}

function isConfiguredFirebaseCredential(val?: string): boolean {
  if (!val) return false;
  const normalized = val.trim().toLowerCase();
  return !(
    normalized.includes('placeholder') ||
    normalized.includes('replace_me') ||
    normalized.includes('change_me') ||
    normalized.includes('your_') ||
    normalized.includes('@bright-white.local')
  );
}

@Injectable()
export class FcmProvider implements PushProvider {
  private readonly messaging: Messaging | null;

  readonly configured: boolean;

  constructor(
    @Optional()
    @Inject(FCM_PROVIDER_OPTIONS)
    options?: FcmProviderOptions,
  ) {
    const environment = options?.environment ?? process.env;
    const firebase = options?.firebase ?? firebaseAdmin;
    this.messaging = this.initialize(environment, firebase);
    this.configured = this.messaging !== null;
  }

  private initialize(
    environment: Environment,
    firebase: FirebaseAdminAdapter,
  ): Messaging | null {
    const projectId =
      value(environment, 'FIREBASE_PROJECT_ID') ??
      value(environment, 'GOOGLE_CLOUD_PROJECT') ??
      value(environment, 'GCLOUD_PROJECT');
    const clientEmail = value(environment, 'FIREBASE_CLIENT_EMAIL');
    const privateKey = value(environment, 'FIREBASE_PRIVATE_KEY');
    const applicationCredentials = value(
      environment,
      'GOOGLE_APPLICATION_CREDENTIALS',
    );

    const hasServiceAccountPart = Boolean(clientEmail || privateKey);
    const hasCompleteServiceAccount = Boolean(
      projectId &&
        clientEmail &&
        privateKey &&
        isConfiguredFirebaseCredential(projectId) &&
        isConfiguredFirebaseCredential(clientEmail) &&
        isConfiguredFirebaseCredential(privateKey),
    );
    const canUseApplicationDefault = Boolean(
      projectId || applicationCredentials,
    );

    if (
      (hasServiceAccountPart && !hasCompleteServiceAccount) ||
      (!hasCompleteServiceAccount && !canUseApplicationDefault)
    ) {
      return null;
    }

    try {
      const existingDefaultApp = firebase
        .getApps()
        .find((app: App) => app.name === '[DEFAULT]');

      const app =
        existingDefaultApp ??
        firebase.initializeApp({
          credential: hasCompleteServiceAccount
            ? firebase.cert({
                projectId: projectId!,
                clientEmail: clientEmail!,
                privateKey: privateKey!.replace(/\\n/g, '\n'),
              })
            : firebase.applicationDefault(),
          ...(projectId ? { projectId } : {}),
        });

      return firebase.getMessaging(app);
    } catch {
      return null;
    }
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    if (!this.messaging) {
      return { ok: false, reason: 'unconfigured' };
    }

    if (!message.token.trim()) {
      return {
        ok: false,
        reason: 'invalid_token',
        errorCode: 'messaging/invalid-registration-token',
      };
    }

    try {
      const providerMessageId = await this.messaging.send({
        token: message.token,
        notification: {
          title: message.title,
          body: message.body,
        },
        ...(message.data ? { data: message.data } : {}),
      });

      return { ok: true, providerMessageId };
    } catch (error: unknown) {
      const errorCode = firebaseErrorCode(error);

      if (errorCode && invalidTokenCodes.has(errorCode)) {
        return { ok: false, reason: 'invalid_token', errorCode };
      }

      if (errorCode && transientCodes.has(errorCode)) {
        return { ok: false, reason: 'transient', errorCode };
      }

      return {
        ok: false,
        reason: 'provider_error',
        ...(errorCode ? { errorCode } : {}),
      };
    }
  }
}
