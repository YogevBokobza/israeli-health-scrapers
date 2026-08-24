import { createHash } from 'node:crypto';
import type { APIResponse, Locator, Page } from 'playwright';

import {
  HealthFundTypes,
  type Appointment,
  type Form17Request,
  type HealthAccount,
  type HealthDocument,
  type Medication,
  type PastVisit,
  type ScraperCredentials,
  type TestResult,
  type TestResultKind,
  type TestResultValue,
  type Vaccination,
} from '../definitions.js';
import {
  BaseScraperWithBrowser,
  LoginResults,
  matchLoginResult,
  type LoginOptions,
  type LoginField,
} from './base-scraper-with-browser.js';
import { requestFailure, SelectorDriftError } from './errors.js';
import {
  deriveExpiry,
  normalizeText,
  parseIsraeliDate,
  parseIsraeliDateTime,
  textOrNull,
} from '../helpers/dates.js';
import { deriveReferenceStatus } from '../helpers/ranges.js';
import { clickFirst, elementExists, fillFirst, waitUntil } from '../helpers/elements.js';
import { captureDiagnostics } from '../helpers/debug.js';

/**
 * Maccabi Healthcare Services (מכבי שירותי בריאות).
 *
 * Every Maccabi-specific URL and selector lives in this file. The site will change —
 * that is a certainty, not a risk — and when it does this is the only file to edit.
 *
 * NOTE: login, medications, appointments, vaccinations, and Form 17 selectors are
 * calibrated against a live account (see git history). On failure the scraper writes an
 * HTML dump under data/diagnostics, and the fix belongs in the constants below. Test
 * results and past visits are the exceptions: they are read through the pages' own JSON
 * APIs instead of the rendered markup, for the reasons set out above those sections.
 */

const BASE_URL = 'https://online.maccabi4u.co.il';

