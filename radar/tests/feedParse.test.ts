import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFeedXml, pickTranscript } from '../src/clients/feedClient.js';
import { fixture } from './helpers/paths.js';

const plain = () => fs.readFileSync(fixture('feeds', 'plain.xml'), 'utf8');
const withTranscript = () => fs.readFileSync(fixture('feeds', 'with-transcript.xml'), 'utf8');

describe('parseFeedXml', () => {
  it('reads the channel title and every item', async () => {
    const feed = await parseFeedXml(plain());
    expect(feed.title).toBe('2Bobs');
    expect(feed.items).toHaveLength(4);
  });

  it('captures guid, title, link and description', async () => {
    const feed = await parseFeedXml(plain());
    const item = feed.items.find((i) => i.guid === '2bobs-ep-101');
    expect(item).toBeDefined();
    expect(item!.title).toBe('Productization (Again)');
    expect(item!.pageUrl).toBe('https://2bobs.example/episodes/productization-again');
    expect(item!.description).toContain('compression of something you already do well');
  });

  it('normalises itunes:duration from HH:MM:SS, bare seconds and MM:SS', async () => {
    const feed = await parseFeedXml(plain());
    const byGuid = new Map(feed.items.map((i) => [i.guid, i]));
    expect(byGuid.get('2bobs-ep-102')!.durationSec).toBe(3723); // 01:02:03
    expect(byGuid.get('2bobs-ep-101')!.durationSec).toBe(1500); // bare seconds
    expect(byGuid.get('2bobs-ep-100')!.durationSec).toBe(1425); // 23:45
  });

  it('leaves durationSec null when the feed omits itunes:duration', async () => {
    const feed = await parseFeedXml(plain());
    const item = feed.items.find((i) => i.guid === '2bobs-ep-099');
    expect(item!.durationSec).toBeNull();
  });

  it('captures the enclosure URL verbatim, tracking prefix and all', async () => {
    const feed = await parseFeedXml(plain());
    const item = feed.items.find((i) => i.guid === '2bobs-ep-102');
    expect(item!.audioUrl).toBe(
      'https://pdst.fm/e/chtbl.com/track/ABCD12/traffic.megaphone.fm/CRO1234567890.mp3',
    );
  });

  it('parses pubDate into a Date', async () => {
    const feed = await parseFeedXml(plain());
    const item = feed.items.find((i) => i.guid === '2bobs-ep-101');
    expect(item!.publishedAt.toISOString()).toBe('2026-08-27T09:00:00.000Z');
  });

  it('returns items with no transcripts as an empty array, not null', async () => {
    const feed = await parseFeedXml(plain());
    for (const item of feed.items) expect(item.transcripts).toEqual([]);
  });

  it('captures every podcast:transcript tag with its type', async () => {
    const feed = await parseFeedXml(withTranscript());
    const item = feed.items.find((i) => i.guid === 'rare-mind-ep-041');
    expect(item!.transcripts).toHaveLength(3);
    expect(item!.transcripts.map((t) => t.type).sort()).toEqual([
      'application/json',
      'application/x-subrip',
      'text/vtt',
    ]);
  });
});

describe('pickTranscript', () => {
  it('prefers JSON over VTT over SRT regardless of document order', async () => {
    const feed = await parseFeedXml(withTranscript());
    const item = feed.items.find((i) => i.guid === 'rare-mind-ep-041');
    // The fixture lists SRT first on purpose.
    expect(item!.transcripts[0]!.type).toBe('application/x-subrip');
    const picked = pickTranscript(item!.transcripts);
    expect(picked).toEqual({
      url: 'https://transcripts.example/rare-mind/041.json',
      type: 'application/json',
    });
  });

  it('falls back to VTT when no JSON is offered', async () => {
    const feed = await parseFeedXml(withTranscript());
    const item = feed.items.find((i) => i.guid === 'rare-mind-ep-040');
    expect(pickTranscript(item!.transcripts)).toEqual({
      url: 'https://transcripts.example/rare-mind/040.vtt',
      type: 'text/vtt',
    });
  });

  it('falls back to SRT when it is the only option', () => {
    expect(
      pickTranscript([{ url: 'https://example/x.srt', type: 'application/x-subrip' }]),
    ).toEqual({ url: 'https://example/x.srt', type: 'application/x-subrip' });
  });

  it('returns null for an empty list or for types it cannot use', () => {
    expect(pickTranscript([])).toBeNull();
    expect(pickTranscript([{ url: 'https://example/x.html', type: 'text/html' }])).toBeNull();
  });
});
