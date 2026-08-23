import { createHash } from 'node:crypto';
import type { Locator, Page } from 'playwright';

import {
  HealthFundTypes,
  type Appointment,
  type Form17Request,
  type HealthAccount,
  type Medication,
  type ScraperCredentials,
  type TestResult,
  type Vaccination,
} from '../definitions.js';
import {
  BaseScraperWithBrowser,
  LoginResults,
  matchLoginResult,
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
 * NOTE: login, medications, appointments, test-results, vaccinations, and Form 17 selectors are calibrated
 * against a live account (see git history). On failure the scraper writes an HTML dump
 * under data/diagnostics, and the fix belongs in the constants below.
 */

const BASE_URL = 'https://online.maccabi4u.co.il';

const urls = {
  login: `${BASE_URL}/`,
  // The "all medications" tab is a dispense history — the same drug reappears every
  // time it was picked up. ValidPrescriptions is the deduplicated, currently-standing
  // view this scraper models: one row per drug with its next refill deadline.
  medications: `${BASE_URL}/sonline/medicalfile/medications/ValidPrescriptions/`,
  appointments: `${BASE_URL}/sonline/appointmentOrder/FutureAppointments/Lobby/`,
  testResults: `${BASE_URL}/sonline/testsResults/TestsResults/lobby/`,
  vaccinations: `${BASE_URL}/sonline/medicalfile/vaccinations/Lobby/`,
  form17: `${BASE_URL}/sonline/requestsAndApprovals/StatusRequest/Lobby/?caseFilter=53,1,2`,
} as const;

export const maccabiMedicationSelectors = {
  row: ['[data-testid="prescription-row"]'],
  name: ['[class*="TimeLineItem-module__header"]'],
  date: ['[data-hook="TimeLineDate"]'],
  prescriber: ['[class*="specializationRow"] p'],
  standingBadge: ['[data-hook="Badge"]'],
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
  prescriptionRow: maccabiMedicationSelectors.row,
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
  // The component can render a TimeLineItem wrapper around the actual list item. Match
  // only semantic list entries so one visible result is not extracted twice.
  testResultRow: ['[role="listitem"][data-hook="TimeLineItem"]'],
  vaccinationRow: ['[data-testid="vaccination-row"]'],
  form17Row: ['[data-hook="LazyLoading"] > [role="listitem"]'],
} as const;

const firstSelector = (selectorList: readonly string[]): string => selectorList[0]!;
const anySelector = (selectorList: readonly string[]): string => selectorList.join(', ');

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
 * Returns null only for a row with no drug name (a layout artifact). This fund's
 * ValidPrescriptions view lists one-off prescriptions alongside standing ones, and
 * both are returned — `isStanding` carries the "תרופה קבועה" badge so a caller can
 * filter to standing prescriptions itself rather than the scraper silently dropping
 * the one-off ones.
 */
export function prescriptionRowToMedication(
  row: ScrapedPrescriptionRow,
  now: Date = new Date(),
): Medication | null {
  const name = textOrNull(row.name);
  if (!name) return null;

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
    isStanding: row.isStanding,
    provider: HealthFundTypes.maccabi,
  };
}

/** Reads every prescription row off the page as plain strings. */
export async function scrapePrescriptionRows(page: Page): Promise<ScrapedPrescriptionRow[]> {
  return page.evaluate((bindingSelectors) => {
    const text = (el: Element | null) => {
      const value = (el?.textContent ?? '')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(bindingSelectors.row)).map((row) => ({
      name: text(row.querySelector(bindingSelectors.name)),
      date: text(row.querySelector(bindingSelectors.date)),
      prescribedBy: text(row.querySelector(bindingSelectors.prescriber)),
      isStanding: row.querySelector(bindingSelectors.standingBadge) !== null,
    }));
  }, {
    row: maccabiMedicationSelectors.row[0],
    name: maccabiMedicationSelectors.name[0],
    date: maccabiMedicationSelectors.date[0],
    prescriber: maccabiMedicationSelectors.prescriber[0],
    standingBadge: maccabiMedicationSelectors.standingBadge[0],
  });
}

const medicationDescendantSelector = (selector: readonly string[]): string =>
  `${maccabiMedicationSelectors.row[0]} ${selector[0]}`;

