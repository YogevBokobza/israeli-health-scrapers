import { describe, expect, it } from 'vitest';

import {
  deriveExpiry,
  normalizeText,
  parseInteger,
  parseIsraeliDate,
} from '../../src/helpers/dates.js';

describe('normalizeText', () => {
  it('strips the bidi control characters Hebrew pages inject', () => {
    // These are invisible in a browser but break every regex and comparison.
    expect(normalizeText('‏12/08/2026‎')).toBe('12/08/2026');
  });

  it('collapses non-breaking spaces and runs of whitespace', () => {
    expect(normalizeText('  ד"ר   כהן רותי \n')).toBe('ד"ר כהן רותי');
  });
});

describe('parseIsraeliDate', () => {
  it('parses the day-first formats the funds render', () => {
    expect(parseIsraeliDate('12/08/2026')).toBe('2026-08-12');
    expect(parseIsraeliDate('3.1.2027')).toBe('2027-01-03');
    expect(parseIsraeliDate('20-04-2026')).toBe('2026-04-20');
  });

  it('reads a two-digit year as this century', () => {
    expect(parseIsraeliDate('03/07/26')).toBe('2026-07-03');
  });

  it('passes an already-ISO value through rather than re-parsing it day-first', () => {
    expect(parseIsraeliDate('2026-08-12')).toBe('2026-08-12');
  });

  it('returns null for blanks and unparseable text', () => {
    expect(parseIsraeliDate('-')).toBeNull();
    expect(parseIsraeliDate('ללא')).toBeNull();
    expect(parseIsraeliDate('')).toBeNull();
    expect(parseIsraeliDate(null)).toBeNull();
    expect(parseIsraeliDate('בקרוב')).toBeNull();
  });

  it('rejects impossible dates instead of rolling them forward', () => {
    // Date.UTC would silently turn 31/02 into March 3rd.
    expect(parseIsraeliDate('31/02/2026')).toBeNull();
    expect(parseIsraeliDate('12/13/2026')).toBeNull();
  });
});

describe('parseInteger', () => {
  it('pulls the number out of a Hebrew phrase', () => {
    expect(parseInteger('נותרו 2 ניפוקים')).toBe(2);
    expect(parseInteger('5')).toBe(5);
    expect(parseInteger('0')).toBe(0);
  });

  it('distinguishes "not stated" from zero', () => {
    expect(parseInteger('-')).toBeNull();
    expect(parseInteger('')).toBeNull();
  });
});

describe('deriveExpiry', () => {
  const now = new Date('2026-07-26T12:00:00Z');

  it('counts whole days to expiry', () => {
    expect(deriveExpiry('2026-08-12', now)).toEqual({ daysUntilExpiry: 17, status: 'expiring_soon' });
  });

  it('marks a prescription far out as active', () => {
    expect(deriveExpiry('2027-01-03', now).status).toBe('active');
  });

  it('reports a past date as expired with a negative count', () => {
    const result = deriveExpiry('2026-04-20', now);
    expect(result.status).toBe('expired');
    expect(result.daysUntilExpiry).toBeLessThan(0);
  });

  it('treats an unknown date as unknown rather than urgent', () => {
    expect(deriveExpiry(null, now)).toEqual({ daysUntilExpiry: null, status: 'unknown' });
  });

  it('is stable across the local midnight boundary', () => {
    // Compared at UTC midnight so a run late at night and one just after do not
    // disagree by a day for reasons unrelated to the prescription.
    const lateEvening = new Date('2026-07-26T23:50:00Z');
    const justAfterMidnight = new Date('2026-07-26T00:10:00Z');
    expect(deriveExpiry('2026-08-12', lateEvening)).toEqual(
      deriveExpiry('2026-08-12', justAfterMidnight),
    );
  });
});
