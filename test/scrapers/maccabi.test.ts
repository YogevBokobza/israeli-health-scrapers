import { describe, expect, it } from 'vitest';

import { prescriptionRowToMedication, type ScrapedPrescriptionRow } from '../../src/scrapers/maccabi.js';
import { medicationSchema } from '../../src/definitions.js';

const NOW = new Date('2026-07-26T12:00:00Z');

const standingRow: ScrapedPrescriptionRow = {
  name: 'FICTAMOL 500MG TAB (20)',
  date: '09/08/26',
  prescribedBy: 'דר ישראלי דנה, רפואת משפחה',
  isStanding: true,
};

describe('prescriptionRowToMedication', () => {
  it('produces a value matching the shared schema', () => {
    const medication = prescriptionRowToMedication(standingRow, NOW);
    expect(() => medicationSchema.parse(medication)).not.toThrow();
  });

  it('normalizes the date and derives the expiry fields', () => {
    const medication = prescriptionRowToMedication(standingRow, NOW)!;
    expect(medication.name).toBe('FICTAMOL 500MG TAB (20)');
    expect(medication.validUntil).toBe('2026-08-09');
    expect(medication.daysUntilExpiry).toBe(14);
    expect(medication.status).toBe('expiring_soon');
  });

  it('handles a two-digit year and a later expiry', () => {
    const medication = prescriptionRowToMedication(
      { ...standingRow, name: 'SAMPLEXIN 250MG CAP', date: '03/01/27' },
      NOW,
    )!;
    expect(medication.validUntil).toBe('2027-01-03');
    expect(medication.status).toBe('active');
  });

  it('marks a past deadline expired', () => {
    const medication = prescriptionRowToMedication({ ...standingRow, date: '20/01/26' }, NOW)!;
    expect(medication.status).toBe('expired');
    expect(medication.daysUntilExpiry).toBeLessThan(0);
  });

  it('drops a one-off prescription that carries no standing badge', () => {
    expect(prescriptionRowToMedication({ ...standingRow, isStanding: false }, NOW)).toBeNull();
  });

  it('drops a row with no drug name', () => {
    expect(prescriptionRowToMedication({ ...standingRow, name: null }, NOW)).toBeNull();
  });

  it('tags every row with the fund it came from', () => {
    expect(prescriptionRowToMedication(standingRow, NOW)?.provider).toBe('maccabi');
  });

  it('leaves dosage, form, lastDispensed and refillsRemaining null: this view does not expose them', () => {
    const medication = prescriptionRowToMedication(standingRow, NOW)!;
    expect(medication.dosage).toBeNull();
    expect(medication.form).toBeNull();
    expect(medication.lastDispensed).toBeNull();
    expect(medication.refillsRemaining).toBeNull();
  });
});
