import {
  HealthFundTypes,
  type HealthAccount,
  type ScraperCredentials,
  type ScraperLoginResult,
} from '../definitions.js';
import { BaseScraper } from './base-scraper.js';
import { deriveExpiry } from '../helpers/dates.js';

/**
 * A fund that does not exist, implemented against the same `BaseScraper` contract as
 * the real ones and returning fixed data.
 *
 * It keeps the multi-fund promise honest: the contract tests run against it exactly as
 * they run against a real scraper, so if adding a fund ever started requiring changes
 * to the shared layers, this is the first thing that would break. It also gives the
 * permission and MCP layers something to exercise without a browser or an account.
 */
export class MockScraper extends BaseScraper {
  protected async initialize(): Promise<void> {
    // Nothing to set up: there is no browser and no site.
  }

  override async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    return credentials.id ? { success: true } : { success: false, errorMessage: 'missing id' };
  }

  protected async fetchAccounts(): Promise<HealthAccount[]> {
    const now = new Date();
    const validUntil = new Date(now.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
    const { daysUntilExpiry, status } = deriveExpiry(validUntil, now);

    return [
      {
        provider: HealthFundTypes.mock,
        medications: [
          {
            name: 'Mock Drug',
            dosage: '10 mg',
            form: 'tablets',
            prescribedBy: 'Dr. Mock',
            lastDispensed: now.toISOString().slice(0, 10),
            validUntil,
            refillsRemaining: 2,
            daysUntilExpiry,
            status,
            provider: HealthFundTypes.mock,
          },
        ],
      },
    ];
  }

  override async terminate(): Promise<void> {
    // Nothing to tear down.
  }
}
