const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  skipRetry?: boolean;
  skipAuth?: boolean;
  rawBody?: boolean; // for FormData
};

let getSessionToken: (() => string | null) | null = null;

export function setSessionTokenGetter(getter: () => string | null) {
  getSessionToken = getter;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      // Don't retry on client errors (4xx), only on server errors (5xx) or network issues
      if (response.ok || response.status < 500 || attempt === retries) {
        return response;
      }
      await sleep(Math.pow(2, attempt) * 500);
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(Math.pow(2, attempt) * 500);
    }
  }
  // Should not reach here, but satisfy TypeScript
  throw new Error('Request failed after retries');
}

function getAuthHeaders(): Record<string, string> {
  const token = getSessionToken?.();
  if (token) {
    return { 'Authorization': `Bearer ${token}` };
  }
  return {};
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', headers = {}, body, skipRetry, skipAuth, rawBody } = options;

  const requestHeaders: Record<string, string> = {
    ...(!rawBody ? { 'Content-Type': 'application/json' } : {}),
    ...(!skipAuth ? getAuthHeaders() : {}),
    ...headers,
  };

  const requestInit: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body !== undefined) {
    requestInit.body = rawBody ? body : JSON.stringify(body);
  }

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const response = await fetchWithRetry(url, requestInit, skipRetry ? 0 : 3);

  if (!response.ok) {
    throw new ApiError(
      `Request failed: ${response.statusText}`,
      response.status,
      response.statusText
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getFullUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
