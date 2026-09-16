import axios, { AxiosError, AxiosRequestConfig } from 'axios';

const API_BASE_URL = '/api';

// Without an explicit timeout axios waits forever. During a booking rush a
// stalled request would otherwise sit open indefinitely, holding a browser
// connection slot and preventing the user's *next* action from even being
// sent - the page just appears frozen.
const REQUEST_TIMEOUT_MS = 30_000;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 400;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetryableConfig = AxiosRequestConfig & { _retryCount?: number };

/**
 * Whether a failed request is worth sending again.
 *
 * Only reads (GET/HEAD) are retried. A write must never be replayed
 * automatically: re-sending POST /slots/book after an ambiguous failure
 * could turn one booking into two, which is far worse than showing the user
 * an error they can act on.
 */
function isRetryable(error: AxiosError): boolean {
  const method = String(error.config?.method || 'get').toLowerCase();
  if (method !== 'get' && method !== 'head') return false;

  // No response at all: the network dropped, or the server was too busy to
  // accept the connection. Both are classic overload symptoms and both
  // usually succeed on a second try a moment later.
  if (!error.response) return error.code !== 'ERR_CANCELED';

  const status = error.response.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelayFor(error: AxiosError, attempt: number): number {
  // Honour an explicit Retry-After from the server (the rate limiter sends
  // one) rather than guessing.
  const retryAfter = error.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 15_000);
  }

  // Exponential backoff with jitter. The jitter matters: without it, every
  // client that was rejected by the same overload retries at the same
  // instant and recreates it.
  const backoff = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(backoff, 5_000) + Math.floor(Math.random() * 300);
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      const hadToken = Boolean(localStorage.getItem('token'));
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Previously this silently cleared the session without telling the
      // user - they'd stay on the current dashboard looking completely
      // normal, only to hit a confusing "Unauthorized" error later when
      // trying an unrelated action (e.g. background polling for
      // notifications got a 401, wiping the token, and the NEXT thing the
      // user actively clicked - like "bulk add employees" - failed with no
      // clear explanation). Now we redirect to login with a clear reason,
      // so the moment the session becomes invalid, the user immediately
      // understands why - instead of silently continuing to use a "logged
      // out" UI until some later action mysteriously fails.
      //
      // NOTE: the server deliberately no longer answers 401 when it merely
      // failed to REACH the database (it answers 503 instead, which is
      // retried below). Otherwise a few seconds of database trouble logged
      // every single user out at once - see src/middleware/auth.ts.
      if (hadToken && window.location.pathname !== '/') {
        sessionStorage.setItem('sessionExpiredMessage', 'Таны нэвтрэлтийн хугацаа дууссан байна. Дахин нэвтэрнэ үү.');
        window.location.href = '/';
      }
      return Promise.reject(error);
    }

    const config = error.config as RetryableConfig | undefined;
    if (config && isRetryable(error)) {
      const attempt = (config._retryCount || 0) + 1;
      if (attempt <= MAX_RETRIES) {
        config._retryCount = attempt;
        await new Promise((resolve) => setTimeout(resolve, retryDelayFor(error, attempt)));
        return apiClient(config);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
