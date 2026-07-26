/**
 * israeli-health-scrapers — typed, permission-scoped access to Israeli health fund
 * (kupat holim) personal accounts.
 *
 * Modelled on israeli-bank-scrapers: a `createScraper` factory per fund behind one
 * uniform result shape. The MCP server under `src/mcp` is a consumer of this library,
 * not the other way round, so the same code serves a personal script, a cron job that
 * warns about an expiring prescription, and an AI agent.
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
  medicationSchema,
  appointmentSchema,
  messageSchema,
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
  FetchTarget,
  LoginMethod,
} from './definitions.js';

export { EXPIRING_SOON_DAYS } from './constants.js';

export { allOperations, operationsFor, findOperation } from './operations.js';
export type { Operation, OperationContext, ListMedicationsInput } from './operations.js';

export {
  PermissionEngine,
  PermissionDeniedError,
  ConfirmationRequiredError,
  RateLimitedError,
} from './permissions/engine.js';
export { loadPolicyFile, resolvePolicy, DEFAULT_POLICY } from './permissions/config.js';
export type { PolicyFile, PolicyProfile, ResolvedPolicy } from './permissions/config.js';
export { scope, scopeMatches, anyScopeMatches } from './permissions/scopes.js';
export type { Scope, Resource, Capability } from './permissions/scopes.js';

export { deriveExpiry, parseIsraeliDate, parseInteger, normalizeText } from './helpers/dates.js';
export { credentialsFromEnv } from './helpers/credentials.js';
export { loadSession, saveSession, clearSession } from './helpers/session.js';
