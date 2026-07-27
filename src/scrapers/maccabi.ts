import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

import {
  HealthFundTypes,
  type Appointment,
  type HealthAccount,
  type Medication,
  type ScraperCredentials,
  type TestResult,
} from '../definitions.js';
import {
  BaseScraperWithBrowser,
  LoginResults,
  type LoginOptions,
  type LoginField,
} from './base-scraper-with-browser.js';
import { SelectorDriftError } from './errors.js';
import { deriveExpiry, parseIsraeliDate, parseIsraeliDateTime, textOrNull } from '../helpers/dates.js';
import { clickFirst, elementExists, fillFirst, waitUntil } from '../helpers/elements.js';
import { captureDiagnostics } from '../helpers/debug.js';

/**
 * Maccabi Healthcare Services (מכבי שירותי בריאות).
 *
 * Every Maccabi-specific URL and selector lives in this file. The site will change —
 * that is a certainty, not a risk — and when it does this is the only file to edit.
 *
 * NOTE: login, medications, and appointments selectors are all calibrated against a
 * live account (see git history). testResults selectors are UNCALIBRATED guesses —
 * they follow the same data-testid/data-hook conventions the other views turned out to
 * use, but the page has not been seen yet; treat a first run against them as a
 * calibration pass and fix from the diagnostics dump. On failure the scraper writes an
 * HTML dump under data/diagnostics, and the fix belongs in the constants below.
 */

const BASE_URL = 'https://online.maccabi4u.co.il';

const urls = {
  login: `${BASE_URL}/`,
  // The "all medications" tab is a dispense history — the same drug reappears every
  // time it was picked up. ValidPrescriptions is the deduplicated, currently-standing
  // view this scraper models: one row per drug with its next refill deadline.
  medications: `${BASE_URL}/sonline/medicalfile/medications/ValidPrescriptions/`,
  appointments: `${BASE_URL}/sonline/appointmentOrder/FutureAppointments/Lobby/`,
  // Uncalibrated — path from health-mcp/docs/roadmap.md. The site renders "lobby" lower
  // case in the appointments path; TestsResults may differ. Fix from a diagnostics dump.
  testResults: `${BASE_URL}/sonline/medicalfile/TestsResults/lobby/`,
} as const;

const selectors = {
  // The id-only screen and the id+password screen render two different id fields
  // (idNumber vs idNumber2/citizenId) rather than reusing one — both are listed so
  // fillFirst finds whichever is actually on the page.
  idInput: ['input#idNumber', 'input[name="idNumber"]', 'input#idNumber2', 'input[name="citizenId"]'],
  passwordInput: ['input[autocomplete="current-password"]', 'input[type="password"]'],
  submitButton: ['button[type="submit"]', 'input[type="submit"]'],
  otpInput: [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="code" i]',
  ],
  /** The interim "how do you want to verify" screen shown before the OTP field. */
  otpMethodSms: ['#otpCodebySMS'],
  /**
   * On that same interim screen, "כניסה עם סיסמה" (log in with a password) — the only
   * way to a password field. It sits on a separate screen from the id field, not next
   * to it, so a password login is id-submit, then this link, then id+password again.
   */
  passwordLoginLink: ['a:has-text("כניסה עם סיסמה")'],
  loggedInMarker: ['a[data-hook="Button__logout"]', 'a[href*="Logout" i]', 'a[href*="signout" i]'],
  invalidCredentials: ['[class*="error" i]', '[role="alert"]'],
  blocked: ['[class*="blocked" i]', '[class*="חסום"]'],
  prescriptionRow: ['[data-testid="prescription-row"]'],
  // No data-testid on this page — matched by the component's own class instead,
  // same convention as invalidCredentials/blocked above.
  appointmentRow: ['[class*="TimeLineItem-module__item"]'],
  /**
   * The list view carries no clinic/location at all — only the per-appointment detail
   * page (AppointmentInfo) does, reached by clicking a row (it has no href; navigation
   * is a client-side route change). Address, phone, and fax all share the providerInfo
   * class, so the one we want is matched by its sibling title text ("כתובת:"), not by
   * being first.
   */
  appointmentAddressItem: ['[class*="ProviderDetails__PipeItemWrap"]'],
  appointmentAddressTitle: ['[class*="ProviderDetails__title"]'],
  appointmentAddressValue: ['[class*="ProviderDetails__providerInfo"]'],
  /** "הנחיות לפני ביקור" (pre-visit instructions), also only on the detail page. */
  appointmentInstructionItem: ['[class*="VisitInstructions__instructionItem"]'],
  // Uncalibrated — guess following the data-testid convention medications turned out to
  // use, with the TimeLineItem-module__item class appointments fell back to as the second.
  // The page has not been seen; both the row selector and the inner ones below are bets
  // to be corrected from the first diagnostics dump.
  testResultRow: ['[data-testid="test-result-row"]', '[class*="TimeLineItem-module__item"]'],
} as const;

