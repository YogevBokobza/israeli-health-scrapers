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

  onProgress?: (companyId: HealthFundId, type: ScraperProgressTypes) => void;
}

export type FetchTarget = 'medications' | 'appointments' | 'messages' | 'testResults';

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
 * A lab/imaging test result. A dated event, not a standing record with an expiry — no
 * status enum, unlike medications. Anything the page shows that this schema doesn't model
 * (result value, units, reference range, normal/abnormal) is carried in `raw` so a
 * calibration pass can promote the real columns to first-class fields without a breaking
 * change to the field list.
 */
export const testResultSchema = z.object({
  id: z.string(),
  testName: z.string().min(1),
  /** ISO date (YYYY-MM-DD) the test was performed. */
  performedOn: isoDateSchema.nullable(),
  orderingDoctor: z.string().nullable(),
  provider: providerIdSchema,
  raw: z.record(z.unknown()).optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;

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
