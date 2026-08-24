import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';

import {
  MaccabiScraper,
  appointmentRowToAppointment,
  documentFileName,
  documentUrl,
  form17RowToRequest,
  labValueToTestResultValue,
  numericMemberId,
  prescriptionRowToMedication,
  summarizeIdentificationMethods,
  testEntryToTestResult,
  vaccinationRowToVaccination,
  visitEntryToPastVisit,
  type MaccabiLabValue,
  type MaccabiMember,
  type MaccabiTestEntry,
  type MaccabiVisitEntry,
  type ScrapedAppointmentRow,
  type ScrapedForm17Row,
  type ScrapedPrescriptionRow,
  type ScrapedVaccinationRow,
} from '../../src/scrapers/maccabi.js';
import {
  LoginResults,
  matchLoginResult,
  type LoginOptions,
} from '../../src/scrapers/base-scraper-with-browser.js';
import { SelectorDriftError, requestFailure } from '../../src/scrapers/errors.js';
import {
  HealthFundTypes,
  ScraperErrorTypes,
  form17RequestSchema,
  appointmentSchema,
  medicationSchema,
  pastVisitSchema,
  testResultSchema,
  testResultValueSchema,
  vaccinationSchema,
} from '../../src/definitions.js';

const NOW = new Date('2026-07-26T12:00:00Z');

class TestableMaccabiScraper extends MaccabiScraper {
  loginOptions(): LoginOptions {
    return this.getLoginOptions();
  }

