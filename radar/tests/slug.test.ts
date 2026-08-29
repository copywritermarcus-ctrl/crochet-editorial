import { describe, expect, it } from 'vitest';
import { slugify } from '../src/lib/slug.js';

describe('slugify', () => {
  it('lowercases and collapses non-alphanumerics to single hyphens', () => {
    expect(slugify('Productization (Again)')).toBe('productization-again');
    expect(slugify('Value-Based Pricing Revisited')).toBe('value-based-pricing-revisited');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --- Hello, World! --- ')).toBe('hello-world');
  });

  it('handles punctuation-heavy real episode titles', () => {
    expect(slugify("April Dunford on Positioning: What's Actually Broken?")).toBe(
      'april-dunford-on-positioning-what-s-actually-broken',
    );
  });

  it('caps length and never leaves a trailing hyphen', () => {
    const long = 'a'.repeat(30) + ' ' + 'b'.repeat(50);
    const out = slugify(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('-')).toBe(false);
  });

  it('never returns an empty string', () => {
    expect(slugify('!!!').length).toBeGreaterThan(0);
  });
});