/* -------------------------------------------------------------------------- */
/* Pure parsing — exported so it can be tested without a browser or an account */
/* -------------------------------------------------------------------------- */

/** One prescription row as read straight from the DOM, before interpretation. */
export interface ScrapedPrescriptionRow {
  name: string | null;
  /** The refill deadline shown on the row (e.g. "09/08/26"). */
  date: string | null;
  prescribedBy: string | null;
  /** Whether the row carries the "תרופה קבועה" (standing medication) badge. */
  isStanding: boolean;
}

/**
 * Turns one scraped row into a `Medication`.
 *
 * Returns null for a row with no drug name (a layout artifact) or without the
 * standing-medication badge — this fund's ValidPrescriptions view can include
 * one-off prescriptions alongside standing ones, and only the latter is what
 * "standing prescriptions + expiry" means.
 */
export function prescriptionRowToMedication(
  row: ScrapedPrescriptionRow,
  now: Date = new Date(),
): Medication | null {
  const name = textOrNull(row.name);
  if (!name || !row.isStanding) return null;

  const validUntil = parseIsraeliDate(row.date);
  const { daysUntilExpiry, status } = deriveExpiry(validUntil, now);

  return {
    name,
    dosage: null,
    form: null,
    prescribedBy: textOrNull(row.prescribedBy),
    lastDispensed: null,
    validUntil,
    refillsRemaining: null,
    daysUntilExpiry,
    status,
    provider: HealthFundTypes.maccabi,
  };
}

/** Reads every prescription row off the page as plain strings. */
export async function scrapePrescriptionRows(page: Page): Promise<ScrapedPrescriptionRow[]> {
  return page.evaluate((rowSelector) => {
    const text = (el: Element | null) => {
      const value = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(rowSelector)).map((row) => ({
      name: text(row.querySelector('[class*="TimeLineItem-module__header"]')),
      date: text(row.querySelector('[data-hook="TimeLineDate"]')),
      prescribedBy: text(row.querySelector('[class*="specializationRow"] p')),
      isStanding: row.querySelector('[data-hook="Badge"]') !== null,
    }));
  }, selectors.prescriptionRow[0]);
}

/** One appointment row as read straight from the DOM, before interpretation. */
export interface ScrapedAppointmentRow {
  date: string | null;
  time: string | null;
  doctorName: string | null;
  specialty: string | null;
  /** Only ever populated from the detail page — the list view has no clinic column. */
  clinic: string | null;
  /** Pre-visit instructions ("הנחיות לפני ביקור"), also only on the detail page. */
  instructions: string[];
}

/**
 * Turns one scraped row into an `Appointment`.
 *
 * Returns null when the row carries no parseable date/time — the schema's `start` is
 * required, so a row we cannot place on a timeline is not an appointment we can report.
 */
export function appointmentRowToAppointment(row: ScrapedAppointmentRow): Appointment | null {
  const start = parseIsraeliDateTime(row.date, row.time);
  if (!start) return null;

  const doctorName = textOrNull(row.doctorName);
  const specialty = textOrNull(row.specialty);
  const clinic = textOrNull(row.clinic);

  // No stable id is exposed by the page, so one is derived from the fields that
  // together identify a single booking — stable across re-fetches of the same
  // appointment, distinct from any other row on the list.
  const id = createHash('sha1')
    .update([start, doctorName, specialty, clinic].join('|'))
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    start,
    doctorName,
    specialty,
    clinic,
    provider: HealthFundTypes.maccabi,
    ...(row.instructions.length > 0 ? { raw: { instructions: row.instructions } } : {}),
  };
}

