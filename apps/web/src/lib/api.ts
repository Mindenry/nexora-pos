export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

interface Envelope<T> {
  data: T;
  meta?: ApiMeta;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly messageTh: string;
  readonly messageEn: string;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    status: number;
    messageTh: string;
    messageEn: string;
    details?: unknown;
    retryable?: boolean;
  }) {
    super(input.messageTh);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.messageTh = input.messageTh;
    this.messageEn = input.messageEn;
    this.details = input.details;
    this.retryable = input.retryable ?? false;
  }
}

const STORE_KEY = 'nexora.store_id';

export function getStoredStoreId(): string | null {
  return localStorage.getItem(STORE_KEY);
}

export function setStoredStoreId(id: string | null): void {
  if (id) localStorage.setItem(STORE_KEY, id);
  else localStorage.removeItem(STORE_KEY);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  storeId?: string | null;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: ApiMeta }> {
  const storeId = options.storeId === undefined ? getStoredStoreId() : options.storeId;
  const headers: Record<string, string> = {
    'x-nexora-client': 'web',
    ...options.headers,
  };
  if (storeId) headers['x-store-id'] = storeId;
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new ApiError({
      code: 'NETWORK',
      status: 0,
      messageTh: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
      messageEn: 'Cannot reach the server.',
      details: error instanceof Error ? error.message : undefined,
      retryable: true,
    });
  }

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('nexora:unauthorized'));
    }
    const err = payload?.error;
    throw new ApiError({
      code: err?.code ?? 'INFRA_INTERNAL',
      status: response.status,
      messageTh: err?.messageTh ?? err?.message ?? 'เกิดข้อผิดพลาด',
      messageEn: err?.messageEn ?? 'Something went wrong.',
      details: err?.details,
      retryable: err?.retryable ?? response.status >= 500,
    });
  }

  return payload as Envelope<T>;
}

export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function errorMessage(error: unknown, locale: 'th' | 'en'): string {
  if (error instanceof ApiError) return locale === 'th' ? error.messageTh : error.messageEn;
  if (error instanceof Error) return error.message;
  return locale === 'th' ? 'เกิดข้อผิดพลาด' : 'Something went wrong.';
}
