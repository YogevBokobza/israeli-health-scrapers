import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import {
  chooseTable,
  rowToMedication,
  scrapeTables,
  tableToRawRows,
} from '../../src/scrapers/maccabi.js';
import { browserAvailable, launchTestBrowser } from '../browser.js';

/**
 * Exercises the DOM traversal against the saved fixture, in a real browser.
 *
 * The pure parser tests cover interpretation; this covers the part only a DOM can
 * exercise — which table elements are found, and how a missing <thead> is handled.
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

  it('reads every table off the page', async () => {
    const tables = await scrapeTables(page);
    // The fixture deliberately has an unrelated table above the prescriptions one.
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it('parses the fixture end to end into medications', async () => {
    const chosen = chooseTable(await scrapeTables(page));
    expect(chosen).not.toBeNull();

    const medications = tableToRawRows(chosen!.table, chosen!.mapping)
      .map((row) => rowToMedication(row, NOW))
      .filter((medication) => medication !== null);

    expect(medications).toHaveLength(3);
    expect(medications.map((medication) => medication!.name)).toContain('אלטרוקסין 100 מק"ג');

    // The totals row carries no drug name and must not survive parsing.
    expect(medications.every((medication) => medication!.name.length > 0)).toBe(true);
  });

  it('derives expiry across the fixture rows', async () => {
    const chosen = chooseTable(await scrapeTables(page));
    const byName = new Map(
      tableToRawRows(chosen!.table, chosen!.mapping)
        .map((row) => rowToMedication(row, NOW))
        .filter((medication) => medication !== null)
        .map((medication) => [medication!.name, medication!]),
    );

    expect(byName.get('ונטולין')?.status).toBe('expired');
    expect(byName.get('אלטרוקסין 100 מק"ג')?.status).toBe('active');
    expect(byName.get('אלטרוקסין 100 מק"ג')?.validUntil).toBe('2027-01-03');
  });

  it('handles a table with no thead by treating the first row as headers', async () => {
    const other = await browser.newPage();
    try {
      await other.setContent(`
        <table>
          <tr><td>שם התרופה</td><td>בתוקף עד</td></tr>
          <tr><td>אקמול</td><td>01/09/2026</td></tr>
        </table>
      `);

      const chosen = chooseTable(await scrapeTables(other));
      expect(chosen?.table.rows).toHaveLength(1);
      expect(chosen?.table.rows[0]?.[0]).toBe('אקמול');
    } finally {
      await other.close();
    }
  });
});