/** Current medication selectors and parser exposed to the fund-agnostic calibration resolver. */
export const maccabiMedicationBindingDefinition = {
  bindings: [
    {
      field: 'rows',
      selector: maccabiMedicationSelectors.row[0],
      valueFromResult: (rows: ScrapedPrescriptionRow[]) => rows,
    },
    {
      field: 'name',
      selector: medicationDescendantSelector(maccabiMedicationSelectors.name),
      valueFromResult: (rows: ScrapedPrescriptionRow[]) => rows.map((row) => row.name),
    },
    {
      field: 'date',
      selector: medicationDescendantSelector(maccabiMedicationSelectors.date),
      valueFromResult: (rows: ScrapedPrescriptionRow[]) => rows.map((row) => row.date),
    },
    {
      field: 'prescribedBy',
      selector: medicationDescendantSelector(maccabiMedicationSelectors.prescriber),
      valueFromResult: (rows: ScrapedPrescriptionRow[]) => rows.map((row) => row.prescribedBy),
    },
    {
      field: 'isStanding',
      selector: medicationDescendantSelector(maccabiMedicationSelectors.standingBadge),
      valueFromResult: (rows: ScrapedPrescriptionRow[]) => rows.map((row) => row.isStanding),
    },
  ],
  parse: scrapePrescriptionRows,
} as const;

export interface ScrapedVaccinationRow {
  vaccineName: string | null;
  administeredOn: string | null;
  ageAtAdministration: string | null;
  dose: string | null;
  location: string | null;
}

export function vaccinationRowToVaccination(row: ScrapedVaccinationRow): Vaccination | null {
  const vaccineName = textOrNull(row.vaccineName);
  const administeredOn = parseIsraeliDate(row.administeredOn);
  if (!vaccineName || !administeredOn) return null;
  const dose = textOrNull(row.dose);
  const location = textOrNull(row.location);
  const ageText = textOrNull(row.ageAtAdministration)?.replace(',', '.') ?? null;
  const ageAtAdministration = ageText && /^\d+(?:\.\d+)?$/.test(ageText) ? Number(ageText) : null;
  const id = createHash('sha1')
    // Before live calibration, only name/date/dose are defensible identity inputs;
    // location may change between visits or be corrected later.
    .update([vaccineName, administeredOn, dose].join('|'))
    .digest('hex')
    .slice(0, 16);
  return {
    id,
    vaccineName,
    administeredOn,
    ageAtAdministration,
    dose,
    location,
    provider: HealthFundTypes.maccabi,
  };
}

export async function scrapeVaccinationRows(page: Page): Promise<ScrapedVaccinationRow[]> {
  return page.evaluate((rowSelector) => {
    const text = (el: Element | null) => {
      const value = (el?.textContent ?? '')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return value.length > 0 ? value : null;
    };
    return Array.from(document.querySelectorAll(rowSelector)).flatMap((row) => {
      // The live timeline has no VaccineName hook. Its displayName is the member's
      // name, so a generic class*=name fallback silently stores the wrong person-facing
      // value. The vaccine itself is rendered under this CSS-module class.
      const vaccineName = text(
        row.querySelector(
          '[data-hook="VaccineName"], [class*="VaccinationsList-TimelineRow-TimelineRow__timlinearrowRow"] > div > div',
        ),
      );
      const administeredOn = text(
        row.querySelector(
          '[data-hook="VaccinationDate"], [data-hook="TimeLineDate"], [class*="date" i]',
        ),
      );
      const dose = text(row.querySelector('[data-hook="Dose"], [class*="dose" i]'));
      const location = text(row.querySelector('[data-hook="Location"], [class*="location" i]'));

      const expanded = row.querySelector('.collapse.show');
      const detailRoot = expanded?.querySelector('.d-md-block.d-none') ?? expanded;
      const administrations = detailRoot
        ? Array.from(
            detailRoot.querySelectorAll(
              '[class*="VaccinationsList-ExpandedItem-ExpandedItem__wrapExpandedItem"]',
            ),
          )
        : [];

      if (administrations.length === 0) {
        return [{ vaccineName, administeredOn, ageAtAdministration: null, dose, location }];
      }

      return administrations.map((administration, index) => {
        const detailDate = Array.from(administration.querySelectorAll('span'))
          .map((element) => text(element))
          .find((value) => value !== null && /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(value));

        return {
          vaccineName,
          // Maccabi omits the date from the first expanded wrapper because it is
          // already displayed in the collapsed timeline summary above it.
          administeredOn: detailDate ?? (index === 0 ? administeredOn : null),
          ageAtAdministration: text(
            administration.querySelector(
              '[class*="VaccinationsList-ExpandedItem-ExpandedItem__vaccineDetailBlue"]',
            ),
          ),
          dose,
          location,
        };
      });
    });
  }, selectors.vaccinationRow[0]);
}

