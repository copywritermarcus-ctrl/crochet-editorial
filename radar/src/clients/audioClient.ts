import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_USER_AGENT } from '../config.js';

export interface DownloadResult {
  path: string;
  bytes: number;
  contentType: string | null;
  /** Final URL after redirects. Tracking prefixes are the norm, not the exception. */
  finalUrl: string;
}

export interface AudioClient {
  download(url: string, destPathWithoutExt: string): Promise<DownloadResult>;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
};

/**
 * Extension from the response content type, falling back to the extension in
 * the final URL, then to .mp3 — which is what the overwhelming majority of
 * podcast enclosures actually are.
 */
export function chooseExtension(contentType: string | null, finalUrl: string): string {
  const normalised = contentType?.split(';')[0]?.trim().toLowerCase();
  if (normalised && EXTENSION_BY_TYPE[normalised]) return EXTENSION_BY_TYPE[normalised]!;

  try {
    const ext = path.extname(new URL(finalUrl).pathname).toLowerCase();
    if (/^\.(mp3|m4a|aac|ogg|opus|wav|webm|mp4)$/.test(ext)) return ext;
  } catch {
    // Not a parseable URL; fall through to the default.
  }
  return '.mp3';
}

export function createAudioClient(opts: { userAgent?: string; timeoutMs?: number } = {}): AudioClient {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  // Generous: a two-hour episode over a slow CDN is a legitimate long download.
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;

  return {
    async download(url: string, destPathWithoutExt: string): Promise<DownloadResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': userAgent, Accept: 'audio/*,*/*' },
          redirect: 'follow',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        }

        const contentType = response.headers.get('content-type');
        const finalUrl = response.url || url;
        const dest = `${destPathWithoutExt}${chooseExtension(contentType, finalUrl)}`;
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        // Stream to a temp file first, so an aborted download never leaves a
        // truncated file that looks complete to the next run.
        const tmp = `${dest}.partial`;
        await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(tmp));
        fs.renameSync(tmp, dest);

        return { path: dest, bytes: fs.statSync(dest).size, contentType, finalUrl };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
