import { z } from 'zod';
import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Shared types for the whole library, mirroring the layout of israeli-bank-scrapers:
 * one definitions module that both the scrapers and the consumers import from.
 */

/** The health funds (kupot holim). Values double as scraper ids and scope segments. */
export enum HealthFundTypes {
  maccabi = 'maccabi',
  clalit = 'clalit',
  meuhedet = 'meuhedet',
  leumit = 'leumit',
  /** Fixture-backed fund used by the contract tests. Never enabled by default. */
  mock = 'mock',
}

export type HealthFundId = `${HealthFundTypes}`;

export interface ScraperCredentials {
  /** Israeli ID number (תעודת זהות) — the username at every fund. */
  id: string;
  password?: string;
}

/** What a fund needs in order to log a member in. Drives UI and agent prompts. */
export interface ScraperMetadata {
  name: string;
  loginFields: (keyof ScraperCredentials)[];
  /** Ordered by preference: the first is what the fund's members normally use. */
  loginMethods: LoginMethod[];
}

export type LoginMethod = 'otp' | 'password';

export enum ScraperProgressTypes {
  Initializing = 'INITIALIZING',
  StartScraping = 'START_SCRAPING',
  LoggingIn = 'LOGGING_IN',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailed = 'LOGIN_FAILED',
  ChangePassword = 'CHANGE_PASSWORD',
  ScrapingData = 'SCRAPING_DATA',
  Terminating = 'TERMINATING',
  EndScraping = 'END_SCRAPING',
}

export interface ScraperOptions {
  companyId: HealthFundId;

  /** Show the browser window. Required to solve a CAPTCHA or an unexpected consent screen. */
  showBrowser?: boolean;
  verbose?: boolean;
  /** Per-navigation timeout in ms. */
  timeout?: number;

  /** Reuse an existing browser rather than launching one. */
  browser?: Browser;
  browserContext?: BrowserContext;
  /** Do not close a browser that was passed in. */
  skipCloseBrowser?: boolean;
  executablePath?: string;
  args?: string[];

  /**
   * Persist and reuse the login session between runs, so an OTP fund does not send an
   * SMS on every single call. On by default — without it an OTP-only account is
   * effectively unusable for automation.
   */
  storeSession?: boolean;

  /**
   * Supplies the one-time code. Called only when the fund actually asks for one.
   *
   * A callback rather than a parameter because the code does not exist yet when the
   * scrape is started — it arrives by SMS seconds later.
   */
  otpCodeRetriever?: () => Promise<string>;

  /** Long-term token from a previous `getLongTermTwoFactorToken`, to skip the SMS. */
  otpLongTermToken?: string;

  /** Which parts of the account to fetch. Defaults to medications only. */
  fetch?: FetchTarget[];

  /**
   * With `testResultDetails`, only fetch the values and documents of results performed
   * on or after this ISO date. The timeline itself is always returned in full — this
   * bounds only the expensive per-result work, so a caller refreshing weekly does not
   * re-download a decade of history every time.
   */
  testResultDetailsSince?: string;

  onProgress?: (companyId: HealthFundId, type: ScraperProgressTypes) => void;
}

/**
 * The fetchable parts of an account. A runtime array, not just a type, so callers
 * outside this module (the calibration tool's manifest) can enumerate the closed set
 * instead of hand-duplicating it.
 */
export const FETCH_TARGETS = [
  'medications',
  'appointments',
  'messages',
  'testResults',
  /**
   * The timeline plus, per entry, the measured values (lab results) or the result
   * document (imaging and other report-backed results). Its own target rather than a
   * flag on `testResults` because it costs one request per result instead of one in
   * total.
   */
  'testResultDetails',
  'vaccinations',
  'form17',
] as const;
export type FetchTarget = (typeof FETCH_TARGETS)[number];

/* -------------------------------------------------------------------------- */
/* The unified data model                                                      */
/* -------------------------------------------------------------------------- */

export const providerIdSchema = z.nativeEnum(HealthFundTypes);

