import { describe, expect, it } from 'vitest';

import { BaseScraper } from '../../src/scrapers/base-scraper.js';
import {
  HealthFundTypes,
  ScraperErrorTypes,
  type HealthAccount,
  type ScraperCredentials,
  type ScraperLoginResult,
} from '../../src/definitions.js';

class RecordingScraper extends BaseScraper {
  terminatedWith: boolean[] = [];

  constructor(
    private readonly loginResult: ScraperLoginResult,
    private readonly accounts: () => Promise<HealthAccount[]>,
  ) {
    super({ companyId: HealthFundTypes.maccabi });
  }

  protected async initialize(): Promise<void> {}

  async login(): Promise<ScraperLoginResult> {
    return this.loginResult;
  }

  protected async fetchAccounts(): Promise<HealthAccount[]> {
    return this.accounts();
  }

  override async terminate(success = true): Promise<void> {
    this.terminatedWith.push(success);
  }
}

const credentials: ScraperCredentials = { id: '000000000' };

describe('BaseScraper.scrape', () => {
  it('tells terminate the run succeeded, not a hardcoded false, so a successful run does not dump diagnostics', async () => {
    const scraper = new RecordingScraper({ success: true }, async () => []);
    await expect(scraper.scrape(credentials)).resolves.toMatchObject({ success: true });
    expect(scraper.terminatedWith).toEqual([true]);
  });

  it('tells terminate the fetch failed', async () => {
    const scraper = new RecordingScraper({ success: true }, async () => {
      throw new Error('boom');
    });
    await expect(scraper.scrape(credentials)).resolves.toMatchObject({ success: false });
    expect(scraper.terminatedWith).toEqual([false]);
  });

  it('tells terminate a failed login is a failure too', async () => {
    const scraper = new RecordingScraper(
      { success: false, errorType: ScraperErrorTypes.InvalidPassword },
      async () => [],
    );
    await expect(scraper.scrape(credentials)).resolves.toMatchObject({ success: false });
    expect(scraper.terminatedWith).toEqual([false]);
  });
});
