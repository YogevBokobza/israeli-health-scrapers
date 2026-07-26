import {
  HealthFundTypes,
  type HealthFundId,
  type ScraperMetadata,
  type ScraperOptions,
} from '../definitions.js';
import type { Scraper } from './interface.js';
import { MaccabiScraper } from './maccabi.js';
import { MockScraper } from './mock.js';

/**
 * Metadata for every fund, keyed by id — the analogue of the bank scrapers' `SCRAPERS`
 * export. A caller can read which credentials a fund needs, and how it authenticates,
 * without constructing a scraper or opening a browser.
 */
export const SCRAPERS: Record<HealthFundId, ScraperMetadata> = {
  [HealthFundTypes.maccabi]: {
    name: 'מכבי שירותי בריאות',
    loginFields: ['id', 'password'],
    // OTP first: it is what members' accounts actually use day to day.
    loginMethods: ['otp', 'password'],
  },
  [HealthFundTypes.clalit]: {
    name: 'שירותי בריאות כללית',
    loginFields: ['id', 'password'],
    loginMethods: ['otp', 'password'],
  },
  [HealthFundTypes.meuhedet]: {
    name: 'מאוחדת',
    loginFields: ['id', 'password'],
    loginMethods: ['otp', 'password'],
  },
  [HealthFundTypes.leumit]: {
    name: 'לאומית שירותי בריאות',
    loginFields: ['id', 'password'],
    loginMethods: ['otp', 'password'],
  },
  [HealthFundTypes.mock]: {
    name: 'Mock Health Fund',
    loginFields: ['id'],
    loginMethods: ['password'],
  },
};

/** Funds with a working scraper today. The rest are declared but not yet implemented. */
export const IMPLEMENTED_FUNDS: HealthFundId[] = [HealthFundTypes.maccabi];

/**
 * Creates the scraper for a fund.
 *
 * Unimplemented funds fail here with a clear message rather than being silently absent,
 * so "Clalit is not supported yet" is distinguishable from "you typed the id wrong".
 */
export function createScraper(options: ScraperOptions): Scraper {
  switch (options.companyId) {
    case HealthFundTypes.maccabi:
      return new MaccabiScraper(options);
    case HealthFundTypes.mock:
      return new MockScraper(options);
    case HealthFundTypes.clalit:
    case HealthFundTypes.meuhedet:
    case HealthFundTypes.leumit:
      throw new Error(
        `${SCRAPERS[options.companyId].name} is declared but not implemented yet. ` +
          `Implemented funds: ${IMPLEMENTED_FUNDS.join(', ')}.`,
      );
    default:
      throw new Error(`Unknown fund id: ${String(options.companyId)}`);
  }
}

/** Funds enabled for this process, from IHS_FUNDS. Defaults to everything implemented. */
export function enabledFunds(): HealthFundId[] {
  const configured = process.env.IHS_FUNDS?.split(',')
    .map((id) => id.trim())
    .filter(Boolean) as HealthFundId[] | undefined;

  return configured?.length ? configured : IMPLEMENTED_FUNDS;
}
