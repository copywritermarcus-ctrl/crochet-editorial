import fs from 'node:fs';
import path from 'node:path';
import type { AudioClient, DownloadResult } from '../../src/clients/audioClient.js';
import type { FeedClient } from '../../src/clients/feedClient.js';
import type { HttpClient } from '../../src/clients/httpClient.js';
import type { Namer } from '../../src/clients/namer.js';
import type { Transcriber } from '../../src/clients/transcriber.js';
import { parseFeedXml } from '../../src/clients/feedClient.js';
import type { ParsedFeed, TranscribeRequest, VendorTranscript } from '../../src/types.js';

/**
 * Every fake records what it was asked for, so tests can assert on the calls
 * as well as the results. Nothing here touches the network; a fake asked for a
 * URL it was not primed with throws rather than falling back to fetch.
 */

export interface FakeFeedClient extends FeedClient {
  calls: string[];
}

/** Serves feed documents from a URL -> file map, parsed by the real parser. */
export function fakeFeedClient(map: Record<string, string>): FakeFeedClient {
  const calls: string[] = [];
  return {
    calls,
    async fetchFeed(url: string): Promise<ParsedFeed> {
      calls.push(url);
      const file = map[url];
      if (!file) throw new Error(`fakeFeedClient: no fixture primed for ${url}`);
      return parseFeedXml(fs.readFileSync(file, 'utf8'));
    },
  };
}

export interface FakeHttpClient extends HttpClient {
  calls: string[];
}

export interface FakeHttpEntry {
  body: string;
  contentType?: string | null;
  /** When set, the call rejects with this message instead of returning a body. */
  error?: string;
}

export function fakeHttpClient(map: Record<string, FakeHttpEntry>): FakeHttpClient {
  const calls: string[] = [];
  const lookup = (url: string): FakeHttpEntry => {
    calls.push(url);
    const entry = map[url];
    if (!entry) throw new Error(`fakeHttpClient: no response primed for ${url}`);
    if (entry.error) throw new Error(entry.error);
    return entry;
  };
  return {
    calls,
    async getText(url: string) {
      const entry = lookup(url);
      return { body: entry.body, contentType: entry.contentType ?? null };
    },
    async getJson<T>(url: string) {
      const entry = lookup(url);
      return JSON.parse(entry.body) as T;
    },
  };
}

export interface FakeAudioClient extends AudioClient {
  calls: Array<{ url: string; dest: string }>;
}

export interface FakeAudioOptions {
  /** URL -> bytes written. Any URL not listed uses `defaultBody`. */
  bodies?: Record<string, string>;
  defaultBody?: string;
  /** URL -> final URL after redirects, for tracking-prefix assertions. */
  redirects?: Record<string, string>;
  contentType?: string;
  /** URLs that must fail, with the message to fail with. */
  failures?: Record<string, string>;
}

export function fakeAudioClient(opts: FakeAudioOptions = {}): FakeAudioClient {
  const calls: Array<{ url: string; dest: string }> = [];
  const contentType = opts.contentType ?? 'audio/mpeg';
  return {
    calls,
    async download(url: string, destPathWithoutExt: string): Promise<DownloadResult> {
      calls.push({ url, dest: destPathWithoutExt });
      const failure = opts.failures?.[url];
      if (failure) throw new Error(failure);
      const body = opts.bodies?.[url] ?? opts.defaultBody ?? 'fake-audio-bytes';
      const dest = `${destPathWithoutExt}.mp3`;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
      return {
        path: dest,
        bytes: Buffer.byteLength(body),
        contentType,
        finalUrl: opts.redirects?.[url] ?? url,
      };
    },
  };
}

export interface FakeTranscriber extends Transcriber {
  calls: TranscribeRequest[];
}

export interface FakeTranscriberOptions {
  /** Returned for every call unless `perCall` supplies an override. */
  response?: VendorTranscript;
  /** Consumed in order; each entry is either a response or an error message. */
  perCall?: Array<VendorTranscript | { error: string }>;
}

export function fakeTranscriber(opts: FakeTranscriberOptions): FakeTranscriber {
  const calls: TranscribeRequest[] = [];
  const queue = [...(opts.perCall ?? [])];
  return {
    calls,
    async transcribe(req: TranscribeRequest): Promise<VendorTranscript> {
      calls.push(req);
      const next = queue.shift();
      if (next) {
        if ('error' in next) throw new Error(next.error);
        return next;
      }
      if (!opts.response) throw new Error('fakeTranscriber: no response primed');
      return opts.response;
    },
  };
}

export interface FakeNamer extends Namer {
  prompts: string[];
}

/**
 * Returns queued strings in order, so a test can drive the malformed-then-valid
 * retry path by queueing two. Running past the end of the queue is an error,
 * which is how "called more times than allowed" is asserted.
 */
export function fakeNamer(responses: string[]): FakeNamer {
  const prompts: string[] = [];
  const queue = [...responses];
  return {
    prompts,
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`fakeNamer: called ${prompts.length} times but only ${responses.length} responses primed`);
      }
      return next;
    },
  };
}
