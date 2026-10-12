export interface RequestTimingMetric {
  requestId: string;
  method: string;
  route: string;
  status: number;
  clientDurationMs: number;
  serverDurationMs: number | null;
  networkDurationMs: number | null;
  timestamp: string;
}

const MAX_HISTORY = 50;
const metricsHistory: RequestTimingMetric[] = [];

/**
 * Generate a standard UUID v4 for request correlation
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = '0123456789abcdef';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += hex[Math.floor(Math.random() * 16)];
  }
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

/**
 * Parse Server-Timing header (e.g. "total;dur=42.5")
 */
export function parseServerTiming(header: string | null): number | null {
  if (!header) return null;
  const match = /total;dur=([\d.]+)/i.exec(header);
  if (match && match[1]) {
    const parsed = parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Sanitize route path to prevent leaking query parameters or IDs in logs
 */
export function sanitizeRoute(path: string): string {
  const [base] = path.split('?');
  // Mask UUIDs in path (e.g. /orders/1234-5678 -> /orders/:id)
  return base.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );
}

/**
 * Record and store sanitized request lifecycle metric
 */
export function recordRequestMetric(metric: RequestTimingMetric): void {
  if (metricsHistory.length >= MAX_HISTORY) {
    metricsHistory.shift();
  }
  metricsHistory.push(metric);
}

/**
 * Retrieve recent metrics history for performance reporting
 */
export function getRecentMetrics(): RequestTimingMetric[] {
  return [...metricsHistory];
}

/**
 * Clear metrics history
 */
export function clearMetrics(): void {
  metricsHistory.length = 0;
}
