import type { Page } from 'playwright';

import {
  HealthFundTypes,
  type HealthAccount,
  type Medication,
  type ScraperCredentials,
} from '../definitions.js';
import {
  BaseScraperWithBrowser,
  LoginResults,
  type LoginOptions,
  type LoginField,
} from './base-scraper-with-browser.js';
import { SelectorDriftError } from './errors.js';
import { deriveExpiry, parseIsraeliDate, parseInteger, textOrNull } from '../helpers/dates.js';
import { elementExists } from '../helpers/elements.js';
import { captureDiagnostics } from '../helpers/debug.js';

/**
 * Maccabi Healthcare Services (מכבי שירותי בריאות).
 *
 * Every Maccabi-specific URL and selector lives in this file. The site will change —
 * that is a certainty, not a risk — and when it does this is the only file to edit.
 *
 * NOTE: these selectors have not been calibrated against a live logged-in session,
 * which needs a real member account. Treat the first run as a calibration pass: on
 * failure the scraper writes an HTML dump under data/diagnostics, and the fix belongs
 * in the constants below.
 */

const BASE_URL = 'https://online.maccabi4u.co.il';

const urls = {
  login: `${BASE_URL}/`,
  medications: `${BASE_URL}/Pages/Prescriptions.aspx`,
} as const;

const selectors = {
  idInput: [
    'input[autocomplete="username"]',
    'input[name*="userId" i]',
    'input[id*="userId" i]',
    'input[name*="tz" i]',
  ],
  passwordInput: ['input[autocomplete="current-password"]', 'input[type="password"]'],
  submitButton: ['button[type="submit"]', 'input[type="submit"]'],
  otpInput: [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="code" i]',
  ],
  loggedInMarker: ['a[href*="Logout" i]', 'a[href*="signout" i]', '[class*="personal-area" i]'],
  invalidCredentials: ['[class*="error" i]', '[role="alert"]'],
  blocked: ['[class*="blocked" i]', '[class*="חסום"]'],
} as const;

/** Hebrew column headers, used to find columns when classes are unstable. */
const medicationHeaders = {
  name: ['תרופה', 'שם התרופה', 'שם תרופה'],
  dosage: ['מינון', 'חוזק'],
  form: ['צורה', 'צורת מתן'],
  prescribedBy: ['רופא', 'רופא מטפל', 'מרשם מאת'],
  lastDispensed: ['ניפוק אחרון', 'תאריך ניפוק', 'סופק'],
  validUntil: ['בתוקף עד', 'תוקף', 'תאריך תפוגה'],
  refills: ['יתרה', 'ניפוקים שנותרו', 'כמות שנותרה'],
} as const;

type MedicationField = keyof typeof medicationHeaders;

export interface ScrapedTable {
  headers: string[];
  rows: string[][];
}

