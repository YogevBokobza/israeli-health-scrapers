import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';

import {
  MaccabiScraper,
  appointmentRowToAppointment,
  prescriptionRowToMedication,
  testResultRowToTestResult,
  type ScrapedAppointmentRow,
  type ScrapedPrescriptionRow,
  type ScrapedTestResultRow,
} from '../../src/scrapers/maccabi.js';
import {
  LoginResults,
  matchLoginResult,
  type LoginOptions,
} from '../../src/scrapers/base-scraper-with-browser.js';
import {
  HealthFundTypes,
  appointmentSchema,
  medicationSchema,
  testResultSchema,
} from '../../src/definitions.js';

const NOW = new Date('2026-07-26T12:00:00Z');

class TestableMaccabiScraper extends MaccabiScraper {
  loginOptions(): LoginOptions {
    return this.getLoginOptions();
  }
}

describe('Maccabi login conditions', () => {
  it('recognizes the redirected homepage URL before the SPA logout marker hydrates', async () => {
    const scraper = new TestableMaccabiScraper({ companyId: HealthFundTypes.maccabi });
    const page = {
      url: () =>
        'https://online.maccabi4u.co.il/sonline/homepage/NotificationAndUpdates/',
      locator: () => ({ count: async () => 0 }),
    } as unknown as Page;

    await expect(matchLoginResult(scraper.loginOptions().possibleResults, page)).resolves.toBe(
      LoginResults.Success,
    );
  });
});

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

const appointmentRow: ScrapedAppointmentRow = {
  date: '09/08/26',
  // Real markup prefixes the time with the word "שעה" ("hour"), not a bare HH:mm.
  time: 'שעה 14:30',
  doctorName: 'דר כהן רונית',
  specialty: 'עור | ביקור רגיל',
  // Maccabi's future-appointments list exposes no clinic/location column at all.
  clinic: null,
  instructions: [],
};

describe('appointmentRowToAppointment', () => {
  it('produces a value matching the shared schema', () => {
    const appointment = appointmentRowToAppointment(appointmentRow);
    expect(() => appointmentSchema.parse(appointment)).not.toThrow();
  });

  it('combines the date and time into Israel local time with its offset, ignoring the "שעה" prefix', () => {
    const appointment = appointmentRowToAppointment(appointmentRow)!;
    // Israel is UTC+3 in August (DST) — same wall-clock time, explicit offset attached.
    expect(appointment.start).toBe('2026-08-09T14:30:00+03:00');
  });

  it('uses the winter offset for a date outside DST', () => {
    const appointment = appointmentRowToAppointment({
      ...appointmentRow,
      date: '09/01/26',
      time: 'שעה 14:30',
    })!;
    expect(appointment.start).toBe('2026-01-09T14:30:00+02:00');
  });

  it('carries doctor and specialty through, and leaves clinic null', () => {
    const appointment = appointmentRowToAppointment(appointmentRow)!;
    expect(appointment.doctorName).toBe('דר כהן רונית');
    expect(appointment.specialty).toBe('עור | ביקור רגיל');
    expect(appointment.clinic).toBeNull();
  });

  it('derives a stable id from the same booking, and a different one for another', () => {
    const first = appointmentRowToAppointment(appointmentRow)!;
    const again = appointmentRowToAppointment({ ...appointmentRow })!;
    const other = appointmentRowToAppointment({ ...appointmentRow, time: '09:00' })!;

    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });

  it('drops a row with no parseable date or time', () => {
    expect(appointmentRowToAppointment({ ...appointmentRow, time: null })).toBeNull();
    expect(appointmentRowToAppointment({ ...appointmentRow, date: null })).toBeNull();
  });

  it('tags every row with the fund it came from', () => {
    expect(appointmentRowToAppointment(appointmentRow)?.provider).toBe('maccabi');
  });

  it('leaves raw unset when there are no instructions', () => {
    expect(appointmentRowToAppointment(appointmentRow)?.raw).toBeUndefined();
  });

  it('carries pre-visit instructions through as raw.instructions', () => {
    const instructions = ['הביקור כרוך בהשתתפות עצמית', 'תעריפים אפשר לקבל בקישור הבא'];
    const appointment = appointmentRowToAppointment({ ...appointmentRow, instructions })!;
    expect(appointment.raw).toEqual({ instructions });
  });
});

const testResultRow: ScrapedTestResultRow = {
  testName: 'קרדיולוגיה | תוצאת בדיקה לדוגמה',
  date: '20/12/24',
  timelineDate: '21/12/24',
  orderingDoctor: 'דר דוגמה רונית',
};

describe('testResultRowToTestResult', () => {
  it('produces a value matching the shared schema', () => {
    const testResult = testResultRowToTestResult(testResultRow);
    expect(() => testResultSchema.parse(testResult)).not.toThrow();
  });

  it('normalizes the date to ISO form, accepting both two- and four-digit years', () => {
    expect(testResultRowToTestResult(testResultRow)?.performedOn).toBe('2024-12-20');
    expect(testResultRowToTestResult({ ...testResultRow, date: '16/10/2024' })?.performedOn).toBe(
      '2024-10-16',
    );
  });

  it('extracts a date from the label used by the timeline', () => {
    expect(
      testResultRowToTestResult({ ...testResultRow, date: 'תאריך הבדיקה: 20/12/24' })?.performedOn,
    ).toBe('2024-12-20');
  });

  it('drops a row with no test name', () => {
    expect(testResultRowToTestResult({ ...testResultRow, testName: null })).toBeNull();
  });

  it('drops a row with an unparseable date', () => {
    expect(testResultRowToTestResult({ ...testResultRow, date: 'ממתין לתוצאות' })).toBeNull();
    expect(testResultRowToTestResult({ ...testResultRow, date: null })).toBeNull();
  });

  it('keeps a row whose only missing field is the ordering doctor', () => {
    const testResult = testResultRowToTestResult({ ...testResultRow, orderingDoctor: null })!;
    expect(testResult.orderingDoctor).toBeNull();
    expect(testResult.testName).toBe('קרדיולוגיה | תוצאת בדיקה לדוגמה');
  });

  it('tags every row with the fund it came from', () => {
    expect(testResultRowToTestResult(testResultRow)?.provider).toBe('maccabi');
  });

  it('derives a stable id from the same result, and a different one for another', () => {
    const first = testResultRowToTestResult(testResultRow)!;
    const again = testResultRowToTestResult({ ...testResultRow })!;
    const other = testResultRowToTestResult({ ...testResultRow, date: '21/12/24' })!;

    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });

  it('keeps entries with different stable timeline dates distinct', () => {
    const first = testResultRowToTestResult(testResultRow)!;
    const second = testResultRowToTestResult({ ...testResultRow, timelineDate: '22/12/24' })!;

    expect(second.id).not.toBe(first.id);
  });

  it('does not set raw because the timeline maps no extra fields', () => {
    expect(testResultRowToTestResult(testResultRow)?.raw).toBeUndefined();
  });
});