export const maccabiVaccinationBindingDefinition = {
  bindings: [
    {
      field: 'rows',
      selector: firstSelector(selectors.vaccinationRow),
      valueFromResult: (rows: ScrapedVaccinationRow[]) => rows,
    },
    {
      field: 'vaccineName',
      selector: `${firstSelector(selectors.vaccinationRow)} [data-hook="VaccineName"], ${firstSelector(selectors.vaccinationRow)} [class*="VaccinationsList-TimelineRow-TimelineRow__timlinearrowRow"] > div > div`,
      valueFromResult: (rows: ScrapedVaccinationRow[]) => rows.map((row) => row.vaccineName),
    },
    {
      field: 'administeredOn',
      selector: `${firstSelector(selectors.vaccinationRow)} [data-hook="VaccinationDate"], ${firstSelector(selectors.vaccinationRow)} [data-hook="TimeLineDate"], ${firstSelector(selectors.vaccinationRow)} [class*="date" i]`,
      valueFromResult: (rows: ScrapedVaccinationRow[]) => rows.map((row) => row.administeredOn),
    },
  ],
  parse: scrapeVaccinationRows,
} as const;

/** Opens each vaccine group so every dated administration is present in the DOM. */
export async function expandVaccinationDetails(page: Page): Promise<void> {
  const arrowSelector =
    '[class*="VaccinationsList-TimelineRow-TimelineRow__timlinearrow___"]';
  const detailSelector =
    '.collapse.show [class*="VaccinationsList-ExpandedItem-ExpandedItem__wrapExpandedItem"]';
  const arrows = page.locator(arrowSelector);
  const count = await arrows.count();
  const expandedRows: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const arrow = arrows.nth(index);
    if (!(await arrow.isVisible())) continue;
    const row = arrow.locator('xpath=ancestor::*[@data-testid="vaccination-row"][1]');
    const button = arrow.locator('xpath=ancestor::*[@role="button"][1]');
    if ((await row.count()) > 0) expandedRows.push(row);
    if ((await button.count()) === 0 || (await button.getAttribute('aria-expanded')) !== 'true') {
      await arrow.click();
    }
  }

  if (expandedRows.length > 0) {
    const detailsRendered = await waitUntil(
      async () =>
        (
          await Promise.all(
            expandedRows.map(async (row) => (await row.locator(detailSelector).count()) > 0),
          )
        ).every(Boolean),
      5_000,
      50,
    );
    if (!detailsRendered) throw new Error('Vaccination detail rows did not finish rendering.');
  }
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
      const value = (el?.textContent ?? '')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

export const maccabiAppointmentBindingDefinition = {
  bindings: [
    {
      field: 'rows',
      selector: firstSelector(selectors.appointmentRow),
      valueFromResult: (rows: ScrapedAppointmentRow[]) => rows,
    },
    {
      field: 'dateTime',
      selector: `${firstSelector(selectors.appointmentRow)} [data-hook="TimeLineDate"]`,
      valueFromResult: (rows: ScrapedAppointmentRow[]) => rows.map(({ date, time }) => ({ date, time })),
    },
    {
      field: 'doctorName',
      selector: `${firstSelector(selectors.appointmentRow)} [class*="providerName"]`,
      valueFromResult: (rows: ScrapedAppointmentRow[]) => rows.map((row) => row.doctorName),
    },
    {
      field: 'specialty',
      selector: `${firstSelector(selectors.appointmentRow)} [class*="providerServiceType"]`,
      valueFromResult: (rows: ScrapedAppointmentRow[]) => rows.map((row) => row.specialty),
    },
  ],
  parse: scrapeAppointmentRows,
} as const;

