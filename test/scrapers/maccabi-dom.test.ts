import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import {
  appointmentRowToAppointment,
  prescriptionRowToMedication,
  scrapeAppointmentDetail,
  scrapeAppointmentRows,
  scrapePrescriptionRows,
  scrapeTestResultRows,
  testResultRowToTestResult,
} from '../../src/scrapers/maccabi.js';
import { browserAvailable, launchTestBrowser } from '../browser.js';

/**
 * Exercises the DOM traversal against the saved fixture, in a real browser.
 *
 * The pure parser tests cover interpretation; this covers the part only a DOM can
 * exercise — which elements are found inside each prescription-row card.
 *
 * The suite is skipped, visibly, when no browser binary exists. It must never degrade
 * into tests that return early and pass while asserting nothing.
 */

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/maccabi');
const fixture = fs.readFileSync(path.join(fixturesDir, 'medications.html'), 'utf8');
const appointmentsFixture = fs.readFileSync(path.join(fixturesDir, 'appointments.html'), 'utf8');
const appointmentDetailFixture = fs.readFileSync(path.join(fixturesDir, 'appointment-detail.html'), 'utf8');
const testResultsFixture = fs.readFileSync(path.join(fixturesDir, 'testResults.html'), 'utf8');

const NOW = new Date('2026-07-26T12:00:00Z');

describe.skipIf(!browserAvailable)('maccabi DOM extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(fixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('reads every prescription-row card off the page', async () => {
    const rows = await scrapePrescriptionRows(page);
    // The fixture has a standing row, a one-off row, and a row missing its name.
    expect(rows.length).toBe(4);
  });

  it('parses the fixture end to end into medications', async () => {
    const rows = await scrapePrescriptionRows(page);
    const medications = rows
      .map((row) => prescriptionRowToMedication(row, NOW))
      .filter((medication) => medication !== null);

    // Two standing rows have both a badge and a name; the one-off and the nameless
    // row must not survive.
    expect(medications).toHaveLength(2);
    expect(medications.map((medication) => medication!.name)).toContain('SAMPLEXIN 250MG CAP');
  });

  it('derives expiry across the fixture rows', async () => {
    const rows = await scrapePrescriptionRows(page);
    const byName = new Map(
      rows
        .map((row) => prescriptionRowToMedication(row, NOW))
        .filter((medication) => medication !== null)
        .map((medication) => [medication!.name, medication!]),
    );

    expect(byName.get('FICTAMOL 500MG TAB (20)')?.status).toBe('expiring_soon');
    expect(byName.get('SAMPLEXIN 250MG CAP')?.status).toBe('active');
    expect(byName.get('SAMPLEXIN 250MG CAP')?.validUntil).toBe('2027-01-03');
  });

  it('excludes the one-off prescription with no standing badge', async () => {
    const rows = await scrapePrescriptionRows(page);
    const medications = rows
      .map((row) => prescriptionRowToMedication(row, NOW))
      .filter((medication) => medication !== null);

    expect(medications.some((medication) => medication!.name.includes('TESTOPRIL'))).toBe(false);
  });
});

describe.skipIf(!browserAvailable)('maccabi appointment extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(appointmentsFixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('reads every appointment-row card off the page', async () => {
    const rows = await scrapeAppointmentRows(page);
    expect(rows.length).toBe(3);
  });

  it('parses the fixture end to end into appointments, dropping the incomplete row', async () => {
    const rows = await scrapeAppointmentRows(page);
    const appointments = rows.map((row) => appointmentRowToAppointment(row)).filter((a) => a !== null);

    expect(appointments).toHaveLength(2);
    expect(appointments.map((a) => a!.doctorName)).toContain('דר לוי אבי');
  });
});

describe.skipIf(!browserAvailable)('maccabi appointment detail extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(appointmentDetailFixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('matches the address by its title, not the first shared-class value (phone)', async () => {
    const detail = await scrapeAppointmentDetail(page);
    expect(detail.clinic).toBe('רחוב הדוגמה 1, עיר בדיונית');
  });

  it('reads every pre-visit instruction line', async () => {
    const detail = await scrapeAppointmentDetail(page);
    expect(detail.instructions).toEqual([
      'הביקור כרוך בהשתתפות עצמית, הנגבית באמצעות הוראת קבע.',
      'בהיעדר הוראת קבע, הבא את הסכום המדויק במזומן.',
    ]);
  });
});

describe.skipIf(!browserAvailable)('maccabi test-result extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(testResultsFixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('reads every test-result-row card off the page', async () => {
    const rows = await scrapeTestResultRows(page);
    // The fixture has five rows: three complete, one missing its name, one with an
    // unparseable date.
    expect(rows.length).toBe(5);
  });

  it('parses the fixture end to end into test results, dropping the two incomplete rows', async () => {
    const rows = await scrapeTestResultRows(page);
    const testResults = rows
      .map((row) => testResultRowToTestResult(row))
      .filter((testResult) => testResult !== null);

    expect(testResults).toHaveLength(3);
    expect(testResults.map((t) => t!.testName)).toContain('צילום חזה');
  });

  it('normalizes the date to ISO form on a known row', async () => {
    const rows = await scrapeTestResultRows(page);
    const byName = new Map(
      rows
        .map((row) => testResultRowToTestResult(row))
        .filter((testResult) => testResult !== null)
        .map((testResult) => [testResult!.testName, testResult!]),
    );

    expect(byName.get('צילום חזה')?.performedOn).toBe('2026-04-03');
  });
});
