import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_PER_HOUR, estimateCost } from '../src/lib/cost.js';

describe('estimateCost', () => {
  it('defaults to the documented AssemblyAI rate', () => {
    expect(DEFAULT_RATE_PER_HOUR).toBe(0.17);
  });

  it('bills pro rata by the hour', () => {
    expect(estimateCost(3600, 0.17)).toBeCloseTo(0.17, 10);
    expect(estimateCost(1800, 0.17)).toBeCloseTo(0.085, 10);
  });

  it('costs the fixture episode at the default rate', () => {
    // 1500s = 25 minutes.
    expect(estimateCost(1500, DEFAULT_RATE_PER_HOUR)).toBeCloseTo(0.0708333333, 8);
  });

  it('treats a null or zero duration as free', () => {
    expect(estimateCost(null, 0.17)).toBe(0);
    expect(estimateCost(0, 0.17)).toBe(0);
  });

  it('honours an overridden rate', () => {
    expect(estimateCost(3600, 0.5)).toBeCloseTo(0.5, 10);
  });
});