/** ISO date (YYYY-MM-DD). Funds render Hebrew day-first dates; scrapers normalize. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');

export const medicationStatusSchema = z.enum(['active', 'expiring_soon', 'expired', 'unknown']);
export type MedicationStatus = z.infer<typeof medicationStatusSchema>;

export const medicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().nullable(),
  form: z.string().nullable(),
  prescribedBy: z.string().nullable(),
  lastDispensed: isoDateSchema.nullable(),
  /** When the standing prescription stops being valid. */
  validUntil: isoDateSchema.nullable(),
  refillsRemaining: z.number().int().nonnegative().nullable(),
  /**
   * Days until `validUntil`; negative once expired, null when unknown. Derived in the
   * shared helper so every fund answers "is this about to run out" identically and no
   * caller has to parse a Hebrew date.
   */
  daysUntilExpiry: z.number().int().nullable(),
  status: medicationStatusSchema,
  /**
   * Whether this is a standing prescription (תרופה קבועה) rather than a one-off. A
   * fund's valid-prescriptions view can list both; this flag lets a caller keep the
   * one-off rows and filter to standing ones itself instead of the scraper dropping
   * them. Funds with no such distinction report every prescription as standing.
   */
  isStanding: z.boolean(),
  provider: providerIdSchema,
  /** Source fields we did not map. For debugging; never relied on by callers. */
  raw: z.record(z.unknown()).optional(),
});
export type Medication = z.infer<typeof medicationSchema>;

