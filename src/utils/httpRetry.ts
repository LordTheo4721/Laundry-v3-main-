// Robust client-side workaround for transient HTTP 503 Service Unavailable errors
// caused by temporary server overload. Provides retry with exponential backoff,
// fallback handling, user-friendly messaging and graceful degradation helpers.

export const HTTP_SERVICE_UNAVAILABLE = 503;
export const SERVICE_UNAVAILABLE_MESSAGE =
  'Our servers are temporarily busy. Please try again in a moment.';
export const SERVICE_UNAVAILABLE_USER_MESSAGE =
  'Service temporarily unavailable. We are retrying automatically.';
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 100;
export const DEFAULT_BACKOFF_FACTOR = 2;
export const DEFAULT_MAX_DELAY_MS = 2000;
export const DEFAULT_JITTER = 0.2;

export interface RetryOptions {
  maxAttempts?: number;
  retries?: number;
  attempts?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  baseDelay?: number;
  initialDelayMs?: number;
  initialDelay?: number;
  maxDelayMs?: number;
  maxDelay?: number;
  factor?: number;
  backoffFactor?: number;
  multiplier?: number;
  jitter?: boolean | number;
  retryOn?: (error: unknown, attempt: number) => boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  canRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  signal?: AbortSignal;
  fallbackValue?: unknown;
}

export interface FetchRetryOptions extends RetryOptions {}

export class ServiceUnavailableError extends Error {
  status: number;
  response?: Response;
  constructor(message: string = SERVICE_UNAVAILABLE_MESSAGE, response?: Response) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.status = HTTP_SERVICE_UNAVAILABLE;
    this.response = response;
  }
}