/** Reads every appointment row off the page as plain strings. */
export async function scrapeAppointmentRows(page: Page): Promise<ScrapedAppointmentRow[]> {
  return page.evaluate((rowSelector) => {
    const text = (el: Element | null) => {
      const value = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
      // The date and its time render as two sibling divs under the same TimeLineDate
      // wrapper — the time one prefixed with the word "שעה" ("hour"), not bare HH:mm.
      const dateTimeDivs = Array.from(
        row.querySelector('[data-hook="TimeLineDate"]')?.querySelectorAll(':scope > div') ?? [],
      );

      return {
        date: text(dateTimeDivs[0] ?? null),
        time: text(dateTimeDivs[1] ?? null),
        doctorName: text(row.querySelector('[class*="providerName"]')),
        // Specialty and visit type render as one combined string ("אף אוזן וגרון | ביקור
        // רגיל"); the schema has no separate slot for visit type, so it stays combined.
        specialty: text(row.querySelector('[class*="providerServiceType"]')),
        // Neither exists on the list view — only the detail page has them (see
        // scrapeAppointmentDetail), merged in by fetchAppointments after this runs.
        clinic: null,
        instructions: [] as string[],
      };
    });
  }, selectors.appointmentRow[0]);
}

/** Reads the clinic address and pre-visit instructions off an appointment's detail page. */
export async function scrapeAppointmentDetail(
  page: Page,
): Promise<{ clinic: string | null; instructions: string[] }> {
  return page.evaluate(
    ({ addressItem, addressTitle, addressValue, instructionItem }) => {
      const text = (el: Element | null) => {
        const value = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return value.length > 0 ? value : null;
      };

      // Address, phone, and fax all share the same value class — the one we want is
      // matched by its sibling title text, not by being first.
      const address = Array.from(document.querySelectorAll(addressItem)).find((item) =>
        (item.querySelector(addressTitle)?.textContent ?? '').includes('כתובת'),
      );

      const instructions = Array.from(document.querySelectorAll(instructionItem))
        .map((item) => text(item))
        .filter((item): item is string => item !== null);

      return { clinic: text(address?.querySelector(addressValue) ?? null), instructions };
    },
    {
      addressItem: selectors.appointmentAddressItem[0],
      addressTitle: selectors.appointmentAddressTitle[0],
      addressValue: selectors.appointmentAddressValue[0],
      instructionItem: selectors.appointmentInstructionItem[0],
    },
  );
}

/** One test-result row as read straight from the DOM, before interpretation. */
export interface ScrapedTestResultRow {
  testName: string | null;
  /** The performance date shown on the row (e.g. "09/08/26"). */
  date: string | null;
  orderingDoctor: string | null;
}

/**
 * Turns one scraped row into a `TestResult`.
 *
 * Returns null when the row carries no parseable name or date — `testName` and
 * `performedOn` are the two fields that locate a result on a timeline, so a row we
 * cannot place is not one we can report.
 */
export function testResultRowToTestResult(row: ScrapedTestResultRow): TestResult | null {
  const testName = textOrNull(row.testName);
  const performedOn = parseIsraeliDate(row.date);
  if (!testName || !performedOn) return null;

  const orderingDoctor = textOrNull(row.orderingDoctor);

  // No stable id is exposed by the page, so one is derived from the fields that together
  // identify a single result — stable across re-fetches, distinct from any other row.
  const id = createHash('sha1')
    .update([performedOn, testName, orderingDoctor].join('|'))
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    testName,
    performedOn,
    orderingDoctor,
    provider: HealthFundTypes.maccabi,
  };
}

