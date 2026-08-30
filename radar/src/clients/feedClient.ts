import Parser from 'rss-parser';
import type { FeedItem, FeedTranscript, ParsedFeed } from '../types.js';
import { DEFAULT_USER_AGENT } from '../config.js';
import { parseItunesDuration } from '../lib/timecode.js';

export interface FeedClient {
  fetchFeed(url: string): Promise<ParsedFeed>;
}

/**
 * Preference order for provided transcripts. Document order is ignored: a feed
 * that lists SRT first still yields its JSON transcript.
 */
const TRANSCRIPT_PREFERENCE = ['application/json', 'text/vtt', 'application/x-subrip'] as const;

type CustomItem = {
  'itunes:duration'?: string;
  'podcast:transcript'?: unknown;
};

function makeParser(userAgent: string): Parser<Record<string, unknown>, CustomItem> {
  return new Parser<Record<string, unknown>, CustomItem>({
    headers: { 'User-Agent': userAgent },
    customFields: {
      item: [
        ['itunes:duration', 'itunes:duration'],
        // keepArray: a well-formed feed may offer several transcript formats.
        ['podcast:transcript', 'podcast:transcript', { keepArray: true }],
      ],
    },
  });
}

function readTranscripts(raw: unknown): FeedTranscript[] {
  if (raw === undefined || raw === null) return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const out: FeedTranscript[] = [];

  for (const entry of entries) {
    // rss-parser surfaces attributes under `$` for non-text elements.
    const attrs = (entry as { $?: Record<string, string> })?.$;
    const url = attrs?.url;
    const type = attrs?.type;
    if (typeof url === 'string' && url !== '' && typeof type === 'string' && type !== '') {
      out.push({ url, type: type.toLowerCase() });
    }
  }
  return out;
}

function toFeedItem(item: Record<string, unknown> & CustomItem): FeedItem | null {
  const guid =
    (typeof item.guid === 'string' && item.guid) ||
    (typeof item.link === 'string' && item.link) ||
    null;
  const title = typeof item.title === 'string' ? item.title : null;
  if (!guid || !title) return null;

  const isoDate = typeof item.isoDate === 'string' ? item.isoDate : null;
  const pubDate = typeof item.pubDate === 'string' ? item.pubDate : null;
  const published = isoDate ?? pubDate;
  if (!published) return null;
  const publishedAt = new Date(published);
  if (Number.isNaN(publishedAt.getTime())) return null;

  const enclosure = item.enclosure as { url?: string } | undefined;
  const description =
    (typeof item.contentSnippet === 'string' && item.contentSnippet) ||
    (typeof item.content === 'string' && item.content) ||
    (typeof item.summary === 'string' && item.summary) ||
    null;

  return {
    guid,
    title,
    description,
    publishedAt,
    durationSec: parseItunesDuration(item['itunes:duration']),
    audioUrl: typeof enclosure?.url === 'string' ? enclosure.url : null,
    pageUrl: typeof item.link === 'string' ? item.link : null,
    transcripts: readTranscripts(item['podcast:transcript']),
  };
}

/** Parses a feed document that has already been retrieved. No network. */
export async function parseFeedXml(xml: string): Promise<ParsedFeed> {
  const parsed = await makeParser(DEFAULT_USER_AGENT).parseString(xml);
  const items: FeedItem[] = [];
  for (const raw of parsed.items ?? []) {
    const item = toFeedItem(raw as Record<string, unknown> & CustomItem);
    if (item) items.push(item);
  }
  return { title: typeof parsed.title === 'string' ? parsed.title : null, items };
}

export function pickTranscript(transcripts: Array<{ url: string; type: string }>): {
  url: string;
  type: string;
} | null {
  for (const preferred of TRANSCRIPT_PREFERENCE) {
    const match = transcripts.find((t) => t.type.toLowerCase().split(';')[0]!.trim() === preferred);
    if (match) return { url: match.url, type: preferred };
  }
  return null;
}

export function createRssFeedClient(opts: { userAgent?: string } = {}): FeedClient {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const parser = makeParser(userAgent);
  return {
    async fetchFeed(url: string): Promise<ParsedFeed> {
      const parsed = await parser.parseURL(url);
      const items: FeedItem[] = [];
      for (const raw of parsed.items ?? []) {
        const item = toFeedItem(raw as Record<string, unknown> & CustomItem);
        if (item) items.push(item);
      }
      return { title: typeof parsed.title === 'string' ? parsed.title : null, items };
    },
  };
}
