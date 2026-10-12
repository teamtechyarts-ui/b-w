import {API_BASE_URL} from '../config/environment';
import {
  getStoredSession,
  refreshStoredSession,
} from './sessionManager';
import {
  generateRequestId,
  parseServerTiming,
  recordRequestMetric,
  sanitizeRoute,
} from '../utils/performanceMetrics';

export {API_BASE_URL};

export function getHttpStatusErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Validation error. Please check your submission.';
    case 401:
      return 'Authentication required. Please sign in again.';
    case 403:
      return 'Insufficient permissions to perform this operation.';
    case 404:
      return 'Driver operation is not available.';
    case 409:
      return 'Conflict: record or resource already exists.';
    case 429:
      return 'Rate limit exceeded. Please wait and try again.';
    case 500:
      return 'Internal server error. Please try again.';
    case 503:
      return 'Service unavailable. Please try again later.';
    default:
      return `Request failed with status ${status}`;
  }
}

export function getApiErrorMessage(
  data: unknown,
  fallback: string,
): string {
  if (typeof data === 'string' && data.trim()) {
    if (/^Cannot (GET|POST|PATCH|PUT|DELETE)\b/i.test(data)) {
      return fallback;
    }
    return data.trim();
  }

  if (
    typeof data === 'object' &&
    data !== null
  ) {
    const obj = data as Record<string, unknown>;
    const message = obj.message;

    if (Array.isArray(message)) {
      return message
        .map(value => String(value))
        .join('\n');
    }

    if (
      typeof message === 'string' &&
      message.trim()
    ) {
      if (/^Cannot (GET|POST|PATCH|PUT|DELETE)\b/i.test(message)) {
        return fallback;
      }
      return message.trim();
    }

    if (typeof obj.error === 'string' && obj.error.trim()) {
      return obj.error.trim();
    }
  }

  return fallback;
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  accessToken?: string;
  body?: unknown;
  retryAuthentication?: boolean;
};

export const API_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, {...init, signal: controller.signal}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(init.method === 'GET'
            ? 'Request timed out. Check your connection and try again.'
            : 'Request timed out. Check your orders before retrying.'));
        }, API_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Request timed out')) throw error;
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        (error.name === 'TypeError' ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('fetch failed') ||
          error.message.includes('NetworkError') ||
          error.message.includes('network error')))
    ) {
      throw new Error('Network unavailable. Check your connection and try again.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function parseResponse(
  response: Response,
) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    accessToken,
    body,
    retryAuthentication = true,
  } = options;

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const requestId = generateRequestId();

  const activeAccessToken =
    accessToken ||
    getStoredSession()?.accessToken;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': requestId,
  };

  if (activeAccessToken) {
    headers.Authorization =
      `Bearer ${activeAccessToken}`;
  }

  if (body !== undefined) {
    headers['Content-Type'] =
      'application/json';
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}${path}`,
      {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : JSON.stringify(body),
      },
    );
  } catch (err) {
    const totalDuration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    recordRequestMetric({
      requestId,
      method,
      route: sanitizeRoute(path),
      status: 0,
      clientDurationMs: Math.round(totalDuration),
      serverDurationMs: null,
      networkDurationMs: Math.round(totalDuration),
      timestamp: new Date().toISOString(),
    });
    throw err;
  }

  if (
    response.status === 401 &&
    activeAccessToken &&
    retryAuthentication
  ) {
    const refreshedAccessToken =
      await refreshStoredSession();

    response = await fetchWithTimeout(
      `${API_BASE_URL}${path}`,
      {
        method,
        headers: {
          ...headers,
          Authorization:
            `Bearer ${refreshedAccessToken}`,
        },
        body:
          body === undefined
            ? undefined
            : JSON.stringify(body),
      },
    );
  }

  const clientDuration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
  const rawServerTiming = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('Server-Timing')
    : null;
  const serverDuration = parseServerTiming(rawServerTiming);
  const networkDuration = serverDuration !== null ? Math.max(0, clientDuration - serverDuration) : clientDuration;

  recordRequestMetric({
    requestId,
    method,
    route: sanitizeRoute(path),
    status: response.status,
    clientDurationMs: Math.round(clientDuration),
    serverDurationMs: serverDuration !== null ? Math.round(serverDuration) : null,
    networkDurationMs: Math.round(networkDuration),
    timestamp: new Date().toISOString(),
  });

  const data: unknown =
    await parseResponse(response);

  if (!response.ok) {
    const fallback = getHttpStatusErrorMessage(response.status);
    throw new Error(
      getApiErrorMessage(
        data,
        fallback,
      ),
    );
  }

  return data as T;
}
