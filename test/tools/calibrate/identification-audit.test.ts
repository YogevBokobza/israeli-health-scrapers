import { describe, expect, it } from 'vitest';

import {
  DIGITAL_BADGE_TEXT,
  auditPastVisitsPayload,
  countDigitalBadges,
  formatIdentificationAudit,
} from '../../../tools/calibrate/identification-audit.js';

describe('countDigitalBadges', () => {
  it('counts every rendered digital badge', () => {
    const html = `<ul><li>${DIGITAL_BADGE_TEXT}</li><li>clinic</li><li>${DIGITAL_BADGE_TEXT}</li></ul>`;
    expect(countDigitalBadges(html)).toBe(2);
  });

  it('is zero when no row is badged digital', () => {
    expect(countDigitalBadges('<ul><li>clinic</li></ul>')).toBe(0);
  });
});

describe('auditPastVisitsPayload', () => {
  it('tallies codes and, given HTML, counts the digital badges', () => {
    const audit = auditPastVisitsPayload(
      [{ identification_method: 4 }, { identification_method: 1 }],
      `<li>${DIGITAL_BADGE_TEXT}</li>`,
    );
    expect(audit.tallies).toEqual([
      { code: 1, count: 1 },
      { code: 4, count: 1 },
    ]);
    expect(audit.badgeCount).toBe(1);
  });

  it('leaves badgeCount unset when no HTML was captured', () => {
    expect(auditPastVisitsPayload([{ identification_method: 4 }]).badgeCount).toBeUndefined();
  });
});

describe('formatIdentificationAudit', () => {
  it('lists the distribution and marks the code isDigital reads', () => {
    const readout = formatIdentificationAudit({
      tallies: [
        { code: 1, count: 3 },
        { code: 4, count: 2 },
      ],
    });
    expect(readout).toContain('(5 entries across the visits lobby)');
    expect(readout).toContain('code 4: 2   ← treated as isDigital');
    expect(readout).toContain('code 1: 3');
  });

  it('asks the operator to count badges by eye when no DOM was captured', () => {
    const readout = formatIdentificationAudit({ tallies: [{ code: 4, count: 2 }] });
    expect(readout).toContain(`count the "${DIGITAL_BADGE_TEXT}" rows`);
    expect(readout).toContain('compare to code 4 (2)');
  });

  it('confirms a closed set when badge count equals the digital-code count', () => {
    const readout = formatIdentificationAudit({
      tallies: [
        { code: 1, count: 5 },
        { code: 4, count: 2 },
      ],
      badgeCount: 2,
    });
    expect(readout).toContain('consistent');
    expect(readout).not.toContain('MISMATCH');
  });

  it('flags a digital visit shipping false when more rows are badged than carry the code', () => {
    const readout = formatIdentificationAudit({
      tallies: [{ code: 4, count: 2 }],
      badgeCount: 3,
    });
    expect(readout).toContain('MISMATCH');
    expect(readout).toContain('shipping isDigital: false');
  });

  it('flags an in-clinic visit shipping digital when fewer rows are badged than carry the code', () => {
    const readout = formatIdentificationAudit({
      tallies: [{ code: 4, count: 3 }],
      badgeCount: 1,
    });
    expect(readout).toContain('MISMATCH');
    expect(readout).toContain('shipping isDigital: true');
  });

  it('honors a non-default digital code', () => {
    const readout = formatIdentificationAudit({
      tallies: [{ code: 9, count: 1 }],
      badgeCount: 1,
      digitalCode: 9,
    });
    expect(readout).toContain('code 9: 1   ← treated as isDigital');
    expect(readout).toContain('consistent');
  });
});