/** Reads the clinic address and pre-visit instructions off an appointment's detail page. */
export async function scrapeAppointmentDetail(
  page: Page,
): Promise<{ clinic: string | null; instructions: string[] }> {
  return page.evaluate(
    ({ addressItem, addressTitle, addressValue, instructionItem }) => {
      const text = (el: Element | null) => {
        const value = (el?.textContent ?? '')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

export const maccabiAppointmentDetailBindingDefinition = {
  bindings: [
    {
      field: 'clinic',
      selector: firstSelector(selectors.appointmentAddressItem),
      valueFromResult: (result: Awaited<ReturnType<typeof scrapeAppointmentDetail>>) => result.clinic,
    },
    {
      field: 'instructions',
      selector: firstSelector(selectors.appointmentInstructionItem),
      valueFromResult: (result: Awaited<ReturnType<typeof scrapeAppointmentDetail>>) => result.instructions,
    },
  ],
  parse: scrapeAppointmentDetail,
} as const;

/** One test-result row as read straight from the DOM, before interpretation. */
export interface ScrapedTestResultRow {
  testName: string | null;
  /** The performance date shown on the row (e.g. "09/08/26"). */
  date: string | null;
  /** The date of the timeline entry, which can differ from the performance date. */
  timelineDate: string | null;
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
    .update([performedOn, parseIsraeliDate(row.timelineDate), testName, orderingDoctor].join('|'))
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
      const value = (el?.textContent ?? '')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
      const titleParts = [
        text(row.querySelector('[data-hook="HeaderTimeLineItem"]')),
        ...Array.from(row.querySelectorAll('[data-hook="CategoryList_item"]')).map(text),
      ].filter((part): part is string => part !== null);
      const referringDoctor = Array.from(row.querySelectorAll('li, span'))
        .map(text)
        .find((value) => value?.startsWith('רופא מפנה:'));

      return {
        testName: titleParts.length > 0 ? titleParts.join(' | ') : null,
        date:
          text(row.querySelector('[data-hook="TestExecuteDate"]')) ??
          text(row.querySelector('[data-hook="TimeLineDate"]')),
        timelineDate: text(row.querySelector('[data-hook="TimeLineDate"]')),
        orderingDoctor: referringDoctor?.replace(/^רופא מפנה:\s*/, '') ?? null,
      };
    });
  }, selectors.testResultRow[0]);
}

export const maccabiTestResultBindingDefinition = {
  bindings: [
    {
      field: 'rows',
      selector: firstSelector(selectors.testResultRow),
      valueFromResult: (rows: ScrapedTestResultRow[]) => rows,
    },
    {
      field: 'testName',
      selector: `${firstSelector(selectors.testResultRow)} [data-hook="HeaderTimeLineItem"], ${firstSelector(selectors.testResultRow)} [data-hook="CategoryList_item"]`,
      valueFromResult: (rows: ScrapedTestResultRow[]) => rows.map((row) => row.testName),
    },
    {
      field: 'date',
      selector: `${firstSelector(selectors.testResultRow)} [data-hook="TestExecuteDate"], ${firstSelector(selectors.testResultRow)} [data-hook="TimeLineDate"]`,
      valueFromResult: (rows: ScrapedTestResultRow[]) => rows.map((row) => row.date),
    },
  ],
  parse: scrapeTestResultRows,
} as const;

export interface ScrapedForm17Row {
  id: string | null;
  requestType: string | null;
  status: string | null;
  submittedOn: string | null;
  statusUpdatedOn: string | null;
  providerName: string | null;
  appointmentOn: string | null;
  documentLabels: string[];
  canChangeAppointment: boolean;
  requiresAdditionalInfo: boolean;
}

export function form17RowToRequest(row: ScrapedForm17Row): Form17Request | null {
  const id = textOrNull(row.id);
  const requestType = textOrNull(row.requestType);
  const status = textOrNull(row.status);
  if (!id || !requestType || !status) return null;

  return {
    id,
    requestType,
    status,
    submittedOn: parseIsraeliDate(row.submittedOn),
    statusUpdatedOn: parseIsraeliDate(row.statusUpdatedOn),
    providerName: textOrNull(row.providerName),
    appointmentOn: parseIsraeliDate(row.appointmentOn),
    documentLabels: row.documentLabels.map(textOrNull).filter((label): label is string => label !== null),
    canChangeAppointment: row.canChangeAppointment,
    requiresAdditionalInfo: row.requiresAdditionalInfo,
    provider: HealthFundTypes.maccabi,
  };
}

