import { notImplemented } from '../lib/notImplemented.js';

/**
 * Small text/JSON fetcher, injected wherever a stage needs a document rather
 * than a stream: the Apple podcast search in `roster sync`, and provided
 * transcript downloads in `import`.
 */
export interface HttpClient {
  getText(url: string): Promise<{ body: string; contentType: string | null }>;
  getJson<T = unknown>(url: string): Promise<T>;
}

export function createHttpClient(_opts?: { userAgent?: string }): HttpClient {
  return notImplemented('createHttpClient');
}
