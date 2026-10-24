import {API_BASE_URL} from '../config/environment';

import type {
  AuthSessionResponse,
  StoredSession,
} from '../types/session';

import {
  clearSecureSession,
  loadSecureSession,
  saveSecureSession,
} from './secureSessionStorage';
import {invalidateOrdersCache} from './ordersApi';
import {realtimeService} from './realtimeService';

type SessionListener = (
  session: StoredSession | null,
) => void;

const REFRESH_SKEW_MS =
  60 * 1000;

let currentSession:
  | StoredSession
  | null = null;

let hydrationPromise:
  Promise<
    StoredSession | null
  > | null = null;

let refreshPromise:
  Promise<string> | null =
    null;

const listeners =
  new Set<SessionListener>();

function notify() {
  listeners.forEach(
    listener =>
      listener(
        currentSession,
      ),
  );
}

function readString(
  value: unknown,
): string | null {
  return typeof value ===
    'string' &&
    value.length > 0
    ? value
    : null;
}

function shouldRefreshSession(
  session: StoredSession,
) {
  if (
    session.expiresAt ===
    null
  ) {
    return false;
  }

  return (
    session.expiresAt <=
    Date.now() +
      REFRESH_SKEW_MS
  );
}

export function buildStoredSession(
  response: AuthSessionResponse,
  fallback?:
    | StoredSession
    | null,
): StoredSession {
  const accessToken =
    readString(
      response.session
        ?.access_token,
    ) ??
    readString(
      response.access_token,
    );

  const refreshToken =
    readString(
      response.session
        ?.refresh_token,
    ) ??
    readString(
      response.refresh_token,
    ) ??
    fallback?.refreshToken ??
    null;

  if (
    !accessToken ||
    !refreshToken
  ) {
    throw new Error(
      'Authentication response is incomplete.',
    );
  }

  const expiresAtSeconds =
    response.session
      ?.expires_at;

  const expiresInSeconds =
    response.session
      ?.expires_in;

  const expiresAt =
    typeof expiresAtSeconds ===
    'number'
      ? expiresAtSeconds *
        1000
      : typeof expiresInSeconds ===
          'number'
        ? Date.now() +
          expiresInSeconds *
            1000
        : fallback
            ?.expiresAt ??
          null;

  return {
    version: 1,

    accessToken,
    refreshToken,
    expiresAt,

    phone:
      response.user?.phone ??
      fallback?.phone ??
      null,

    userId:
      response.user?.id ??
      fallback?.userId ??
      null,

    profile:
      response.profile ??
      fallback?.profile ??
      null,
  };
}

export function subscribeToSession(
  listener: SessionListener,
) {
  listeners.add(
    listener,
  );

  return () => {
    listeners.delete(
      listener,
    );
  };
}

export function getStoredSession() {
  return currentSession;
}

export async function persistSession(
  response: AuthSessionResponse,
) {
  const session =
    buildStoredSession(
      response,
      currentSession,
    );

  await saveSecureSession(
    session,
  );

  currentSession =
    session;

  try {
    realtimeService.setAuthToken(session.accessToken);
  } catch {
    // Non-blocking socket sync
  }

  notify();

  return session;
}

export async function updateStoredProfile(
  profile: unknown,
) {
  if (
    !currentSession
  ) {
    return;
  }

  const next:
    StoredSession = {
      ...currentSession,
      profile,
    };

  await saveSecureSession(
    next,
  );

  currentSession =
    next;

  notify();
}

export async function clearSession() {
  currentSession =
    null;

  hydrationPromise =
    null;

  refreshPromise =
    null;

  invalidateOrdersCache();

  try {
    realtimeService.disconnect();
  } catch {
    // Non-blocking socket cleanup
  }

  await clearSecureSession();

  notify();
}

export async function refreshStoredSession(): Promise<string> {
  if (
    refreshPromise
  ) {
    return refreshPromise;
  }

  refreshPromise =
    (async () => {
      // Use loadSecureSession directly if currentSession is null to prevent promise cycle/deadlock
      const session =
        currentSession ??
        (await loadSecureSession());

      if (
        !session
          ?.refreshToken
      ) {
        throw new Error(
          'Your session has expired. Please sign in again.',
        );
      }

      let response:
        Response;

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 10_000) : null;

      try {
        response =
          await fetch(
            `${API_BASE_URL}/auth/refresh`,
            {
              method:
                'POST',

              headers: {
                Accept:
                  'application/json',

                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify({
                  refreshToken:
                    session.refreshToken,
                }),
              signal: controller?.signal,
            },
          );
      } catch {
        if (timeoutId) clearTimeout(timeoutId);
        // Network unavailable or request timed out: preserve session so user is not logged out
        throw new Error(
          'Unable to refresh your session. Please check your connection.',
        );
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (
        !response.ok
      ) {
        // Only clear session on confirmed auth rejections (401, 403, or 400 invalid grant).
        // Transient 5xx server errors, gateways, or rate limits must NEVER invalidate stored session.
        if (response.status === 401 || response.status === 403 || response.status === 400) {
          await clearSession();
          throw new Error(
            'Your session has expired. Please sign in again.',
          );
        }

        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait and try again.');
        }

        throw new Error(
          'Authentication service temporarily unavailable. Please try again later.',
        );
      }

      let data:
        AuthSessionResponse;

      try {
        data =
          (await response.json()) as AuthSessionResponse;
      } catch {
        // Malformed server response / HTML error page: do not treat as auth revocation
        throw new Error(
          'Unable to process authentication response.',
        );
      }

      const refreshed =
        await persistSession(
          data,
        );

      return refreshed.accessToken;
    })().finally(
      () => {
        refreshPromise =
          null;
      },
    );

  return refreshPromise;
}

export async function hydrateSession(): Promise<
  StoredSession | null
> {
  if (
    hydrationPromise
  ) {
    return hydrationPromise;
  }

  hydrationPromise =
    (async () => {
      try {
        const stored =
          await loadSecureSession();

        currentSession =
          stored;

        notify();

        if (
          !stored
        ) {
          return null;
        }

        if (
          !shouldRefreshSession(
            stored,
          )
        ) {
          return stored;
        }

        try {
          await refreshStoredSession();

          return currentSession;
        } catch {
          /*
           * If refresh failed because
           * the refresh token was
           * rejected, clearSession()
           * already removed the
           * persisted session.
           *
           * If refresh failed only
           * because the network is
           * unavailable or server returned 5xx,
           * preserve the encrypted session so the
           * next authenticated API request can retry.
           */
          return currentSession;
        }
      } catch (err) {
        console.warn('[sessionManager] Hydration error:', err);
        currentSession = null;
        notify();
        return null;
      }
    })();

  return hydrationPromise;
}