export const appointmentSchema = z.object({
  id: z.string(),
  /** ISO datetime with an explicit offset (e.g. +03:00) — Israel local time, not UTC. */
  start: z.string().datetime({ offset: true }),
  doctorName: z.string().nullable(),
  specialty: z.string().nullable(),
  clinic: z.string().nullable(),
  provider: providerIdSchema,
  raw: z.record(z.unknown()).optional(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const messageSchema = z.object({
  id: z.string(),
  subject: z.string().nullable(),
  from: z.string().nullable(),
  sentAt: z.string().datetime(),
  unread: z.boolean(),
  provider: providerIdSchema,
  raw: z.record(z.unknown()).optional(),
});
export type Message = z.infer<typeof messageSchema>;

/**
 * Where a measured value sits relative to its reference range.
 *
 * Derived in a shared helper (`deriveReferenceStatus`) rather than per fund, for the
 * same reason `deriveExpiry` is shared: "was this result abnormal" has to mean the same
 * thing everywhere, and no caller should be comparing numbers to parse a range itself.
 */
export const referenceStatusSchema = z.enum(['below', 'within', 'above', 'unknown']);
export type ReferenceStatus = z.infer<typeof referenceStatusSchema>;

/** One measured quantity inside a laboratory result — an analyte and its value. */
export const testResultValueSchema = z.object({
  /** The fund's own code for this analyte, stable across results. Null when unnamed. */
  code: z.string().nullable(),
  name: z.string().min(1),
  /** The panel this analyte was reported under ("כימיה בדם"). */
  group: z.string().nullable(),
  /** The measured number, when the result is numeric. */
  value: z.number().nullable(),
  /**
   * The result as text, for qualitative analytes ("NEGATIVE") and for anything the fund
   * reports as a note rather than a number. Kept separate from `value` so a qualitative
   * result is never mistaken for a numeric zero.
   */
  text: z.string().nullable(),
  unit: z.string().nullable(),
  referenceMin: z.number().nullable(),
  referenceMax: z.number().nullable(),
  status: referenceStatusSchema,
  /** ISO date this individual analyte was measured; can differ from the batch's date. */
  measuredOn: isoDateSchema.nullable(),
  raw: z.record(z.unknown()).optional(),
});
export type TestResultValue = z.infer<typeof testResultValueSchema>;

/**
 * A record a fund hands back as a file rather than as fields — an imaging report, a
 * bone density report, any result document.
 *
 * Carried as bytes, not written to disk: this library owns no storage beyond session
 * cookies, so where a member's medical documents end up is the consumer's decision.
 */
export const documentSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  byteLength: z.number().int().positive(),
  /** base64-encoded file content. */
  content: z.string().min(1),
});
export type HealthDocument = z.infer<typeof documentSchema>;

/**
 * What kind of result an entry is, which decides what can be read from it.
 *
 * `lab` carries measured values; `document` is a report available as a file; `imaging`
 * is a study (the films themselves) that the fund only shows in its own viewer, so it
 * has a date and a name but nothing this library can hand back; `other` is an entry
 * whose kind the scraper did not recognize, kept rather than dropped.
 */
export const testResultKindSchema = z.enum(['lab', 'document', 'imaging', 'other']);
export type TestResultKind = z.infer<typeof testResultKindSchema>;

/**
 * One dated entry on a fund's test-results timeline: a laboratory batch, an imaging
 * report, or another category rather than an individual laboratory analyte.
 *
 * `values` and `document` are populated only by the `testResultDetails` fetch target —
 * absent means "not fetched", which is different from `documentAvailable: false`
 * ("the fund has no file for this entry").
 */
export const testResultSchema = z.object({
  id: z.string(),
  testName: z.string().min(1),
  /** ISO date (YYYY-MM-DD) the test was performed. */
  performedOn: isoDateSchema.nullable(),
  /** ISO date the result was issued, which can be days after it was performed. */
  resultedOn: isoDateSchema.nullable(),
  orderingDoctor: z.string().nullable(),
  /** The fund's category for the entry ("מעבדה", "אולטרסאונד"). */
  category: z.string().nullable(),
  kind: testResultKindSchema,
  /** The fund flags a batch whose remaining values have not been reported yet. */
  isPartial: z.boolean(),
  /** Who performed it, when the fund says (usually only for outsourced tests). */
  institute: z.string().nullable(),
  /** Whether a downloadable file exists for this entry, fetched or not. */
  documentAvailable: z.boolean(),
  provider: providerIdSchema,
  values: z.array(testResultValueSchema).optional(),
  document: documentSchema.optional(),
  raw: z.record(z.unknown()).optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const vaccinationSchema = z.object({
  id: z.string(),
  vaccineName: z.string().min(1),
  administeredOn: isoDateSchema,
  /** Member age in years when this administration was recorded by the fund. */
  ageAtAdministration: z.number().nonnegative().nullable(),
  dose: z.string().nullable(),
  location: z.string().nullable(),
  provider: providerIdSchema,
  raw: z.record(z.unknown()).optional(),
});
export type Vaccination = z.infer<typeof vaccinationSchema>;

export const form17RequestSchema = z.object({
  id: z.string().min(1),
  requestType: z.string().min(1),
  status: z.string().min(1),
  submittedOn: isoDateSchema.nullable(),
  statusUpdatedOn: isoDateSchema.nullable(),
  providerName: z.string().nullable(),
  appointmentOn: isoDateSchema.nullable(),
  documentLabels: z.array(z.string().min(1)),
  canChangeAppointment: z.boolean().nullable(),
  requiresAdditionalInfo: z.boolean().nullable(),
  provider: providerIdSchema,
  raw: z.record(z.unknown()).optional(),
});
export type Form17Request = z.infer<typeof form17RequestSchema>;

/**
 * One member's account at one fund — the analogue of an `account` in the bank
 * scrapers, holding the collections we know how to read.
 */
export const healthAccountSchema = z.object({
  provider: providerIdSchema,
  medications: z.array(medicationSchema),
  appointments: z.array(appointmentSchema).optional(),
  messages: z.array(messageSchema).optional(),
  testResults: z.array(testResultSchema).optional(),
  vaccinations: z.array(vaccinationSchema).optional(),
  form17: z.array(form17RequestSchema).optional(),
});
export type HealthAccount = z.infer<typeof healthAccountSchema>;

/**
 * The scrape result envelope.
 *
 * Following the bank scrapers, a failed scrape is a returned value rather than a
 * thrown error: callers loop over several funds and one being down should not abort
 * the rest.
 */
export interface ScraperScrapingResult {
  success: boolean;
  accounts?: HealthAccount[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string;
}

export interface ScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string;
}

export enum ScraperErrorTypes {
  InvalidPassword = 'INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  /** The fund asked for an SMS code and no `otpCodeRetriever` was supplied. */
  TwoFactorRetrieverMissing = 'TWO_FACTOR_RETRIEVER_MISSING',
  /** The page loaded but did not look the way the scraper expects — markup changed. */
  SelectorDrift = 'SELECTOR_DRIFT',
  Timeout = 'TIMEOUT',
  Generic = 'GENERIC',
  General = 'GENERAL_ERROR',
}

export interface ScraperPageContext {
  page: Page;
  companyId: HealthFundId;
}
