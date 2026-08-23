import { describe, expect, it } from 'vitest';

import { deriveReferenceStatus } from '../../src/helpers/ranges.js';

describe('deriveReferenceStatus', () => {
  it('places a value inside its range', () => {
    expect(deriveReferenceStatus(90, 70, 100)).toBe('within');
    expect(deriveReferenceStatus(70, 70, 100)).toBe('within');
    expect(deriveReferenceStatus(100, 70, 100)).toBe('within');
  });

  it('places a value outside its range', () => {
    expect(deriveReferenceStatus(69.9, 70, 100)).toBe('below');
    expect(deriveReferenceStatus(100.1, 70, 100)).toBe('above');
  });

  it('honours a one-sided range', () => {
    expect(deriveReferenceStatus(3, null, 5)).toBe('within');
    expect(deriveReferenceStatus(6, null, 5)).toBe('above');
    expect(deriveReferenceStatus(50, 40, null)).toBe('within');
    expect(deriveReferenceStatus(30, 40, null)).toBe('below');
  });

  it('answers unknown when there is nothing to compare against', () => {
    expect(deriveReferenceStatus(90, null, null)).toBe('unknown');
    expect(deriveReferenceStatus(null, 70, 100)).toBe('unknown');
    expect(deriveReferenceStatus(Number.NaN, 70, 100)).toBe('unknown');
  });

  it('treats zero as a measurement, not as a missing one', () => {
    expect(deriveReferenceStatus(0, 1, 5)).toBe('below');
    expect(deriveReferenceStatus(0, 0, 5)).toBe('within');
  });
});
