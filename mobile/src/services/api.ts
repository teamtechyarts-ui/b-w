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

export class ApiError extends Error {
  public readonly status: number;
  public readonly isNetworkError: boolean;
  public readonly isTimeout: boolean;
  public readonly isServerError: boolean;
  public readonly isRateLimited: boolean;
  public readonly isAuthError: boolean;
  public readonly isForbidden: boolean;
  public readonly retryAfterMs: number | null;
  public readonly requestId: string;

  constructor(message: string, options: {
    status: number;
    isNetworkError?: boolean;
    isTimeout?: boolean;
    retryAfterMs?: number | null;
    requestId?: string;
  }) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.isNetworkError = options.isNetworkError ?? (options.status === 0);
    this.isTimeout = options.isTimeout ?? false;
    this.isServerError = options.status >= 500 && options.status <= 599;
    this.isRateLimited = options.status === 429;
    this.isAuthError = options.status === 401;
    this.isForbidden = options.status === 403;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.requestId = options.requestId || '';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  accessToken?: string;
  body?: unknown;
  retryAuthentication?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
};

export const API_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS,
  requestId: string = '',
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, {...init, signal: controller.signal}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const message = init.method === 'GET'
            ? 'Request timed out. Check your connection and try again.'
            : 'Request timed out. Check your orders before retrying.';
          reject(new ApiError(message, {
            status: 0,
            isNetworkError: true,
            isTimeout: true,
            requestId,
          }));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.message.startsWith('Request timed out')) {
      throw new ApiError(error.message, {
        status: 0,
        isNetworkError: true,
        isTimeout: true,
        requestId,
      });
    }
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        (error.name === 'TypeError' ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('fetch failed') ||
          error.message.includes('NetworkError') ||
          error.message.includes('network error')))
    ) {
      throw new ApiError('Network unavailable. Check your connection and try again.', {
        status: 0,
        isNetworkError: true,
        isTimeout: false,
        requestId,
      });
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

// Privacy-safe diagnostic tracking for repeated requests
interface RequestOccurrence {
  timestamp: number;
}
const recentRequestTimes = new Map<string, RequestOccurrence[]>();

function getInitiatingCaller(): string {
  try {
    const stack = new Error().stack;
    if (!stack) return 'unknown';
    const lines = stack.split('\n');
    for (const line of lines) {
      if (
        !line.includes('api.ts') &&
        !line.includes('Error') &&
        !line.includes('node_modules') &&
        !line.includes('regeneratorRuntime')
      ) {
        const cleaned = line.trim().replace(/^at\s+/, '');
        const match = cleaned.match(/([a-zA-Z0-9_-]+\.(?:tsx|ts|jsx|js)(?::\d+(?::\d+)?)?)/);
        return match ? match[1] : cleaned.split(/[\\/]/).pop() || 'unknown';
      }
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

function recordAndCheckDiagnostics(
  method: string,
  sanitizedPath: string,
  durationMs: number,
  status: number,
  caller: string,
) {
  const key = `${method} ${sanitizedPath}`;
  const now = Date.now();
  const windowMs = 5000;
  const history = (recentRequestTimes.get(key) || []).filter(item => now - item.timestamp < windowMs);
  history.push({ timestamp: now });
  recentRequestTimes.set(key, history);

  if (history.length >= 3) {
    console.warn(
      `[API_DIAGNOSTIC] Repeated request: route="${sanitizedPath}" method="${method}" caller="${caller}" frequency=${history.length}/5s duration=${durationMs}ms status=${status}`,
    );
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
    timeoutMs = API_TIMEOUT_MS,
    maxRetries = options.maxRetries ?? 0,
  } = options;

  const caller = getInitiatingCaller();
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

  let response: Response | undefined;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
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
        timeoutMs,
        requestId,
      );

      // If we got a 502/503/504 on an idempotent GET, and we still have retry attempts remaining:
      if (
        method === 'GET' &&
        (response.status === 502 || response.status === 503 || response.status === 504) &&
        attempt < maxRetries
      ) {
        attempt += 1;
        await sleep(attempt * 400);
        continue;
      }

      // If rate limited with 429 on GET, check Retry-After
      if (method === 'GET' && response.status === 429 && attempt < maxRetries) {
        const retryAfterSec = parseInt(response.headers?.get('Retry-After') || '1', 10);
        if (Number.isFinite(retryAfterSec) && retryAfterSec <= 3) {
          attempt += 1;
          await sleep(retryAfterSec * 1000);
          continue;
        }
      }

      break;
    } catch (err: unknown) {
      lastError = err;
      // Only retry idempotent GET requests on network or timeout errors
      if (
        method === 'GET' &&
        attempt < maxRetries &&
        (err instanceof ApiError && err.isNetworkError)
      ) {
        attempt += 1;
        await sleep(attempt * 300);
        continue;
      }

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
      recordAndCheckDiagnostics(
        method,
        sanitizeRoute(path),
        Math.round(totalDuration),
        0,
        caller,
      );
      throw err;
    }
  }

  if (!response) {
    throw lastError || new ApiError('Request failed.', {status: 0, requestId});
  }

  if (
    response.status === 401 &&
    activeAccessToken &&
    retryAuthentication
  ) {
    try {
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
        timeoutMs,
        requestId,
      );
    } catch (refreshErr) {
      // If refresh failed with network or server error, throw clear error
      if (refreshErr instanceof Error && refreshErr.message.includes('check your connection')) {
        throw new ApiError(refreshErr.message, {status: 0, isNetworkError: true, requestId});
      }
      throw refreshErr;
    }
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

  recordAndCheckDiagnostics(
    method,
    sanitizeRoute(path),
    Math.round(clientDuration),
    response.status,
    caller,
  );

  const data: unknown =
    await parseResponse(response);

  if (!response.ok) {
    const fallback = getHttpStatusErrorMessage(response.status);
    const message = getApiErrorMessage(data, fallback);
    const retryAfter = response.headers?.get('Retry-After');
    const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : null;

    throw new ApiError(message, {
      status: response.status,
      retryAfterMs,
      requestId,
    });
  }

  return data as T;
}

export async function apiRequestWithRetry<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  return apiRequest<T>(path, {
    ...options,
    maxRetries: options.maxRetries ?? (options.method === undefined || options.method === 'GET' ? 2 : 0),
  });
}