export async function scrapeForm17Rows(page: Page): Promise<ScrapedForm17Row[]> {
  // A string is intentional: the calibration CLI runs through tsx, whose esbuild
  // transform can add a private __name helper to serialized browser callbacks.
  return page.evaluate<ScrapedForm17Row[]>(`(() => {
    const rowSelector = ${JSON.stringify(selectors.form17Row[0])};
    const text = (el) => {
      const value = (el?.textContent ?? '')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return value.length > 0 ? value : null;
    };

    return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
      const summary = row.querySelector(':scope [aria-expanded] > [data-hook^="TimeLineItem__timeLineRow"]');
      const hook = summary?.getAttribute('data-hook') ?? '';
      const submittedText = Array.from(summary?.querySelectorAll('div') ?? [])
        .map(text)
        .find((value) => value?.startsWith('תאריך הגשה:'));
      const expanded = row.querySelector(':scope [aria-expanded="true"]')?.parentElement;
      const appointmentWrap = expanded?.querySelector('[class*="CaseAppointmentDate__caseAppointDateWrap"]');

      return {
        id: hook.replace(/^TimeLineItem__timeLineRow/, '') || null,
        requestType: text(summary?.querySelector('[class*="TimeLineItem-module__header"]') ?? null),
        status: text(summary?.querySelector('[class*="TimelineRow__statusstyle"]') ?? null),
        submittedOn: submittedText?.replace(/^תאריך הגשה:\s*/, '') ?? null,
        statusUpdatedOn: text(summary?.querySelector('[data-hook="TimeLineDate"]') ?? null),
        providerName: text(summary?.querySelector('[data-hook^="providername"]') ?? null),
        appointmentOn: text(appointmentWrap?.querySelector('p:last-child') ?? null),
        documentLabels: Array.from(
          expanded?.querySelectorAll('[data-hook^="Button__ButtonDocument__"]') ?? [],
        ).map(text).filter((label) => label !== null),
        canChangeAppointment: Boolean(
          expanded?.querySelector('[data-hook^="Button__editDates"]'),
        ),
        requiresAdditionalInfo:
          summary?.querySelector('[data-hook^="Badge__-IconAttention"]') !== null ||
          Boolean(expanded?.querySelector('[data-hook="ExpandedItem__uploadFiles"]')),
      };
    });
  })()`);
}

function form17RowsToRequests(rows: ScrapedForm17Row[]): Form17Request[] {
  return rows
    .map(form17RowToRequest)
    .filter((request): request is Form17Request => request !== null)
    .sort((a, b) => (b.statusUpdatedOn ?? '').localeCompare(a.statusUpdatedOn ?? ''));
}

export const maccabiForm17BindingDefinition = {
  bindings: [
    {
      field: 'rows',
      selector: firstSelector(selectors.form17Row),
      valueFromResult: (rows: ScrapedForm17Row[]) => rows,
    },
    {
      field: 'requestType',
      selector: `${firstSelector(selectors.form17Row)} [class*="TimeLineItem-module__header"]`,
      valueFromResult: (rows: ScrapedForm17Row[]) => rows.map((row) => row.requestType),
    },
    {
      field: 'statusUpdatedOn',
      selector: `${firstSelector(selectors.form17Row)} [data-hook="TimeLineDate"]`,
      valueFromResult: (rows: ScrapedForm17Row[]) => rows.map((row) => row.statusUpdatedOn),
    },
    {
      field: 'expandedDetails',
      selector: `${firstSelector(selectors.form17Row)} [role="region"][class*="ExpandedItem__wrapExpandedItem"]`,
      valueFromResult: (rows: ScrapedForm17Row[]) =>
        rows.map(({ appointmentOn, documentLabels }) => ({ appointmentOn, documentLabels })),
    },
  ],
  parse: scrapeForm17Rows,
} as const;

/** Opens every request whose detail panel is still collapsed. */
export async function expandForm17Details(page: Page): Promise<void> {
  const rows = page.locator(selectors.form17Row[0]);
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const trigger = row.locator('[aria-expanded]').first();
    if ((await trigger.count()) > 0 && (await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click();
      await row
        .locator('[role="region"][class*="ExpandedItem__wrapExpandedItem"]')
        .first()
        .waitFor({ state: 'attached' });
    }
  }
}

const maccabiLoginOptions = (): LoginOptions => ({
  loginUrl: urls.login,
  fields: () => [],
  submitButtonSelectors: selectors.submitButton,
  otpFieldSelectors: selectors.otpInput,
  possibleResults: {
    [LoginResults.AccountBlocked]: [(page) => elementExists(page, selectors.blocked)],
    [LoginResults.TwoFactorRequired]: [(page) => elementExists(page, selectors.otpInput)],
    [LoginResults.Success]: [
      /\/sonline\/homepage\//i,
      (page) => elementExists(page, selectors.loggedInMarker),
    ],
    [LoginResults.InvalidPassword]: [(page) => elementExists(page, selectors.invalidCredentials)],
  },
});

