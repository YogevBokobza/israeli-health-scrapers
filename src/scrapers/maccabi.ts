import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

import {
  HealthFundTypes,
  type Appointment,
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
import { deriveExpiry, parseIsraeliDate, parseIsraeliDateTime, textOrNull } from '../helpers/dates.js';
import { clickFirst, elementExists, fillFirst, waitUntil } from '../helpers/elements.js';
import { captureDiagnostics } from '../helpers/debug.js';

/**
 * Maccabi Healthcare Services (מכבי שירותי בריאות).
 *
 * Every Maccabi-specific URL and selector lives in this file. The site will change —
 * that is a certainty, not a risk — and when it does this is the only file to edit.
 *
 * NOTE: login and medications selectors are calibrated against a live account (see git
 * history). Appointments is not — that URL and every `selectors.appointment*` entry is
 * an uncalibrated guess, same starting state medications was in before its first live
 * run. Treat the first `fetch: ['appointments']` run as that calibration pass: on
 * failure the scraper writes an HTML dump under data/diagnostics, and the fix belongs
 * in the constants below.
 */

const BASE_URL = 'https://online.maccabi4u.co.il';

const urls = {
  login: `${BASE_URL}/`,
  // The "all medications" tab is a dispense history — the same drug reappears every
  // time it was picked up. ValidPrescriptions is the deduplicated, currently-standing
  // view this scraper models: one row per drug with its next refill deadline.
  medications: `${BASE_URL}/sonline/medicalfile/medications/ValidPrescriptions/`,
  // Uncalibrated guess — mirrors the medicalfile/<domain>/ shape the medications URL
  // turned out to have, but the real path has not been confirmed against a live account.
  appointments: `${BASE_URL}/sonline/medicalfile/appointments/MyAppointments/`,
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
  // Uncalibrated guess, following the same data-testid convention prescriptionRow
  // turned out to use.
  appointmentRow: ['[data-testid="appointment-row"]'],
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
  clinic: string | null;
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
  };
}

/** Reads every appointment row off the page as plain strings. */
export async function scrapeAppointmentRows(page: Page): Promise<ScrapedAppointmentRow[]> {
  return page.evaluate((rowSelector) => {
    const text = (el: Element | null) => {
      const value = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(rowSelector)).map((row) => ({
      date: text(row.querySelector('[data-hook="AppointmentDate"]')),
      time: text(row.querySelector('[data-hook="AppointmentTime"]')),
      doctorName: text(row.querySelector('[data-hook="AppointmentDoctor"]')),
      specialty: text(row.querySelector('[data-hook="AppointmentSpecialty"]')),
      clinic: text(row.querySelector('[data-hook="AppointmentClinic"]')),
    }));
  }, selectors.appointmentRow[0]);
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

    const appointments = (await scrapeAppointmentRows(page))
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
}