  labValues(member: MaccabiMember, entry: MaccabiTestEntry) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).fetchLabValues(member, entry);
  }

  pastVisitEntries(member: MaccabiMember) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).fetchPastVisitEntries(member);
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

  it('flags a standing prescription with isStanding true', () => {
    expect(prescriptionRowToMedication(standingRow, NOW)?.isStanding).toBe(true);
  });

  it('keeps a one-off prescription that carries no standing badge, flagged isStanding false', () => {
    const medication = prescriptionRowToMedication({ ...standingRow, isStanding: false }, NOW)!;
    expect(medication).not.toBeNull();
    expect(medication.isStanding).toBe(false);
    expect(medication.name).toBe(standingRow.name);
  });

  it('drops a row with no drug name, standing or not', () => {
    expect(prescriptionRowToMedication({ ...standingRow, name: null }, NOW)).toBeNull();
    expect(
      prescriptionRowToMedication({ ...standingRow, name: null, isStanding: false }, NOW),
    ).toBeNull();
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

const labEntry: MaccabiTestEntry = {
  test_name: ['מעבדה'],
  test_category: [],
  doc_id: '2::lab_result::11111111::999999999::0',
  doc_type_name: 'תוצאות בדיקה',
  execute_date: '2024-12-20T08:32:00',
  result_date: '2024-12-21T14:00:00+02:00',
  category_name: 'מעבדה',
  is_partial: false,
  referrer_name: 'דר דוגמה רונית',
  request_id: '11111111',
  type: 'lab_result',
  result_files: null,
  time_stamp: '630000000000000000',
  hash: 'AbCdEfGhIjKlMnOpQrSt%3D%3D',
};

const imagingReportEntry: MaccabiTestEntry = {
  ...labEntry,
  test_name: ['U.S'],
  test_category: ['בדיקה לדוגמה'],
  doc_id: '2::imaging_result::22222222',
  category_name: 'U.S',
  request_id: '22222222',
  type: 'imaging_result',
  executing_institute: '   מכון דוגמה   ',
  result_files: [{ result_file: 'ZmFrZS1ibG9i' }],
};

describe('testEntryToTestResult', () => {
  it('produces a value matching the shared schema', () => {
    expect(() => testResultSchema.parse(testEntryToTestResult(labEntry))).not.toThrow();
    expect(() => testResultSchema.parse(testEntryToTestResult(imagingReportEntry))).not.toThrow();
  });

  it('takes the date out of the API timestamps, offset or not', () => {
    const result = testEntryToTestResult(labEntry)!;
    expect(result.performedOn).toBe('2024-12-20');
    expect(result.resultedOn).toBe('2024-12-21');
  });

  it('reads a laboratory batch as a result with values and no document', () => {
    const result = testEntryToTestResult(labEntry)!;
    expect(result.kind).toBe('lab');
    expect(result.documentAvailable).toBe(false);
    expect(result.testName).toBe('מעבדה');
    expect(result.orderingDoctor).toBe('דר דוגמה רונית');
  });

  it('reads an imaging report as a document, named category-then-procedure', () => {
    const result = testEntryToTestResult(imagingReportEntry)!;
    expect(result.kind).toBe('document');
    expect(result.documentAvailable).toBe(true);
    expect(result.testName).toBe('U.S | בדיקה לדוגמה');
    expect(result.institute).toBe('מכון דוגמה');
  });

  it('marks an imaging study as having no file, because its films live elsewhere', () => {
    const study = testEntryToTestResult({
      ...imagingReportEntry,
      doc_id: '2::imaging_study::1.2.840.99999',
      request_id: '1.2.840.99999',
      type: 'imaging_study',
      result_files: null,
    })!;

    expect(study.kind).toBe('imaging');
    expect(study.documentAvailable).toBe(false);
  });

  it('keeps an entry of an unrecognized type rather than dropping it', () => {
    const other = testEntryToTestResult({ ...labEntry, type: 'something_new' })!;
    expect(other.kind).toBe('other');
  });

  it('gives two batches on the same day for the same doctor distinct ids', () => {
    const morning = testEntryToTestResult(labEntry)!;
    const afternoon = testEntryToTestResult({ ...labEntry, request_id: '11111112' })!;

    expect(afternoon.id).not.toBe(morning.id);
    expect(testEntryToTestResult({ ...labEntry })!.id).toBe(morning.id);
  });

  it('keeps the member id out of the derived id', () => {
    expect(testEntryToTestResult(labEntry)!.id).toBe('lab_result::11111111');
  });

  it('drops an entry it could not identify or name', () => {
    expect(testEntryToTestResult({ ...labEntry, request_id: null })).toBeNull();
    expect(testEntryToTestResult({ ...labEntry, type: null })).toBeNull();
    expect(
      testEntryToTestResult({
        ...labEntry,
        test_name: [],
        test_category: [],
        category_name: null,
        doc_type_name: null,
      }),
    ).toBeNull();
  });

  it('carries the partial-results flag the fund sets on an incomplete batch', () => {
    expect(testEntryToTestResult({ ...labEntry, is_partial: true })!.isPartial).toBe(true);
    expect(testEntryToTestResult(labEntry)!.isPartial).toBe(false);
  });
});

const glucose: MaccabiLabValue = {
  test_id: '1111',
  test_desc: 'Glucose (B)',
  min_lim: 70,
  max_lim: 100,
  result: 90,
  units: 'mg/dl',
  message: '',
  is_vitek: false,
  vitek_row: [],
  message_list: [],
  lab_date: '2024-12-20T00:00:00',
};

describe('labValueToTestResultValue', () => {
  it('produces a value matching the shared schema', () => {
    expect(() =>
      testResultValueSchema.parse(labValueToTestResultValue(glucose, 'כימיה בדם')),
    ).not.toThrow();
  });

  it('keeps the measurement, its unit, its range, and the panel it came from', () => {
    const value = labValueToTestResultValue(glucose, 'כימיה בדם')!;
    expect(value).toMatchObject({
      code: '1111',
      name: 'Glucose (B)',
      group: 'כימיה בדם',
      value: 90,
      unit: 'mg/dl',
      referenceMin: 70,
      referenceMax: 100,
      status: 'within',
      measuredOn: '2024-12-20',
      text: null,
    });
  });

  it('places a measurement outside its range', () => {
    expect(labValueToTestResultValue({ ...glucose, result: 40 }, null)!.status).toBe('below');
    expect(labValueToTestResultValue({ ...glucose, result: 140 }, null)!.status).toBe('above');
  });

  it('reads a zero-to-zero range as no range at all, not as a range of zero', () => {
    const value = labValueToTestResultValue(
      { ...glucose, test_desc: 'eGFR', min_lim: 0, max_lim: 0, result: 88 },
      null,
    )!;

    expect(value.referenceMin).toBeNull();
    expect(value.referenceMax).toBeNull();
    expect(value.status).toBe('unknown');
  });

  it('keeps a genuine range that starts at zero', () => {
    const value = labValueToTestResultValue({ ...glucose, min_lim: 0, max_lim: 5, result: 7 }, null)!;
    expect(value.referenceMin).toBe(0);
    expect(value.status).toBe('above');
  });

  it('reports a qualitative result as text, not as a measurement of zero', () => {
    const value = labValueToTestResultValue(
      { ...glucose, test_desc: 'Nitrit (U)', result: 0, units: '', message: 'NEGATIVE', min_lim: 0, max_lim: 0 },
      'שתן-כללי',
    )!;

    expect(value.value).toBeNull();
    expect(value.text).toBe('NEGATIVE');
    expect(value.unit).toBeNull();
    expect(value.status).toBe('unknown');
  });

  it('keeps both when a fund annotates a real measurement', () => {
    const value = labValueToTestResultValue({ ...glucose, message: 'בוצע בשיטה חדשה' }, null)!;
    expect(value.value).toBe(90);
    expect(value.text).toBe('בוצע בשיטה חדשה');
  });

  it('keeps a culture panel verbatim, since this model has no shape for it', () => {
    const value = labValueToTestResultValue(
      { ...glucose, is_vitek: true, vitek_row: [{ antibiotic: 'דוגמה', sensitivity: 'S' }] },
      null,
    )!;

    expect(value.raw).toEqual({ vitek: [{ antibiotic: 'דוגמה', sensitivity: 'S' }] });
  });

  it('drops a value with no analyte name', () => {
    expect(labValueToTestResultValue({ ...glucose, test_desc: null }, null)).toBeNull();
  });
});

const testResultMember: MaccabiMember = {
  token: 'test-token',
  memberId: '999999999',
  memberIdCode: '0',
  gender: 'ז',
};

describe('documentUrl', () => {
  it('passes an already-encoded hash through untouched', () => {
    // Encoding it a second time is what the live endpoint answers with a 400.
    const url = documentUrl(testResultMember, imagingReportEntry)!;
    expect(url).toContain('&hash=AbCdEfGhIjKlMnOpQrSt%3D%3D');
    expect(url).not.toContain('%253D');
  });

  it('encodes a hash the fund did not encode', () => {
    const url = documentUrl(testResultMember, { ...imagingReportEntry, hash: 'a+b/c==' })!;
    expect(url).toContain('&hash=a%2Bb%2Fc%3D%3D');
  });

  it('sends the document id verbatim, separators and all', () => {
    expect(documentUrl(testResultMember, imagingReportEntry)).toContain('&data=2::imaging_result::22222222');
  });

  it('returns null when the entry carries no download authorization', () => {
    expect(documentUrl(testResultMember, { ...imagingReportEntry, hash: null })).toBeNull();
    expect(documentUrl(testResultMember, { ...imagingReportEntry, time_stamp: null })).toBeNull();
  });
});

describe('documentFileName', () => {
  it('names a file by the date and the test, safely on any filesystem', () => {
    const result = testEntryToTestResult({ ...imagingReportEntry, test_category: ['US כליות/שתן'] })!;
    // "|" and "/" are both illegal in a Windows filename, so both become "-".
    expect(documentFileName(result)).toBe('2024-12-20 U.S - US כליות-שתן.pdf');
  });

  it('says so rather than inventing a date when the fund gave none', () => {
    const result = testEntryToTestResult({ ...imagingReportEntry, execute_date: null })!;
    expect(documentFileName(result)).toContain('undated');
  });
});

describe('requestFailure', () => {
  it('drops the call log Playwright appends, which carries the bearer token', () => {
    // The real shape: message, then a call log listing the URL and every header.
    const error = new Error(
      'apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:9\n' +
        'Call log:\n' +
        '  - → GET https://example.test/openfile?memberid=111111111&hash=abc\n' +
        '    - authorization: Bearer fictional.jwt.value\n',
    );

    const sanitized = requestFailure('a result document', error);

    expect(sanitized.message).toBe(
      'a result document failed: apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:9',
    );
    expect(sanitized.message).not.toContain('fictional.jwt.value');
    expect(sanitized.message).not.toContain('111111111');
    expect(sanitized.message).not.toContain('Call log');
  });

  it('redacts a token that appears on the first line too', () => {
    const sanitized = requestFailure('a lab result', new Error('401 for Bearer fictional.jwt.value'));

    expect(sanitized.message).toContain('Bearer <redacted>');
    expect(sanitized.message).not.toContain('fictional.jwt.value');
  });

  it('keeps a timeout recognizable as a timeout', () => {
    expect(requestFailure('x', new Error('Request timeout of 30000ms exceeded')).errorType).toBe(
      ScraperErrorTypes.Timeout,
    );
    expect(requestFailure('x', new Error('connect ECONNREFUSED')).errorType).toBe(
      ScraperErrorTypes.Generic,
    );
  });
});

/**
 * fetchLabValues is the one function whose return value is wired to a DELETE in the
 * consumer: an empty array means "the fund reported no values, drop what you had",
 * while null means "not read, keep what you had". Getting that distinction wrong
 * destroys a member's stored history, so it is exercised against fake responses.
 */
describe('fetchLabValues', () => {
  function scraperReturning(response: unknown) {
    const scraper = new TestableMaccabiScraper({ companyId: HealthFundTypes.maccabi });
    const post = async () => {
      if (response instanceof Error) throw response;
      return response;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).page = { request: { post, get: post } };
    return scraper;
  }

  function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
    return {
      ok: () => ok,
      status: () => status,
      headers: () => ({ 'content-type': 'application/json' }),
      json: async () => body,
    };
  }

  const member: MaccabiMember = {
    token: 'fictional.jwt.value',
    memberId: '999999999',
    memberIdCode: '0',
    gender: 'ז',
  };

  it('maps the groups the fund returns', async () => {
    const scraper = scraperReturning(
      jsonResponse({
        results: [
          {
            group_name: 'כימיה בדיונית',
            group_values: [
              { test_id: '1111', test_desc: 'Fictium (B)', min_lim: 10, max_lim: 50, result: 42, units: 'mg/dl' },
            ],
          },
        ],
      }),
    );

    await expect(scraper.labValues(member, labEntry)).resolves.toEqual([
      expect.objectContaining({ name: 'Fictium (B)', value: 42, status: 'within' }),
    ]);
  });

  it('reports an empty list only when the fund actually returned no groups', async () => {
    const scraper = scraperReturning(jsonResponse({ results: [] }));
    await expect(scraper.labValues(member, labEntry)).resolves.toEqual([]);
  });

  it('reports "not read" — never an empty list — for a 200 it cannot make sense of', async () => {
    // Each of these would otherwise become `[]`, which the store treats as "the fund
    // withdrew these measurements" and deletes every stored value for the batch.
    for (const body of [{}, { results: null }, { result_groups: [] }, { data: { results: [] } }, 'nope']) {
      const scraper = scraperReturning(jsonResponse(body));
      await expect(scraper.labValues(member, labEntry)).resolves.toBeNull();
    }
  });

  it('reports "not read" for a non-JSON body and for a refused request', async () => {
    const notJson = {
      ok: () => true,
      status: () => 200,
      headers: () => ({ 'content-type': 'text/html' }),
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    };
    await expect(scraperReturning(notJson).labValues(member, labEntry)).resolves.toBeNull();

    await expect(
      scraperReturning(jsonResponse({}, { ok: false, status: 500 })).labValues(member, labEntry),
    ).resolves.toBeNull();
  });

  it('skips one unreachable batch instead of failing the whole fetch', async () => {
    const scraper = scraperReturning(new Error('apiRequestContext.post: connect ECONNREFUSED'));
    await expect(scraper.labValues(member, labEntry)).resolves.toBeNull();
  });
});

const clinicVisitEntry: MaccabiVisitEntry = {
  appointment_id: '710020001',
  appointment_date: '2026-07-14T09:30:00',
  service_name: 'רפואת משפחה',
  service_provider_name: 'שרונה לב-ארי',
  service_provider_title: 'דר',
  has_summery_file: true,
  identification_method: 1,
  facility_id: '40120001',
};

describe('visitEntryToPastVisit', () => {
  it('produces a value matching the shared schema', () => {
    expect(() => pastVisitSchema.parse(visitEntryToPastVisit(clinicVisitEntry))).not.toThrow();
  });

  it('carries the fund-native id and maps the visit fields', () => {
    expect(visitEntryToPastVisit(clinicVisitEntry)).toMatchObject({
      id: '710020001',
      visitedAt: '2026-07-14T09:30:00+03:00',
      doctorName: 'דר שרונה לב-ארי',
      specialty: 'רפואת משפחה',
      isDigital: false,
      summaryAvailable: true,
      provider: HealthFundTypes.maccabi,
    });
  });

  it('drops seconds from the visit time, as the appointments model does', () => {
    expect(
      visitEntryToPastVisit({ ...clinicVisitEntry, appointment_date: '2026-07-14T09:30:41' })
        ?.visitedAt,
    ).toBe('2026-07-14T09:30:00+03:00');
  });

  it('keeps Israel wall-clock across DST: winter +02:00, summer +03:00', () => {
    expect(
      visitEntryToPastVisit({ ...clinicVisitEntry, appointment_date: '2026-01-11T08:15:00' })
        ?.visitedAt,
    ).toBe('2026-01-11T08:15:00+02:00');
  });

  it('flags a digital visit and keeps the fund code it was derived from', () => {
    const visit = visitEntryToPastVisit({ ...clinicVisitEntry, identification_method: 4 })!;
    expect(visit.isDigital).toBe(true);
    expect(visit.raw).toEqual({ identificationMethod: 4, facilityId: '40120001' });
  });

  it('keeps the opaque facility id in raw — the only location datum the list carries', () => {
    const withFacility = visitEntryToPastVisit(clinicVisitEntry)!;
    expect(withFacility.raw).toEqual({ identificationMethod: 1, facilityId: '40120001' });
    const withoutFacility = visitEntryToPastVisit({
      ...clinicVisitEntry,
      facility_id: null,
    })!;
    expect(withoutFacility.raw).toEqual({ identificationMethod: 1 });
    const withNothing = visitEntryToPastVisit({
      ...clinicVisitEntry,
      facility_id: null,
      identification_method: null,
    })!;
    expect(withNothing.raw).toBeUndefined();
  });

  it('reads summary availability from the fund-typo field, absent meaning no', () => {
    expect(
      visitEntryToPastVisit({ ...clinicVisitEntry, has_summery_file: false })?.summaryAvailable,
    ).toBe(false);
    expect(
      visitEntryToPastVisit({ ...clinicVisitEntry, has_summery_file: null })?.summaryAvailable,
    ).toBe(false);
  });

  it('drops an entry the fund gives no appointment id', () => {
    expect(visitEntryToPastVisit({ ...clinicVisitEntry, appointment_id: null })).toBeNull();
    expect(visitEntryToPastVisit({ ...clinicVisitEntry, appointment_id: '' })).toBeNull();
  });

  it('keeps a visit the fund gives no date for, with a null one', () => {
    const visit = visitEntryToPastVisit({ ...clinicVisitEntry, appointment_date: null })!;
    expect(visit.id).toBe('710020001');
    expect(visit.visitedAt).toBeNull();
  });

  it('reports a doctor without a title as a bare name, and no doctor as null', () => {
    const untitled = visitEntryToPastVisit({ ...clinicVisitEntry, service_provider_title: null });
    expect(untitled?.doctorName).toBe('שרונה לב-ארי');
    const nameless = visitEntryToPastVisit({
      ...clinicVisitEntry,
      service_provider_name: null,
      service_provider_title: null,
    })!;
    expect(nameless.doctorName).toBeNull();
    expect(nameless.id).toBe('710020001');
  });

  it('strips bidi control characters and collapsed whitespace from names', () => {
    const visit = visitEntryToPastVisit({
      ...clinicVisitEntry,
      service_provider_name: '‏שרונה  לב-ארי ',
      service_name: ' רפואת משפחה ',
    })!;
    expect(visit.doctorName).toBe('דר שרונה לב-ארי');
    expect(visit.specialty).toBe('רפואת משפחה');
  });
});

describe('summarizeIdentificationMethods', () => {
  it('tallies distinct codes, most common first', () => {
    expect(
      summarizeIdentificationMethods([
        { identification_method: 1 },
        { identification_method: 4 },
        { identification_method: 1 },
        { identification_method: 1 },
        { identification_method: 4 },
      ]),
    ).toEqual([
      { code: 1, count: 3 },
      { code: 4, count: 2 },
    ]);
  });

  it('breaks a count tie by code, ascending', () => {
    expect(
      summarizeIdentificationMethods([
        { identification_method: 7 },
        { identification_method: 2 },
      ]),
    ).toEqual([
      { code: 2, count: 1 },
      { code: 7, count: 1 },
    ]);
  });

  it('buckets an entry with no code as null and sorts it last', () => {
    expect(
      summarizeIdentificationMethods([
        { identification_method: null },
        { identification_method: 4 },
        {},
        { identification_method: 4 },
      ]),
    ).toEqual([
      { code: 4, count: 2 },
      { code: null, count: 2 },
    ]);
  });

  it('is empty for an empty lobby', () => {
    expect(summarizeIdentificationMethods([])).toEqual([]);
  });
});

describe('numericMemberId', () => {
  it('returns the number for a canonical all-digits id', () => {
    expect(numericMemberId('999999999')).toBe(999999999);
    expect(numericMemberId('7')).toBe(7);
  });

  it('rejects a non-numeric id rather than coercing it to NaN', () => {
    // Number('12a') is NaN, which JSON.stringify would then write out as `null`.
    for (const bad of ['12a', '', ' 12', '12 ', '1.5', 'NaN', '-7', '1e3']) {
      expect(numericMemberId(bad)).toBeNull();
    }
  });

  it('rejects a leading-zero id rather than dropping the zero', () => {
    // Number('007') is 7 — a different, wrong member — so this must not slip through.
    expect(numericMemberId('007')).toBeNull();
    expect(numericMemberId('0')).toBeNull();
  });
});

/**
 * The visit-history body is the one place a member id is sent as a JSON number instead
 * of the string every other call site uses. The guard makes a malformed id fail here,
 * loudly, instead of going out as a `null` member the API answers with an opaque 400.
 */
describe('fetchPastVisitEntries member id guard', () => {
  function scraperRecording(response: unknown) {
    const scraper = new TestableMaccabiScraper({ companyId: HealthFundTypes.maccabi });
    const calls: Array<{ url: string; data: unknown }> = [];
    const post = async (url: string, opts: { data: unknown }) => {
      calls.push({ url, data: opts.data });
      if (response instanceof Error) throw response;
      return response;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).page = { request: { post } };
    return { scraper, calls };
  }

  function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
    return {
      ok: () => ok,
      status: () => status,
      headers: () => ({ 'content-type': 'application/json' }),
      json: async () => body,
    };
  }

  const member: MaccabiMember = {
    token: 'fictional.jwt.value',
    memberId: '999999999',
    memberIdCode: '0',
    gender: 'ז',
  };

  it('sends the member id as a JSON number when it is canonical', async () => {
    const { scraper, calls } = scraperRecording(jsonResponse({ results: [clinicVisitEntry] }));

    await expect(scraper.pastVisitEntries(member)).resolves.toEqual([clinicVisitEntry]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toEqual({
      members: [{ member_id_code: '0', member_id: 999999999 }],
    });
  });

  it('fails loudly on a non-numeric id and never sends the request', async () => {
    const { scraper, calls } = scraperRecording(jsonResponse({ results: [] }));

    await expect(scraper.pastVisitEntries({ ...member, memberId: '12a' })).rejects.toMatchObject({
      errorType: ScraperErrorTypes.SelectorDrift,
    });
    await expect(scraper.pastVisitEntries({ ...member, memberId: '12a' })).rejects.toBeInstanceOf(
      SelectorDriftError,
    );
    expect(calls).toHaveLength(0);
  });

  it('fails loudly on a leading-zero id rather than sending a different member', async () => {
    const { scraper, calls } = scraperRecording(jsonResponse({ results: [] }));

    await expect(scraper.pastVisitEntries({ ...member, memberId: '007' })).rejects.toBeInstanceOf(
      SelectorDriftError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('vaccinationRowToVaccination', () => {
  const vaccinationRow: ScrapedVaccinationRow = {
    vaccineName: 'חיסון דוגמה',
    administeredOn: '14/03/2025',
    dose: 'מנה 1',
    location: 'מרפאת דוגמה',
    ageAtAdministration: '42.5',
  };

  it('produces a value matching the shared schema', () => {
    expect(() => vaccinationSchema.parse(vaccinationRowToVaccination(vaccinationRow))).not.toThrow();
  });

  it('normalizes the date and preserves list fields', () => {
    expect(vaccinationRowToVaccination(vaccinationRow)).toMatchObject({
      vaccineName: 'חיסון דוגמה',
      administeredOn: '2025-03-14',
      dose: 'מנה 1',
      location: 'מרפאת דוגמה',
      ageAtAdministration: 42.5,
      provider: HealthFundTypes.maccabi,
    });
  });

  it('drops rows without a vaccine name or date', () => {
    expect(vaccinationRowToVaccination({ ...vaccinationRow, vaccineName: null })).toBeNull();
    expect(vaccinationRowToVaccination({ ...vaccinationRow, administeredOn: null })).toBeNull();
  });

  it('derives a stable identity from the vaccination fields', () => {
    const first = vaccinationRowToVaccination(vaccinationRow)!;
    expect(vaccinationRowToVaccination({ ...vaccinationRow })).toEqual(first);
    expect(vaccinationRowToVaccination({ ...vaccinationRow, dose: 'מנה 2' })?.id).not.toBe(first.id);
    expect(vaccinationRowToVaccination({ ...vaccinationRow, location: 'מרפאה אחרת' })?.id).toBe(first.id);
  });
});

describe('form17RowToRequest', () => {
  const row: ScrapedForm17Row = {
    id: 'request-example-1',
    requestType: 'בקשת התחייבות לדוגמה',
    status: 'אושרה',
    submittedOn: '14/03/25',
    statusUpdatedOn: '15/03/2025',
    providerName: 'מרכז רפואי בדיוני',
    appointmentOn: '20/03/25',
    documentLabels: ['התחייבות', 'סיכום בקשה'],
    canChangeAppointment: true,
    requiresAdditionalInfo: false,
  };

  it('normalizes a Form 17 row into the public schema', () => {
    const request = form17RowToRequest(row);
    expect(() => form17RequestSchema.parse(request)).not.toThrow();
    expect(request).toMatchObject({
      id: 'request-example-1',
      submittedOn: '2025-03-14',
      statusUpdatedOn: '2025-03-15',
      appointmentOn: '2025-03-20',
      provider: HealthFundTypes.maccabi,
    });
  });

  it('drops layout artifacts without identity, type, or status', () => {
    expect(form17RowToRequest({ ...row, id: null })).toBeNull();
    expect(form17RowToRequest({ ...row, requestType: null })).toBeNull();
    expect(form17RowToRequest({ ...row, status: null })).toBeNull();
  });

  it('keeps optional dates nullable and removes blank document labels', () => {
    expect(form17RowToRequest({
      ...row,
      submittedOn: 'not a date',
      appointmentOn: null,
      documentLabels: [' התחייבות ', ' -- '],
    })).toMatchObject({
      submittedOn: null,
      appointmentOn: null,
      documentLabels: ['התחייבות'],
    });
  });
});