/** Reads every test-result row off the page as plain strings. */
export async function scrapeTestResultRows(page: Page): Promise<ScrapedTestResultRow[]> {
  return page.evaluate((rowSelector) => {
    const text = (el: Element | null) => {
      const value = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(rowSelector)).map((row) => ({
      // Inner selectors mirror the conventions medications/appointments read off their
      // rows — the TimeLineItem header carries the title and a sibling holds the date.
      // All uncalibrated; correct from the first diagnostics dump.
      testName: text(row.querySelector('[class*="TimeLineItem-module__header"]')),
      date: text(row.querySelector('[data-hook="TimeLineDate"]')),
      orderingDoctor: text(row.querySelector('[class*="specializationRow"] p')),
    }));
  }, selectors.testResultRow[0]);
}

export class MaccabiScraper extends BaseScraperWithBrowser {
  protected getLoginOptions(): LoginOptions {
    return {
      loginUrl: urls.login,

      // The first screen only ever asks for the id — password, when there is one, lives
      // on a screen reached by a link on the verification picker (see afterSubmit).
      fields: (credentials: ScraperCredentials) => [
        { selectors: selectors.idInput, value: credentials.id },
      ],

      submitButtonSelectors: selectors.submitButton,
      otpFieldSelectors: selectors.otpInput,
      // #sendOtp carries no type="submit" attribute, so it never matches submitButton.
      otpSubmitSelectors: ['#sendOtp', '#sendOtpMobile'],

      // The verification picker appears between the id submit and the OTP field. Most
      // accounts want SMS; a caller that supplied a password instead wants the
      // password link, which leads to its own id+password screen and its own submit.
      afterSubmit: async (page, credentials) => {
        const reachedPicker = await waitUntil(
          async () =>
            (await elementExists(page, selectors.otpMethodSms)) ||
            (await elementExists(page, selectors.passwordLoginLink)),
          5_000,
        );
        if (!reachedPicker) return;

        if (credentials.password && (await elementExists(page, selectors.passwordLoginLink))) {
          await clickFirst(page, selectors.passwordLoginLink);
          await waitUntil(async () => elementExists(page, selectors.passwordInput), 5_000);

          const idFilled = await fillFirst(page, selectors.idInput, credentials.id);
          const passwordFilled = await fillFirst(page, selectors.passwordInput, credentials.password);
          if (!idFilled || !passwordFilled) {
            const diagnostics = await captureDiagnostics(
              page,
              HealthFundTypes.maccabi,
              'password-screen-field-missing',
            );
            const missing = [!idFilled && 'id', !passwordFilled && 'password'].filter(Boolean).join(' and ');
            throw new SelectorDriftError(`the ${missing} field on the password login screen`, diagnostics);
          }

          await clickFirst(page, selectors.submitButton);
          return;
        }

        await clickFirst(page, selectors.otpMethodSms);
      },

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

    if (targets.includes('appointments')) {
      account.appointments = await this.fetchAppointments();
    }

    if (targets.includes('testResults')) {
      account.testResults = await this.fetchTestResults();
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

    // This SPA route renders its rows client-side after the data request resolves;
    // domcontentloaded fires before that. Checking immediately reads as "empty" the
    // same way the homepage's post-login markers did before rendering caught up.
    await waitUntil(async () => elementExists(page, selectors.prescriptionRow), 8_000);

    const now = new Date();
    const medications = (await scrapePrescriptionRows(page))
      .map((row) => prescriptionRowToMedication(row, now))
      .filter((medication): medication is Medication => medication !== null);

    if (medications.length === 0) {
      // An empty prescription list and a page we failed to read look identical. We keep
      // a dump so the difference is checkable, but return an empty list rather than
      // inventing a failure the member would have to debug.
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'medications-empty');
      this.log('no prescription rows found', { diagnostics });
    }

    // Soonest to expire first — that is the order the question is actually asked in.
    // Unknown expiry sorts last rather than masquerading as urgent.
    medications.sort((a, b) => (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity));

    return medications;
  }

  /** Reads upcoming appointments, soonest first. */
  private async fetchAppointments(): Promise<Appointment[]> {
    const page = this.activePage;
    await page.goto(urls.appointments, { waitUntil: 'domcontentloaded' });

    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'appointments-logged-out');
      throw new SelectorDriftError('a logged-in appointments page', diagnostics);
    }