const urls = {
  login: `${BASE_URL}/`,
  // The "all medications" tab is a dispense history — the same drug reappears every
  // time it was picked up. ValidPrescriptions is the deduplicated, currently-standing
  // view this scraper models: one row per drug with its next refill deadline.
  medications: `${BASE_URL}/sonline/medicalfile/medications/ValidPrescriptions/`,
  appointments: `${BASE_URL}/sonline/appointmentOrder/FutureAppointments/Lobby/`,
  pastVisits: `${BASE_URL}/sonline/appointmentOrder/PastVisits/Lobby/`,
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

/**
 * Test results are read through the page's own JSON API, not the DOM.
 *
 * The rendered timeline carries a name and a date and nothing else — no ids, no
 * per-entry authorization pair. The values and the document both hang off fields
 * (`request_id`, `doc_id`, `time_stamp`, `hash`) that exist only in the API response
 * the SPA itself calls, so there is no rendered element to select in the first place.
 */
const TEST_RESULTS_API = `${BASE_URL}/sonline/TestResultsAPI/webapi/mac`;

/**
 * Past visits are read through the page's own JSON API, not the DOM, for the same
 * reason as test results: the rendered lobby row carries a date, a doctor name, and a
 * specialty, and nothing else — no id, so the same visit cannot be recognized again on
 * the next fetch except by re-deriving it from fields two visits can share. The list
 * response the SPA renders from carries `appointment_id`, which is stable and unique,
 * and the summary-availability flag the later visitSummaries resource will key on.
 *
 * One detail learned from live calibration: the list holds roughly the last year of
 * visits — the page's own filter offers a year, three months, or a month, and the
 * endpoint returns what the widest of those shows. There is no older history behind it
 * to page through.
 */
const APPOINTMENT_ORDER_API = `${BASE_URL}/sonline/AppointmentOrderAPI/webapi/mac`;

const api = {
  /** Every entry on the timeline, in one call. */
  tests: (member: MaccabiMember): string => `${memberPath(TEST_RESULTS_API, member)}/tests`,
  /** The measured values behind one laboratory entry. */
  resultsById: (member: MaccabiMember): string =>
    `${memberPath(TEST_RESULTS_API, member)}/getresultsbyid`,
  /** One entry's result document. See documentUrl for the query it needs. */
  document: `${TEST_RESULTS_API}/pdf/openfile`,
  /** Every past visit the fund still holds, in one call. */
  visitHistory: (member: MaccabiMember): string =>
    `${memberPath(APPOINTMENT_ORDER_API, member)}/visits/history`,
} as const;

function memberPath(base: string, member: MaccabiMember): string {
  return `${base}/v1/members/${member.memberIdCode}/${member.memberId}`;
}

/**
 * The member id as the visit-history body wants it — a JSON number — or `null` when the
 * id could not survive that conversion.
 *
 * `memberId` is a string everywhere else in this file: the URL path (`memberPath`) and
 * the document query (`documentUrl`) both send it verbatim. Only the visit-history body
 * names the member as a number, and a bare `Number()` there is a trap. A non-numeric id
 * becomes `NaN` and a leading-zero id becomes the wrong integer — both silently — and
 * `JSON.stringify` then writes `NaN` out as `null`. The endpoint answers that malformed
 * body with an opaque 400 that reads like the bearer token drifted, pointing diagnosis at
 * exactly the wrong thing. Accepting only a canonical run of digits lets the caller fail
 * loudly, at the real cause, instead. (Israeli member ids are nine digits, well inside
 * `Number.MAX_SAFE_INTEGER`, so the conversion is lossless once the shape is known good.)
 */
export function numericMemberId(memberId: string): number | null {
  return /^[1-9][0-9]*$/.test(memberId) ? Number(memberId) : null;
}

/**
 * Who the API calls are about, plus the bearer token they are authorized with.
 *
 * The site's cookies alone get a 401 from this API: the SPA fetches a short-lived JWT
 * at start-up and sends it as `Authorization`. It keeps that token, the member id and
 * the member's sex in `sessionStorage`, which is where these are read from — the
 * alternative, decoding the JWT's own claims, would mean depending on the shape of a
 * token that is explicitly none of our business.
 *
 * Sex is not cosmetic here: the fund returns sex-specific reference ranges, so sending
 * the wrong one would return correct values against the wrong normal range.
 */
export interface MaccabiMember {
  token: string;
  memberId: string;
  memberIdCode: string;
  gender: string;
}

/** One entry as the timeline API returns it. Only the fields we read are declared. */
export interface MaccabiTestEntry {
  test_name?: string[] | null;
  test_category?: string[] | null;
  doc_id?: string | null;
  doc_type_name?: string | null;
  execute_date?: string | null;
  result_date?: string | null;
  category_name?: string | null;
  is_partial?: boolean | null;
  referrer_name?: string | null;
  request_id?: string | null;
  executing_institute?: string | null;
  type?: string | null;
  /** Present, non-empty, exactly when a downloadable document exists for the entry. */
  result_files?: { result_file?: string | null }[] | null;
  /** Together with `hash`, authorizes the document download. Minted per list response. */
  time_stamp?: string | null;
  hash?: string | null;
}

/** One measured value as the per-result API returns it. */
export interface MaccabiLabValue {
  test_id?: string | null;
  test_desc?: string | null;
  min_lim?: number | null;
  max_lim?: number | null;
  result?: number | null;
  units?: string | null;
  message?: string | null;
  is_vitek?: boolean | null;
  vitek_row?: unknown[] | null;
  message_list?: unknown[] | null;
  lab_date?: string | null;
}

export interface MaccabiLabResultGroup {
  group_name?: string | null;
  group_values?: MaccabiLabValue[] | null;
}

/**
 * How each `type` the timeline reports maps onto what can be read from the entry.
 *
 * `imaging_study` is the one that needs saying out loud: it is the films themselves,
 * held in a viewer on another site, and it carries no `result_files`. Its report — the
 * radiologist's פיענוח — arrives as a *separate* `imaging_result` entry on the same
 * day, which is the one that has a PDF.
 */
const TEST_RESULT_KINDS: Record<string, TestResultKind> = {
  lab_result: 'lab',
  imaging_result: 'document',
  external_test_result: 'document',
  imaging_study: 'imaging',
};

/** Takes the date out of the API's `2026-08-02T08:32:00` / `…+03:00` timestamps. */
function isoDateOf(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(normalizeText(value));
  return match?.[1] ?? null;
}

/**
 * Turns one timeline entry into a `TestResult`.
 *
 * Returns null for an entry with neither a name nor a category to call it by, or with
 * no identity to key it on — there is nothing useful to store about a result we can
 * neither name nor recognize again on the next fetch.
 */
export function testEntryToTestResult(entry: MaccabiTestEntry): TestResult | null {
  const type = textOrNull(entry.type);
  const requestId = textOrNull(entry.request_id);
  if (!type || !requestId) return null;

  // The fund's own identity for the result, minus the member-id segment of `doc_id`
  // (which adds nothing here and would put an id number in every stored row). Stable
  // across fetches and unique per result, which a hash of name+date+doctor was not:
  // two lab batches drawn on the same day for the same referrer are indistinguishable
  // that way and would silently collapse into one row.
  const id = `${type}::${requestId}`;

  // What the member sees on the row: the broad name, then the specific procedure —
  // "U.S | US כליות ודרכי שתן". Lab entries have only the broad name.
  const testName =
    [...(entry.test_name ?? []), ...(entry.test_category ?? [])]
      .map((part) => textOrNull(part))
      .filter((part): part is string => part !== null)
      .join(' | ') ||
    textOrNull(entry.category_name) ||
    textOrNull(entry.doc_type_name);
  if (!testName) return null;

  return {
    id,
    testName,
    performedOn: isoDateOf(entry.execute_date),
    resultedOn: isoDateOf(entry.result_date),
    orderingDoctor: textOrNull(entry.referrer_name),
    category: textOrNull(entry.category_name),
    kind: TEST_RESULT_KINDS[type] ?? 'other',
    isPartial: entry.is_partial === true,
    institute: textOrNull(entry.executing_institute),
    documentAvailable: (entry.result_files ?? []).length > 0,
    provider: HealthFundTypes.maccabi,
    raw: { type, requestId },
  };
}

/**
 * Turns one measured value into a `TestResultValue`.
 *
 * Returns null for a value with no analyte name — the name is what makes a number
 * mean anything, and a row without one cannot be compared to its own history.
 */
export function labValueToTestResultValue(
  value: MaccabiLabValue,
  groupName: string | null,
): TestResultValue | null {
  const name = textOrNull(value.test_desc);
  if (!name) return null;

  // 0 and 0 is how this fund says "no reference range for this analyte" (eGFR, for
  // instance). A genuine range that starts at zero still has a non-zero upper bound,
  // so only the pair being zero means absent — a lone `min_lim: 0` is kept.
  const bothZero = value.min_lim === 0 && value.max_lim === 0;
  const referenceMin = bothZero ? null : numberOrNull(value.min_lim);
  const referenceMax = bothZero ? null : numberOrNull(value.max_lim);

  // Qualitative analytes (urine dipsticks, mostly) come back as a message with the
  // numeric field left at 0. Reporting that 0 as the value would put a fabricated
  // measurement into every trend the analyte appears in.
  const text = textOrNull(value.message);
  const numeric = numberOrNull(value.result);
  const measured = text !== null && numeric === 0 ? null : numeric;

  const vitek = value.is_vitek === true ? value.vitek_row ?? [] : [];
  const messages = value.message_list ?? [];

  return {
    code: textOrNull(value.test_id),
    name,
    group: textOrNull(groupName),
    value: measured,
    text,
    unit: textOrNull(value.units),
    referenceMin,
    referenceMax,
    status: deriveReferenceStatus(measured, referenceMin, referenceMax),
    measuredOn: isoDateOf(value.lab_date),
    // Culture and sensitivity panels report a table this model has no shape for; it is
    // kept verbatim rather than flattened into something that reads like a measurement.
    ...(vitek.length > 0 || messages.length > 0
      ? { raw: { ...(vitek.length > 0 ? { vitek } : {}), ...(messages.length > 0 ? { messages } : {}) } }
      : {}),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Builds the download URL for an entry's document.
 *
 * Two details are load-bearing and were both learned the hard way against the live
 * site. `hash` arrives from the API already percent-encoded, so it is passed through
 * untouched — encoding it again yields a 400. `doc_id` goes in verbatim, `::` and all.
 * The hash is bound to that exact document: swapping in another `doc_id` while keeping
 * the pair is refused.
 */
export function documentUrl(member: MaccabiMember, entry: MaccabiTestEntry): string | null {
  const docId = textOrNull(entry.doc_id);
  const timeStamp = textOrNull(entry.time_stamp);
  const hash = textOrNull(entry.hash);
  if (!docId || !timeStamp || !hash) return null;

  return (
    `${api.document}?memberidcode=${member.memberIdCode}&memberid=${member.memberId}` +
    `&data=${docId}&t=${timeStamp}&hash=${encodeOnce(hash)}` +
    `&loggedInUserGender=1&currentUsergender=1` +
    `&memberIdForHeader=${member.memberId}&memberIdCodeForHeader=${member.memberIdCode}`
  );
}

/**
 * Percent-encodes a value the fund may already have percent-encoded.
 *
 * The document endpoint hands back a `hash` that is already encoded, and rejects a
 * doubly-encoded one with a 400. Encoding only what is not yet encoded keeps that from
 * being re-learned once.
 */
function encodeOnce(value: string): string {
  return /%[0-9A-Fa-f]{2}/.test(value) ? value : encodeURIComponent(value);
}

/** A sensible suggested file name for a downloaded document: dated, named, safe on every OS. */
function pdfFileName(date: string | null, label: string): string {
  const slug = label
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  return `${date ?? 'undated'} ${slug}.pdf`;
}

export function documentFileName(result: TestResult): string {
  return pdfFileName(result.performedOn, result.testName);
}

/**
 * Reads the member and bearer token the API calls need out of the SPA's session
 * storage. Returns null until the app has finished booting and put them there.
 */
export async function readMaccabiMember(page: Page): Promise<MaccabiMember | null> {
  let raw: { token: string | null; customer: string | null };
  try {
    raw = await page.evaluate(() => ({
      token: window.sessionStorage.getItem('token'),
      customer: window.sessionStorage.getItem('customerData'),
    }));
  } catch {
    // A page mid-navigation, or one on an origin with no accessible storage, is not a
    // page that has the token yet. Reported as "not ready" so the caller keeps waiting
    // and ends on its own clear timeout rather than on a DOM exception from in here.
    return null;
  }

  if (!raw.token || !raw.customer) return null;

  let info: Record<string, unknown>;
  try {
    info =
      (JSON.parse(raw.customer) as { current_customer_info?: Record<string, unknown> })
        .current_customer_info ?? {};
  } catch {
    return null;
  }

  const memberId = info.member_id;
  const memberIdCode = info.member_id_code;
  if (memberId === undefined || memberId === null || memberIdCode === undefined || memberIdCode === null) {
    return null;
  }

  return {
    token: raw.token,
    memberId: String(memberId),
    memberIdCode: String(memberIdCode),
    gender: typeof info.sex === 'string' ? info.sex : '',
  };
}

/** One past visit as the history API returns it. Only the fields we read are declared. */
export interface MaccabiVisitEntry {
  /**
   * The fund's own id for the visit. Stable across fetches and unique per visit — the
   * identity a re-fetch must recognize, and what a future visitSummaries target keys on.
   */
  appointment_id?: string | null;
  /** Local datetime of the visit ("2026-07-15T22:38:34"), no offset. */
  appointment_date?: string | null;
  /** The doctor's field, as shown on the row ("רפואת משפחה"). */
  service_name?: string | null;
  service_provider_name?: string | null;
  /** An honorific ("דר", "גב"), reported apart from the name. */
  service_provider_title?: string | null;
  /** Whether the fund holds a summary for this visit. The fund's spelling, typo included. */
  has_summery_file?: boolean | null;
  /** How the member was identified. See DIGITAL_VISIT_IDENTIFICATION. */
  identification_method?: number | null;
  /**
   * The clinic the visit took place at, as an opaque id. The list API exposes no
   * location name — this id is the only location datum it carries, so it is kept in
   * `raw` rather than interpreted or dropped.
   */
  facility_id?: string | null;
}

/**
 * The `identification_method` of a digital visit — an online exchange with the doctor
 * rather than a visit in a clinic. The fund does not document the code→meaning mapping,
 * so it was verified rather than assumed (2026-08-24, live account, a full year's lobby):
 * every "ביקור דיגיטלי"-badged row carried code 4 and every code-4 row was badged — the
 * digital-badge count equalled the code-4 count exactly — while the non-digital rows
 * carried other codes (1, 2, and 7 were seen). So 4 is digital, exclusively, on the
 * account checked; the mapping is confirmed, not merely calibrated against one login.
 *
 * The mapping is still the fund's undocumented one, and a code never seen could yet be
 * digital, so the audit that verified it stays wired for drift: `raw.identificationMethod`
 * keeps the underlying code on every visit, `fetchPastVisits` logs the whole lobby's code
 * distribution via {@link summarizeIdentificationMethods} on each run, and the calibration
 * tool (`tools/calibrate/identification-audit.ts`) re-runs the badge/code cross-check on a
 * live account. A future digital visit on an unseen code would show up there as a
 * badge-count that no longer matches, instead of shipping `isDigital: false` in silence.
 */
export const DIGITAL_VISIT_IDENTIFICATION = 4;

/** One `identification_method` code and how many lobby entries carried it. */
export interface IdentificationMethodTally {
  /** The fund's code, or null for an entry that carried none. */
  code: number | null;
  count: number;
}

/**
 * Tallies the distinct `identification_method` codes across a lobby's entries.
 *
 * The audit behind {@link DIGITAL_VISIT_IDENTIFICATION}: that constant is one calibrated
 * code against an undocumented mapping, so a code that never went through calibration has
 * to be *visible* rather than silently collapsing into `isDigital: false`. Sorted most
 * common first, ties broken by code; an entry with no code sorts last.
 */
export function summarizeIdentificationMethods(
  entries: readonly Pick<MaccabiVisitEntry, 'identification_method'>[],
): IdentificationMethodTally[] {
  const counts = new Map<number | null, number>();
  for (const entry of entries) {
    const code =
      typeof entry.identification_method === 'number' ? entry.identification_method : null;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => {
      // A codeless entry sorts last regardless of how common it is — the tally is read to
      // spot codes, and "no code" is the one row that names none.
      if (a.code === null) return 1;
      if (b.code === null) return -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.code - b.code;
    });
}

/**
 * Turns one history entry into a `PastVisit`.
 *
 * Returns null for an entry with no appointment id — that id is both how the visit is
 * recognized again on the next fetch and what the later visitSummaries resource will
 * ask for, so an entry without one is not a visit anything can be done with.
 */
export function visitEntryToPastVisit(entry: MaccabiVisitEntry): PastVisit | null {
  const id = textOrNull(entry.appointment_id);
  if (!id) return null;

  const name = textOrNull(entry.service_provider_name);
  const title = textOrNull(entry.service_provider_title);
  const identification =
    typeof entry.identification_method === 'number' ? entry.identification_method : null;
  const facilityId = textOrNull(entry.facility_id);
  // Evidence for derived or unmapped fields: identificationMethod backs isDigital (a
  // mapping of the fund's codes, not a field it hands over), and facilityId is the only
  // location datum the list carries (see MaccabiVisitEntry).
  const raw = {
    ...(identification !== null ? { identificationMethod: identification } : {}),
    ...(facilityId !== null ? { facilityId } : {}),
  };

  return {
    id,
    visitedAt: visitDateTime(entry.appointment_date),
    // Reported as two fields and shown as one. Joined rather than dropped: a bare
    // "לב-ארי שרונה" is not how a member recognizes their doctor on a list.
    doctorName: name && title ? `${title} ${name}` : name,
    specialty: textOrNull(entry.service_name),
    isDigital: identification === DIGITAL_VISIT_IDENTIFICATION,
    summaryAvailable: entry.has_summery_file === true,
    provider: HealthFundTypes.maccabi,
    ...(Object.keys(raw).length > 0 ? { raw } : {}),
  };
}

/**
 * Normalizes the API's offset-less local datetime into an offset-explicit ISO one.
 *
 * The wall-clock time is kept exactly as the member saw it; the shared datetime parser
 * attaches the correct Israel offset (+03:00 in DST, +02:00 out of it) for the date,
 * same convention as the appointments model. Seconds are dropped with it — minute
 * precision is what every rendered time carries.
 */
function visitDateTime(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(normalizeText(value));
  return match ? parseIsraeliDateTime(match[1], match[2]) : null;
}

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

    // testResultDetails is testResults plus a per-entry fetch, so asking for both is
    // asking for the expensive one — not for the same timeline twice.
    if (targets.includes('testResults') || targets.includes('testResultDetails')) {
      account.testResults = await this.fetchTestResults(targets.includes('testResultDetails'));
    }

    if (targets.includes('vaccinations')) {
      account.vaccinations = await this.fetchVaccinations();
    }

    if (targets.includes('form17')) {
      account.form17 = await this.fetchForm17();
    }

    if (targets.includes('pastVisits')) {
      account.pastVisits = await this.fetchPastVisits();
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

  /**
   * Reads past test results, newest first.
   *
   * With `withDetails`, each laboratory entry's measured values and each entry's
   * result document are fetched too — one request per result, so tens of requests
   * rather than one. That is why it is a separate fetch target.
   */
  private async fetchTestResults(withDetails: boolean): Promise<TestResult[]> {
    const page = this.activePage;
    await page.goto(urls.testResults, { waitUntil: 'domcontentloaded' });

    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-logged-out');
      throw new SelectorDriftError('a logged-in test results page', diagnostics);
    }

    // The app writes its bearer token to session storage while booting; domcontentloaded
    // fires well before that — the same race the rendered rows had.
    let member: MaccabiMember | null = null;
    await waitUntil(async () => {
      member = await readMaccabiMember(page);
      return member !== null;
    }, 15_000);

    if (!member) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-no-token');
      throw new SelectorDriftError(
        "the test-results API token in the page's session storage",
        diagnostics,
      );
    }

    // Each result is kept paired with the entry it came from: the detail fetch needs
    // that entry's request/document parameters, and pairing them here is what keeps the
    // two from being re-matched later by re-deriving the id a second way.
    const scraped = (await this.fetchTestResultEntries(member))
      .map((entry) => ({ entry, result: testEntryToTestResult(entry) }))
      .filter((pair): pair is { entry: MaccabiTestEntry; result: TestResult } => pair.result !== null);

    const testResults = scraped.map((pair) => pair.result);

    if (testResults.length === 0) {
      // Same reasoning as fetchMedications: an empty history and a response we failed to
      // read look identical, so a dump is kept without treating "none" as an error.
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-empty');
      this.log('no test results returned', { diagnostics });
    }

    // Newest first — that is the order the question is actually asked in. Unknown dates
    // sort last rather than masquerading as recent.
    testResults.sort((a, b) => (b.performedOn ?? '').localeCompare(a.performedOn ?? ''));

    if (withDetails) await this.fetchTestResultDetails(member, scraped);

    return testResults;
  }

  /** The whole timeline in one call — no scrolling, no per-row clicking. */
  private async fetchTestResultEntries(member: MaccabiMember): Promise<MaccabiTestEntry[]> {
    const page = this.activePage;
    const response = await this.apiRequest('the test-results list', () =>
      page.request.post(api.tests(member), {
        headers: this.apiHeaders(member),
        data: {
          members: [],
          categories: [],
          logged_user_gender: member.gender,
          current_user_gender: member.gender,
        },
      }),
    );

    if (!response.ok()) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-list-failed');
      throw new SelectorDriftError(
        `a test-results list (the API answered ${response.status()})`,
        diagnostics,
      );
    }

    const body = (await response.json().catch(() => null)) as {
      tests?: MaccabiTestEntry[];
    } | null;

    // A 200 whose body is not a list of tests is drift, not an empty history. Saying so
    // is the difference between "you have no test results" and "we could not read them".
    if (!Array.isArray(body?.tests)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'testresults-list-shape');
      throw new SelectorDriftError('a `tests` array in the test-results API response', diagnostics);
    }

    return body.tests;
  }

  /**
   * Fills in each result's values and document, in place.
   *
   * Best-effort per result, like the appointment detail page: one lab batch the fund
   * refuses to expand, or one document that will not download, is logged and skipped
   * rather than losing the other seventy. The entries are walked one at a time — this
   * is a member's own account, and firing sixty concurrent requests at it to save a
   * minute on a fetch nobody is watching is not a trade worth making.
   */
  private async fetchTestResultDetails(
    member: MaccabiMember,
    scraped: { entry: MaccabiTestEntry; result: TestResult }[],
  ): Promise<void> {
    const since = this.options.testResultDetailsSince;

    for (const { entry, result } of scraped) {
      if (since && (result.performedOn ?? '') < since) continue;

      if (result.kind === 'lab') {
        const values = await this.fetchLabValues(member, entry);
        if (values) result.values = values;
      }

      if (result.documentAvailable) {
        const document = await this.fetchTestResultDocument(member, entry, result);
        if (document) result.document = document;
      }
    }
  }

  private async fetchLabValues(
    member: MaccabiMember,
    entry: MaccabiTestEntry,
  ): Promise<TestResultValue[] | null> {
    // Best-effort, as the caller's comment promises: a transport failure on one batch
    // skips that batch rather than aborting a fetch that has already collected seventy.
    const response = await this.apiRequest('a lab result', () =>
      this.activePage.request.post(api.resultsById(member), {
        headers: this.apiHeaders(member),
        data: {
          request_id: entry.request_id,
          doc_id: entry.doc_id,
          logged_user_gender: member.gender,
          current_user_gender: member.gender,
        },
      }),
    ).catch((error: unknown) => {
      this.log('could not reach a lab result', {
        requestId: entry.request_id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    if (!response) return null;

    if (!response.ok()) {
      this.log('could not read a lab result', {
        requestId: entry.request_id,
        status: response.status(),
      });
      return null;
    }

    const body = (await response.json().catch(() => null)) as {
      results?: MaccabiLabResultGroup[];
    } | null;

    // Only an actual array of groups means "this is the fund's answer". A 200 carrying
    // something else — a renamed or re-nested field, an error object, the browser-facing
    // error page this endpoint's sibling is known to return with a 200 — must report
    // "not read", never an empty list: a consumer is entitled to treat an empty list as
    // "the fund has no values for this batch" and drop the ones it already had.
    if (!Array.isArray(body?.results)) {
      this.log('a lab result came back in an unrecognized shape', {
        requestId: entry.request_id,
        status: response.status(),
        contentType: response.headers()['content-type'],
      });
      return null;
    }

    return body.results.flatMap((group) =>
      (group.group_values ?? [])
        .map((value) => labValueToTestResultValue(value, group.group_name ?? null))
        .filter((value): value is TestResultValue => value !== null),
    );
  }

  private async fetchTestResultDocument(
    member: MaccabiMember,
    entry: MaccabiTestEntry,
    result: TestResult,
  ): Promise<HealthDocument | null> {
    const url = documentUrl(member, entry);
    if (!url) {
      this.log('a result document has no download parameters', { id: result.id });
      return null;
    }

    return this.fetchPdf('a result document', url, member, documentFileName(result), {
      id: result.id,
    });
  }

  /**
   * Downloads one document and decides whether what came back is one.
   *
   * The trap here is that the endpoint answers a browser-facing error page with a 200
   * for a rejected hash, so the file's own magic number decides whether this is a
   * document, not the status. Best-effort like every other per-entry fetch: one document
   * that will not download is logged and skipped, not raised over the whole run.
   */
  private async fetchPdf(
    what: string,
    url: string,
    member: MaccabiMember,
    fileName: string,
    context: Record<string, unknown>,
  ): Promise<HealthDocument | null> {
    const response = await this.apiRequest(what, () =>
      this.activePage.request.get(url, { headers: { authorization: `Bearer ${member.token}` } }),
    ).catch((error: unknown) => {
      this.log(`could not reach ${what}`, {
        ...context,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    if (!response) return null;

    const body = response.ok() ? await response.body() : Buffer.alloc(0);

    if (body.subarray(0, 5).toString('latin1') !== '%PDF-') {
      this.log(`${what} did not come back as a PDF`, {
        ...context,
        status: response.status(),
        contentType: response.headers()['content-type'],
      });
      return null;
    }

    return {
      fileName,
      contentType: 'application/pdf',
      byteLength: body.length,
      content: body.toString('base64'),
    };
  }

  /**
   * Sends one API request, converting a transport failure into an error stripped of the
   * credentials Playwright puts in its call log (see `requestFailure`). Every
   * authenticated request in this file goes through here — the bearer token is in each
   * one's headers, and the member id is in each one's URL.
   */
  private async apiRequest(what: string, send: () => Promise<APIResponse>): Promise<APIResponse> {
    try {
      return await send();
    } catch (error) {
      throw requestFailure(what, error);
    }
  }

  private apiHeaders(member: MaccabiMember): Record<string, string> {
    return {
      authorization: `Bearer ${member.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
    };
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

  /**
   * Reads past visits, newest first.
   *
   * The lobby's own filter caps the fund's history at about a year; there is no older
   * page behind it (see the section comment above the visits API).
   */
  private async fetchPastVisits(): Promise<PastVisit[]> {
    const page = this.activePage;
    await page.goto(urls.pastVisits, { waitUntil: 'domcontentloaded' });

    if (await elementExists(page, selectors.passwordInput)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-logged-out');
      throw new SelectorDriftError('a logged-in past visits page', diagnostics);
    }

    // Same race as the test-results page: the app writes its bearer token to session
    // storage while booting, well after domcontentloaded.
    let member: MaccabiMember | null = null;
    await waitUntil(async () => {
      member = await readMaccabiMember(page);
      return member !== null;
    }, 15_000);

    if (!member) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-no-token');
      throw new SelectorDriftError(
        "the past visits API token in the page's session storage",
        diagnostics,
      );
    }

    const entries = await this.fetchPastVisitEntries(member);

    // The audit signal behind isDigital (see DIGITAL_VISIT_IDENTIFICATION): the whole
    // lobby's identification_method distribution, logged so a code that never went
    // through calibration surfaces in the run log instead of silently shipping as
    // isDigital: false. raw.identificationMethod keeps each visit's own code besides.
    if (entries.length > 0) {
      this.log('past visits identification_method distribution', {
        codes: summarizeIdentificationMethods(entries),
      });
    }

    const pastVisits = entries
      .map((entry) => visitEntryToPastVisit(entry))
      .filter((visit): visit is PastVisit => visit !== null);

    // Entries came back but none carried an appointment id: the id field has drifted,
    // and returning an empty year would report "no visits" over data the fund did send.
    // The fund's own identity is this target's whole reason for being API-read, so this
    // drift is an error, not a log line — unlike a genuinely empty list, which isn't.
    if (entries.length > 0 && pastVisits.length === 0) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-unparsed');
      throw new SelectorDriftError('an `appointment_id` on the past visits entries', diagnostics);
    }

    if (pastVisits.length === 0) {
      // Same reasoning as fetchMedications: an empty history and a response we failed to
      // read look identical, so a dump is kept without treating "none" as an error.
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-empty');
      this.log('no past visits returned', { diagnostics });
    }
    // Newest first — that is the order the question is actually asked in. Unknown times
    // sort last rather than masquerading as recent.
    pastVisits.sort((a, b) => (b.visitedAt ?? '').localeCompare(a.visitedAt ?? ''));

    return pastVisits;
  }

  /** The whole lobby in one call — no scrolling, no per-row clicking. */
  private async fetchPastVisitEntries(member: MaccabiMember): Promise<MaccabiVisitEntry[]> {
    const page = this.activePage;

    // Every other call site sends memberId as the string it is; only this body wants a
    // number. Guard the conversion so a non-numeric or leading-zero id fails here — in
    // the error envelope, with a dump — instead of going out as a `null` member and
    // coming back as an opaque 400 that would read like the token had drifted.
    const memberId = numericMemberId(member.memberId);
    if (memberId === null) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-member-id');
      throw new SelectorDriftError(
        'a numeric member id for the past visits request (session storage held a non-numeric one)',
        diagnostics,
      );
    }

    const response = await this.apiRequest('the past visits list', () =>
      page.request.post(api.visitHistory(member), {
        headers: this.apiHeaders(member),
        data: {
          // The site names the member in the body as well as in the URL. Sent the same
          // way rather than working out which of the two the endpoint actually reads.
          members: [{ member_id_code: member.memberIdCode, member_id: memberId }],
        },
      }),
    );

    if (!response.ok()) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-list-failed');
      throw new SelectorDriftError(
        `a past visits list (the API answered ${response.status()})`,
        diagnostics,
      );
    }

    const body = (await response.json().catch(() => null)) as {
      results?: MaccabiVisitEntry[];
    } | null;

    // A 200 whose body is not a list of visits is drift, not an empty history — the same
    // distinction the test-results list makes, and for the same reason.
    if (!Array.isArray(body?.results)) {
      const diagnostics = await captureDiagnostics(page, this.options.companyId, 'pastvisits-list-shape');
      throw new SelectorDriftError('a `results` array in the past visits API response', diagnostics);
    }

    return body.results;
  }
}
