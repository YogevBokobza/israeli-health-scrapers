import { describe, expect, it } from 'vitest';

import {
  appointmentRowToAppointment,
  prescriptionRowToMedication,
  type ScrapedAppointmentRow,
  type ScrapedPrescriptionRow,
} from '../../src/scrapers/maccabi.js';
import { appointmentSchema, medicationSchema } from '../../src/definitions.js';

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

  it('combines the date and time into an ISO instant, ignoring the "שעה" prefix', () => {
    const appointment = appointmentRowToAppointment(appointmentRow)!;
    // Israel is UTC+3 in August (DST), so 14:30 local is 11:30 UTC.
    expect(appointment.start).toBe('2026-08-09T11:30:00.000Z');
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