export const maccabiLoginBindingDefinition = {
  bindings: [
    {
      field: 'idInput',
      selector: anySelector(selectors.idInput),
      valueFromResult: (result: { outcome: LoginResults | null }) => result.outcome,
    },
    {
      field: 'passwordInput',
      selector: anySelector(selectors.passwordInput),
      valueFromResult: (result: { outcome: LoginResults | null }) => result.outcome,
    },
    {
      field: 'otpInput',
      selector: anySelector(selectors.otpInput),
      valueFromResult: (result: { outcome: LoginResults | null }) => result.outcome,
    },
    {
      field: 'loggedInMarker',
      selector: anySelector(selectors.loggedInMarker),
      valueFromResult: (result: { outcome: LoginResults | null }) => result.outcome,
    },
  ],
  parse: async (page: Page, sourceUrl?: string) => ({
    outcome: await matchLoginResult(maccabiLoginOptions().possibleResults, page, sourceUrl),
  }),
} as const;

/** Scrolls the lazy timeline until another scroll no longer appends rows. */
export async function loadAllTestResultRows(
  page: Page,
  quietMs = 2_000,
  timeoutMs = 30_000,
): Promise<void> {
  const rows = page.locator(selectors.testResultRow[0]);
  const deadline = Date.now() + timeoutMs;
  let count = await rows.count();
  let lastGrowth = Date.now();

  while (count > 0 && Date.now() < deadline) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const nextCount = await rows.count();
    if (nextCount > count) {
      count = nextCount;
      lastGrowth = Date.now();
    } else if (Date.now() - lastGrowth >= quietMs) {
      return;
    }
  }
}

/** Scrolls the Form 17 lazy timeline until another scroll no longer appends rows. */
export async function loadAllForm17Rows(
  page: Page,
  quietMs = 2_000,
  timeoutMs = 30_000,
): Promise<void> {
  const rows = page.locator(selectors.form17Row[0]);
  const deadline = Date.now() + timeoutMs;
  let count = await rows.count();
  let lastGrowth = Date.now();

  while (count > 0 && Date.now() < deadline) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const nextCount = await rows.count();
    if (nextCount > count) {
      count = nextCount;
      lastGrowth = Date.now();
    } else if (Date.now() - lastGrowth >= quietMs) {
      return;
    }
  }
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
        [LoginResults.Success]: [
          /\/sonline\/homepage\//i,
          (page) => elementExists(page, selectors.loggedInMarker),
        ],
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

    if (targets.includes('vaccinations')) {
      account.vaccinations = await this.fetchVaccinations();
    }

    if (targets.includes('form17')) {
      account.form17 = await this.fetchForm17();
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

  private async fetchVaccinations(): Promise<Vaccination[]> {
    const page = this.activePage;
    await page.goto(urls.vaccinations, { waitUntil: 'domcontentloaded' });
    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'vaccinations-logged-out');
      throw new SelectorDriftError('a logged-in vaccinations page', diagnostics);
    }
    await waitUntil(async () => elementExists(page, selectors.vaccinationRow), 8_000);
    await expandVaccinationDetails(page);
    const vaccinations = (await scrapeVaccinationRows(page))
      .map((row) => vaccinationRowToVaccination(row))
      .filter((vaccination): vaccination is Vaccination => vaccination !== null)
      .sort((a, b) => b.administeredOn.localeCompare(a.administeredOn));
    if (vaccinations.length === 0) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'vaccinations-empty');
      this.log('no vaccination rows found', { diagnostics });
    }
    return vaccinations;
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
    await loadAllTestResultRows(page);

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

  /** Reads Form 17 commitment requests, newest status update first. */
  private async fetchForm17(): Promise<Form17Request[]> {
    const page = this.activePage;
    await page.goto(urls.form17, { waitUntil: 'domcontentloaded' });
    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'form17-logged-out');
      throw new SelectorDriftError('a logged-in Form 17 requests page', diagnostics);
    }
    await waitUntil(async () => elementExists(page, selectors.form17Row), 8_000);
    await loadAllForm17Rows(page);
    await expandForm17Details(page);
    const requests = form17RowsToRequests(await scrapeForm17Rows(page));
    if (requests.length === 0) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'form17-empty');
      this.log('no Form 17 request rows found', { diagnostics });
    }
    return requests;
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
