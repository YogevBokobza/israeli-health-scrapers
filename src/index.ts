/**
 * israeli-health-scrapers — scrapers for Israeli health funds (kupot holim).
 *
 * A library, in the shape of israeli-bank-scrapers: one `createScraper` factory per
 * fund, one uniform result shape, one folder per fund. It knows how to talk to a fund
 * and nothing else — storage, permissions, agent protocols and CLIs belong to the
 * consumer (see health-mcp).
 */

export { createScraper, SCRAPERS, IMPLEMENTED_FUNDS, enabledFunds } from './scrapers/factory.js';
export type { Scraper } from './scrapers/interface.js';

export { BaseScraper } from './scrapers/base-scraper.js';
export {
  BaseScraperWithBrowser,
  LoginResults,
  matchLoginResult,
} from './scrapers/base-scraper-with-browser.js';
export type {
  LoginOptions,
  LoginField,
  LoginCondition,
  PossibleLoginResults,
} from './scrapers/base-scraper-with-browser.js';

export { MaccabiScraper } from './scrapers/maccabi.js';
export { MockScraper } from './scrapers/mock.js';

export {
  ScraperError,
  SelectorDriftError,
  TwoFactorRetrieverMissingError,
  TimeoutError,
} from './scrapers/errors.js';

export {
  HealthFundTypes,
  ScraperErrorTypes,
  ScraperProgressTypes,
  FETCH_TARGETS,
  medicationSchema,
  appointmentSchema,
  messageSchema,
  referenceStatusSchema,
  testResultValueSchema,
  documentSchema,
  testResultKindSchema,
  testResultSchema,
  vaccinationSchema,
  form17RequestSchema,
  pastVisitSchema,
  healthAccountSchema,
  providerIdSchema,
} from './definitions.js';
export type {
  HealthFundId,
  ScraperCredentials,
  ScraperOptions,
  ScraperMetadata,
  ScraperScrapingResult,
  ScraperLoginResult,
  HealthAccount,
  Medication,
  MedicationStatus,
  Appointment,
  Message,
  ReferenceStatus,
  TestResultValue,
  HealthDocument,
  TestResultKind,
  TestResult,
  Vaccination,
  Form17Request,
  PastVisit,
  FetchTarget,
  LoginMethod,
} from './definitions.js';

export { EXPIRING_SOON_DAYS } from './constants.js';

export { deriveExpiry, parseIsraeliDate, parseInteger, normalizeText } from './helpers/dates.js';
export { deriveReferenceStatus } from './helpers/ranges.js';
export { loadSession, saveSession, clearSession } from './helpers/session.js';
export { dataRoot, sessionPath, diagnosticsDir } from './helpers/paths.js';
