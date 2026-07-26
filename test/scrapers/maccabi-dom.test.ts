import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import { prescriptionRowToMedication, scrapePrescriptionRows } from '../../src/scrapers/maccabi.js';
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

const fixture = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/maccabi/medications.html'),
  'utf8',
);

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
    expect(medications.map((medication) => medication!.name)).toContain('אלטרוקסין 100 מק"ג');
  });

  it('derives expiry across the fixture rows', async () => {
    const rows = await scrapePrescriptionRows(page);
    const byName = new Map(
      rows
        .map((row) => prescriptionRowToMedication(row, NOW))
        .filter((medication) => medication !== null)
        .map((medication) => [medication!.name, medication!]),
    );

    expect(byName.get('DIOVAN FCT TAB 40MG (28)')?.status).toBe('expiring_soon');
    expect(byName.get('אלטרוקסין 100 מק"ג')?.status).toBe('active');
    expect(byName.get('אלטרוקסין 100 מק"ג')?.validUntil).toBe('2027-01-03');
  });

  it('excludes the one-off prescription with no standing badge', async () => {
    const rows = await scrapePrescriptionRows(page);
    const medications = rows
      .map((row) => prescriptionRowToMedication(row, NOW))
      .filter((medication) => medication !== null);

    expect(medications.some((medication) => medication!.name.includes('PEN RAFA'))).toBe(false);
  });
});