    await waitUntil(async () => elementExists(page, selectors.appointmentRow), 8_000);

    const rows = await scrapeAppointmentRows(page);

    // The list view carries no clinic/location or instructions — only each row's detail
    // page does, and getting there is a click, not a URL. Fetched one at a time and
    // merged back in; the list re-renders after each goBack, so this must run before
    // mapping to Appointment rather than in the same pass as scrapeAppointmentRows.
    for (const [i, row] of rows.entries()) {
      const detail = await this.fetchAppointmentDetail(page, i);
      row.clinic = detail.clinic;
      row.instructions = detail.instructions;
    }

    const appointments = rows
      .map((row) => appointmentRowToAppointment(row))
      .filter((appointment): appointment is Appointment => appointment !== null);

    if (appointments.length === 0) {
      // Same reasoning as fetchMedications: an empty list and a page we failed to read
      // look identical, so a dump is kept without treating "none" as an error.
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'appointments-empty');
      this.log('no appointment rows found', { diagnostics });
    }

    appointments.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    return appointments;
  }

  /** Reads past test results, newest first. */
  private async fetchTestResults(): Promise<TestResult[]> {
    const page = this.activePage;
    await page.goto(urls.testResults, { waitUntil: 'domcontentloaded' });

    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-logged-out');
      throw new SelectorDriftError('a logged-in test results page', diagnostics);
    }

    // This SPA route renders its rows client-side after the data request resolves;
    // domcontentloaded fires before that — same race fetchMedications waits out.
    await waitUntil(async () => elementExists(page, selectors.testResultRow), 8_000);

    const testResults = (await scrapeTestResultRows(page))
      .map((row) => testResultRowToTestResult(row))
      .filter((testResult): testResult is TestResult => testResult !== null);

    if (testResults.length === 0) {
      // Same reasoning as fetchMedications: an empty list and a page we failed to read
      // look identical, so a dump is kept without treating "none" as an error.
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-empty');
      this.log('no test result rows found', { diagnostics });
    }

    // Newest first — that is the order the question is actually asked in. Unknown dates
    // sort last rather than masquerading as recent.
    testResults.sort((a, b) => (b.performedOn ?? '').localeCompare(a.performedOn ?? ''));

    return testResults;
  }

  /**
   * Clicks into one appointment's detail page for its clinic/address and pre-visit
   * instructions, then returns to the list. Best-effort: a missing address is logged
   * with diagnostics rather than failing the whole fetch over fields the list view
   * never had to begin with.
   */
  private async fetchAppointmentDetail(
    page: Page,
    index: number,
  ): Promise<{ clinic: string | null; instructions: string[] }> {
    await page.locator(selectors.appointmentRow[0]).nth(index).click();

    const reachedDetail = await waitUntil(async () => page.url().includes('AppointmentInfo'), 8_000);
    if (!reachedDetail) {
      const diagnostics = await captureDiagnostics(
        page,
        this.options.companyId,
        'appointment-detail-unreached',
      );
      this.log('appointment detail page did not open', { index, diagnostics });
      return { clinic: null, instructions: [] };
    }

    // The URL changes the instant the client-side route does, well before the detail
    // page's own data fetch resolves — reading immediately here is the same race the
    // OTP submit button had. Wait for the address itself rather than a fixed delay, but
    // proceed either way: a genuinely missing selector should still get diagnosed.
    await waitUntil(async () => elementExists(page, selectors.appointmentAddressValue), 5_000);

    const detail = await scrapeAppointmentDetail(page);
    if (!detail.clinic) {
      const diagnostics = await captureDiagnostics(
        page,
        this.options.companyId,
        'appointment-clinic-missing',
      );
      this.log('no clinic address found on appointment detail page', { index, diagnostics });
    }

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitUntil(async () => elementExists(page, selectors.appointmentRow), 8_000);

    return detail;
  }
}
