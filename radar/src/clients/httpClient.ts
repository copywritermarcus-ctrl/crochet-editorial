import { DEFAULT_USER_AGENT } from '../config.js';

/**
 * Small text/JSON fetcher, injected wherever a stage needs a document rather
 * than a stream: the Apple podcast search in `roster sync`, and provided
 * transcript downloads in `import`.
 */
export interface HttpClient {
  getText(url: string): Promise<{ body: string; contentType: string | null }>;
  getJson<T = unknown>(url: string): Promise<T>;
}

export function createHttpClient(opts: { userAgent?: string; timeoutMs?: number } = {}): HttpClient {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function get(url: string): Promise<{ body: string; contentType: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: '*/*' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }
      return { body: await response.text(), contentType: response.headers.get('content-type') };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getText: get,
    async getJson<T>(url: string): Promise<T> {
      const { body } = await get(url);
      return JSON.parse(body) as T;
    },
  };
}