export class HttpError extends Error {
  status: number;
  response?: Response;
  body?: string;
  constructor(status: number, message?: string, response?: Response, body?: string) {
    super(message || `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.response = response;
    this.body = body;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function isServiceUnavailable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value === HTTP_SERVICE_UNAVAILABLE;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower.includes('503') || lower.includes('service unavailable') || lower.includes('temporarily busy') || lower.includes('temporarily unavailable');
  }
  const anyVal = value as any;
  if (anyVal instanceof Response) return anyVal.status === HTTP_SERVICE_UNAVAILABLE;
  if (typeof anyVal.status === 'number') return anyVal.status === HTTP_SERVICE_UNAVAILABLE;
  if (typeof anyVal.statusCode === 'number') return anyVal.statusCode === HTTP_SERVICE_UNAVAILABLE;
  if (typeof anyVal.code === 'number') return anyVal.code === HTTP_SERVICE_UNAVAILABLE;
  const msg = String(anyVal.message || anyVal.error || anyVal.statusText || '').toLowerCase();
  if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('temporarily busy') || msg.includes('temporarily unavailable')) return true;
  if (anyVal.name === 'ServiceUnavailableError') return true;
  return false;
}

export function isRetryableError(error: unknown): boolean {
  if (isServiceUnavailable(error)) return true;
  const anyErr = error as any;
  if (anyErr instanceof TypeError) return true;
  const msg = String(anyErr?.message || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('socket hang up');
}

export function getRetryDelay(attempt: number, options: RetryOptions = {}): number {
  const base =
    options.baseDelayMs ??
    options.baseDelay ??
    options.initialDelayMs ??
    options.initialDelay ??
    DEFAULT_BASE_DELAY_MS;
  const factor =
    options.factor ?? options.backoffFactor ?? options.multiplier ?? DEFAULT_BACKOFF_FACTOR;
  const max =
    options.maxDelayMs ?? options.maxDelay ?? DEFAULT_MAX_DELAY_MS;
  const jitterOpt = options.jitter ?? DEFAULT_JITTER;
  let delay = base * Math.pow(factor, Math.max(0, attempt));
  if (jitterOpt) {
    const jitterFactor = typeof jitterOpt === 'number' ? jitterOpt : DEFAULT_JITTER;
    const jitter = (Math.random() * 2 - 1) * jitterFactor;
    delay = delay * (1 + jitter);
  }
  if (delay < 0) delay = 0;
  if (delay > max) delay = max;
  return Math.round(delay);
}

export function getMaxAttempts(options: RetryOptions = {}): number {
  const n =
    options.maxAttempts ??
    options.retries ??
    options.attempts ??
    options.maxRetries;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_MAX_ATTEMPTS;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = getMaxAttempts(options);
  const shouldRetry =
    options.shouldRetry || options.retryOn || options.canRetry || isServiceUnavailable;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt >= maxAttempts - 1;
      let retry = false;
      try {
        retry = !!shouldRetry(err, attempt);
      } catch {
        retry = isServiceUnavailable(err);
      }
      if (!retry && isRetryableError(err)) retry = true;
      if (isLast || !retry) {
        throw err;
      }
      const delay = getRetryDelay(attempt, options);
      try {
        options.onRetry?.(err, attempt + 1, delay);
      } catch {
        // ignore callback errors
      }
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}

export const retry = retryWithBackoff;
export const retryAsync = retryWithBackoff;
export const retryOperation = retryWithBackoff;
export const retryFn = retryWithBackoff;
export const withRetry = retryWithBackoff;
export const retryWithExponentialBackoff = retryWithBackoff;
export const exponentialBackoff = retryWithBackoff;

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryOptions?: RetryOptions
): Promise<Response> {
  return retryWithBackoff(async () => {
    const res = await fetch(input, init);
    if (res.status === HTTP_SERVICE_UNAVAILABLE) {
      let body = '';
      try {
        body = await res.clone().text();
      } catch {
        body = '';
      }
      throw new ServiceUnavailableError(body ? body : SERVICE_UNAVAILABLE_MESSAGE, res);
    }
    if (res.status === 502 || res.status === 504) {
      let body = '';
      try {
        body = await res.clone().text();
      } catch {
        body = '';
      }
      throw new HttpError(res.status, body || `HTTP ${res.status}`, res, body);
    }
    return res;
  }, retryOptions);
}

export const fetchRetry = fetchWithRetry;
export const resilientFetch = fetchWithRetry;
export const safeFetch = fetchWithRetry;

export async function withFallback<T>(
  fn: () => Promise<T> | T,
  fallback: T | ((error: unknown) => T | Promise<T>),
  options: RetryOptions = {}
): Promise<T> {
  try {
    return await retryWithBackoff(fn, options);
  } catch (err) {
    if (typeof fallback === 'function') {
      return await (fallback as (e: unknown) => T | Promise<T>)(err);
    }
    return fallback as T;
  }
}

export const fallback = withFallback;
export const tryWithFallback = withFallback;
export const fallbackTo = withFallback;
export const withGracefulFallback = withFallback;

export interface GracefulDegradationOptions<T> extends RetryOptions {
  cache?: boolean;
  fallbackValue?: T;
}

export class GracefulDegradation<T = unknown> {
  private cache: T | null = null;
  private hasCache = false;
  constructor(private options: GracefulDegradationOptions<T> = {}) {}

  async run(fn: () => Promise<T> | T, fallback?: T): Promise<T> {
    try {
      const value = await retryWithBackoff(fn, this.options);
      if (this.options.cache !== false) {
        this.cache = value;
        this.hasCache = true;
      }
      return value;
    } catch (err) {
      if (this.hasCache && this.cache !== null) {
        return this.cache as T;
      }
      const fb = fallback !== undefined ? fallback : this.options.fallbackValue;
      if (fb !== undefined) {
        return fb as T;
      }
      throw err;
    }
  }

  getCached(): T | null {
    return this.cache;
  }

  clearCache(): void {
    this.cache = null;
    this.hasCache = false;
  }
}

export async function gracefulDegradation<T>(
  fn: () => Promise<T> | T,
  fallback?: T,
  options: RetryOptions = {}
): Promise<T> {
  const gd = new GracefulDegradation<T>(options as GracefulDegradationOptions<T>);
  return gd.run(fn, fallback);
}

export const degradeGracefully = gracefulDegradation;

export function getUserFriendlyMessage(error: unknown): string {
  if (isServiceUnavailable(error)) return SERVICE_UNAVAILABLE_MESSAGE;
  const anyErr = error as any;
  const msg = anyErr?.message || anyErr?.error || anyErr?.statusText;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return 'Something went wrong. Please try again.';
}

export const getErrorMessage = getUserFriendlyMessage;
export const formatErrorMessage = getUserFriendlyMessage;
export const serviceUnavailableMessage = SERVICE_UNAVAILABLE_MESSAGE;

export function createServiceUnavailableResponse(retryAfterSeconds: number = 120): Response {
  return new Response(
    JSON.stringify({ success: false, error: SERVICE_UNAVAILABLE_MESSAGE }),
    {
      status: HTTP_SERVICE_UNAVAILABLE,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) },
    }
  );
}

const api = {
  HTTP_SERVICE_UNAVAILABLE,
  SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_USER_MESSAGE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_JITTER,
  ServiceUnavailableError,
  HttpError,
  sleep,
  isServiceUnavailable,
  isRetryableError,
  getRetryDelay,
  getMaxAttempts,
  retryWithBackoff,
  retry,
  retryAsync,
  retryOperation,
  retryFn,
  withRetry,
  retryWithExponentialBackoff,
  exponentialBackoff,
  fetchWithRetry,
  fetchRetry,
  resilientFetch,
  safeFetch,
  withFallback,
  fallback,
  tryWithFallback,
  fallbackTo,
  withGracefulFallback,
  GracefulDegradation,
  gracefulDegradation,
  degradeGracefully,
  getUserFriendlyMessage,
  getErrorMessage,
  formatErrorMessage,
  serviceUnavailableMessage,
  createServiceUnavailableResponse,
};

export default api;