export interface RawMedicationRow extends Partial<Record<MedicationField, string | null>> {
  extra?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Pure parsing — exported so it can be tested without a browser or an account */
/* -------------------------------------------------------------------------- */

/**
 * Maps a header cell to the field it labels. Matching is substring-based in both
 * directions, because a header arrives as "בתוקף עד" but also as "תוקף המרשם" and we
 * would rather map a column loosely than silently drop it.
 */
export function matchHeaderToField(header: string): MedicationField | null {
  const text = textOrNull(header);
  if (!text) return null;

  for (const [field, labels] of Object.entries(medicationHeaders) as [
    MedicationField,
    readonly string[],
  ][]) {
    if (labels.some((label) => text.includes(label) || label.includes(text))) return field;
  }
  return null;
}

/** Maps a table's headers to fields, or null when none are recognizable. */
export function mapHeaders(headers: string[]): Map<number, MedicationField> | null {
  const mapping = new Map<number, MedicationField>();

  headers.forEach((header, index) => {
    const field = matchHeaderToField(header);
    // First column wins: a later "תאריך" must not overwrite an explicit "בתוקף עד".
    if (field && ![...mapping.values()].includes(field)) mapping.set(index, field);
  });

  return mapping.size > 0 ? mapping : null;
}

/**
 * Picks the table that actually holds prescriptions: the one whose headers map to the
 * most known fields and which at least names a drug. Choosing by header content rather
 * than by position survives a redesign that adds a table above it.
 */
export function chooseTable(
  tables: ScrapedTable[],
): { table: ScrapedTable; mapping: Map<number, MedicationField> } | null {
  let best: { table: ScrapedTable; mapping: Map<number, MedicationField> } | null = null;

  for (const table of tables) {
    const mapping = mapHeaders(table.headers);
    if (!mapping || !new Set(mapping.values()).has('name')) continue;
    if (!best || mapping.size > best.mapping.size) best = { table, mapping };
  }

  return best;
}

/** Converts a chosen table into raw rows, keeping unmapped columns under `extra`. */
export function tableToRawRows(
  table: ScrapedTable,
  mapping: Map<number, MedicationField>,
): RawMedicationRow[] {
  return table.rows.map((cells) => {
    const row: RawMedicationRow = {};
    const extra: Record<string, string> = {};

    cells.forEach((cell, index) => {
      const field = mapping.get(index);
      if (field) {
        row[field] = cell;
        return;
      }
      const header = table.headers[index];
      if (header && cell) extra[header] = cell;
    });

    if (Object.keys(extra).length > 0) row.extra = extra;
    return row;
  });
}

/**
 * Turns one scraped row into a `Medication`.
 *
 * Returns null for a row with no drug name: that is a layout artifact (a spacer or a
 * totals line), not a prescription, and dropping it is what keeps the list trustworthy.
 */
export function rowToMedication(row: RawMedicationRow, now: Date = new Date()): Medication | null {
  const name = textOrNull(row.name);
  if (!name) return null;

  const validUntil = parseIsraeliDate(row.validUntil);
  const { daysUntilExpiry, status } = deriveExpiry(validUntil, now);

  const medication: Medication = {
    name,
    dosage: textOrNull(row.dosage),
    form: textOrNull(row.form),
    prescribedBy: textOrNull(row.prescribedBy),
    lastDispensed: parseIsraeliDate(row.lastDispensed),
    validUntil,
    refillsRemaining: parseInteger(row.refills),
    daysUntilExpiry,
    status,
    provider: HealthFundTypes.maccabi,
  };

  if (row.extra && Object.keys(row.extra).length > 0) medication.raw = { ...row.extra };

  return medication;
}

/** Reads every candidate table off the page as plain strings. */
export async function scrapeTables(page: Page): Promise<ScrapedTable[]> {
  return page.evaluate(() => {
    const cellText = (cell: Element) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim();

    return Array.from(document.querySelectorAll('table')).map((table) => {
      const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
      const hasThead = headerCells.length > 0;

      // Every row that is not itself the header row. Selecting on `tr` alone would
      // also match the row inside <thead>, which then parses as a medication named
      // after its own column header.
      const allRows = Array.from(table.querySelectorAll('tr'));
      const bodyRows = hasThead ? allRows.filter((row) => !row.closest('thead')) : allRows;

      // Some pages omit <thead> and use the first row for headers.
      const headers = hasThead
        ? headerCells.map(cellText)
        : Array.from(bodyRows[0]?.querySelectorAll('th, td') ?? []).map(cellText);

      const dataRows = hasThead ? bodyRows : bodyRows.slice(1);

      return {
        headers,
        rows: dataRows.map((row) => Array.from(row.querySelectorAll('th, td')).map(cellText)),
      };
    });
  });
}

export class MaccabiScraper extends BaseScraperWithBrowser {
  protected getLoginOptions(): LoginOptions {
    return {
      loginUrl: urls.login,

      fields: (credentials: ScraperCredentials) => {
        const fields: LoginField[] = [{ selectors: selectors.idInput, value: credentials.id }];
        // The password is optional: an OTP-only account never shows the field, and
        // demanding one would block exactly the members this fund is configured for.
        if (credentials.password) {
          fields.push({ selectors: selectors.passwordInput, value: credentials.password });
        }
        return fields;
      },

      submitButtonSelectors: selectors.submitButton,
      otpFieldSelectors: selectors.otpInput,

      // Order matters: the specific failure states are checked before Success, so a
      // page that shows both an error banner and a stale header is not misread as a
      // successful login.
      possibleResults: {
        [LoginResults.AccountBlocked]: [(page) => elementExists(page, selectors.blocked)],
        [LoginResults.TwoFactorRequired]: [(page) => elementExists(page, selectors.otpInput)],
        [LoginResults.Success]: [(page) => elementExists(page, selectors.loggedInMarker)],
        [LoginResults.InvalidPassword]: [
          (page) => elementExists(page, selectors.invalidCredentials),
        ],
      },
    };
  }

  protected async fetchAccounts(): Promise<HealthAccount[]> {
    const targets = this.options.fetch ?? ['medications'];
    const account: HealthAccount = {
      provider: HealthFundTypes.maccabi,
      medications: [],
    };

    if (targets.includes('medications')) {
      account.medications = await this.fetchMedications();
    }

    return [account];
  }

  /** Reads the standing prescriptions, soonest to expire first. */
  private async fetchMedications(): Promise<Medication[]> {
    const page = this.activePage;
    await page.goto(urls.medications, { waitUntil: 'domcontentloaded' });

    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'medications-logged-out');
      throw new SelectorDriftError('a logged-in prescriptions page', diagnostics);
    }

    const chosen = chooseTable(await scrapeTables(page));

    if (!chosen) {
      // An empty prescription list and a page we failed to read look identical. We keep
      // a dump so the difference is checkable, but return an empty list rather than
      // inventing a failure the member would have to debug.
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'medications-empty');
      this.log('no prescription table found', { diagnostics });
      return [];
    }

    const now = new Date();
    const medications = tableToRawRows(chosen.table, chosen.mapping)
      .map((row) => rowToMedication(row, now))
      .filter((medication): medication is Medication => medication !== null);

    // Soonest to expire first — that is the order the question is actually asked in.
    // Unknown expiry sorts last rather than masquerading as urgent.
    medications.sort((a, b) => (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity));

    return medications;
  }
}
