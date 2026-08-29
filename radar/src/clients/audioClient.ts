import { notImplemented } from '../lib/notImplemented.js';

export interface DownloadResult {
  path: string;
  bytes: number;
  contentType: string | null;
  /** Final URL after redirects. Tracking prefixes are the norm, not the exception. */
  finalUrl: string;
}

export interface AudioClient {
  /** Streams `url` to `destPathWithoutExt`, choosing the extension from the
   *  response content type, and returns where it landed. */
  download(url: string, destPathWithoutExt: string): Promise<DownloadResult>;
}

export function createAudioClient(_opts?: { userAgent?: string }): AudioClient {
  return notImplemented('createAudioClient');
}
