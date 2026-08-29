import { describe, expect, it } from 'vitest';
import { formatTimecode, parseItunesDuration } from '../src/lib/timecode.js';

describe('parseItunesDuration', () => {
  it('parses HH:MM:SS', () => {
    expect(parseItunesDuration('01:02:03')).toBe(3723);
  });

  it('parses MM:SS', () => {
    expect(parseItunesDuration('23:45')).toBe(1425);
  });

  it('parses bare seconds', () => {
    expect(parseItunesDuration('1500')).toBe(1500);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseItunesDuration('  1500  ')).toBe(1500);
  });

  it('parses a duration past 24 hours without wrapping', () => {
    expect(parseItunesDuration('25:00:00')).toBe(90000);
  });

  it('returns null for absent, blank or unparseable input', () => {
    expect(parseItunesDuration(null)).toBeNull();
    expect(parseItunesDuration(undefined)).toBeNull();
    expect(parseItunesDuration('')).toBeNull();
    expect(parseItunesDuration('   ')).toBeNull();
    expect(parseItunesDuration('not a duration')).toBeNull();
    expect(parseItunesDuration('01:02:03:04')).toBeNull();
  });
});

describe('formatTimecode', () => {
  it('uses mm:ss under one hour', () => {
    expect(formatTimecode(0)).toBe('00:00');
    expect(formatTimecode(42_000)).toBe('00:42');
    expect(formatTimecode(93_700)).toBe('01:33');
    expect(formatTimecode(1_500_000)).toBe('25:00');
  });

  it('switches to h:mm:ss at exactly one hour', () => {
    expect(formatTimecode(3_599_999)).toBe('59:59');
    expect(formatTimecode(3_600_000)).toBe('1:00:00');
    expect(formatTimecode(3_723_000)).toBe('1:02:03');
  });

  it('truncates rather than rounding up', () => {
    expect(formatTimecode(999)).toBe('00:00');
    expect(formatTimecode(59_999)).toBe('00:59');
  });

  it('handles multi-hour durations', () => {
    expect(formatTimecode(12_345_678)).toBe('3:25:45');
  });
});
