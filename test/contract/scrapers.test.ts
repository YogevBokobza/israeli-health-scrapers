import { describe, expect, it } from 'vitest';

import { createScraper, SCRAPERS, IMPLEMENTED_FUNDS } from '../../src/scrapers/factory.js';
import { HealthFundTypes, healthAccountSchema } from '../../src/definitions.js';

/**
 * The contract every fund must satisfy.
 *
 * This is what keeps the multi-fund promise honest: it runs against the mock fund
 * exactly as it would against a real one, so if adding a fund ever started requiring
 * changes to the shared layers, this suite is the first thing that breaks.
 */
describe('scraper contract', () => {
  it('declares metadata for every fund id', () => {
    for (const fund of Object.values(HealthFundTypes)) {
      const metadata = SCRAPERS[fund];
      expect(metadata, `missing metadata for ${fund}`).toBeDefined();
      expect(metadata.name.length).toBeGreaterThan(0);
      expect(metadata.loginFields).toContain('id');
      expect(metadata.loginMethods.length).toBeGreaterThan(0);
    }
  });

  it('refuses a declared-but-unimplemented fund with a clear message', () => {
    // "Clalit is not supported yet" must be distinguishable from "you typed it wrong".
    expect(() => createScraper({ companyId: HealthFundTypes.clalit })).toThrow(/not implemented/i);
    expect(() => createScraper({ companyId: 'nope' as never })).toThrow(/unknown fund/i);
  });

  it('produces accounts matching the shared schema, without touching the core', async () => {
    const scraper = createScraper({ companyId: HealthFundTypes.mock });
    const result = await scraper.scrape({ id: '000000000' });

    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();

    for (const account of result.accounts!) {
      expect(() => healthAccountSchema.parse(account)).not.toThrow();
    }
  });

  it('reports a failed login as a value rather than throwing', async () => {
    // A caller sweeping several funds must not have one bad fund abort the rest.
    const scraper = createScraper({ companyId: HealthFundTypes.mock });
    const result = await scraper.scrape({ id: '' });

    expect(result.success).toBe(false);
    expect(result.accounts).toBeUndefined();
  });

  it('emits the lifecycle progress events in order', async () => {
    const seen: string[] = [];
    const scraper = createScraper({
      companyId: HealthFundTypes.mock,
      onProgress: (_fund, type) => seen.push(type),
    });

    await scraper.scrape({ id: '000000000' });

    expect(seen).toContain('START_SCRAPING');
    expect(seen).toContain('LOGIN_SUCCESS');
    expect(seen.at(-1)).toBe('END_SCRAPING');
  });

  it('constructs a scraper for every implemented fund', () => {
    for (const fund of [...IMPLEMENTED_FUNDS, HealthFundTypes.mock]) {
      const scraper = createScraper({ companyId: fund });
      expect(typeof scraper.scrape).toBe('function');
      expect(typeof scraper.login).toBe('function');
      expect(typeof scraper.terminate).toBe('function');
    }
  });

  it('tags every scraped record with the fund it came from', async () => {
    // A consumer merging several funds into one store needs this to be reliable.
    const scraper = createScraper({ companyId: HealthFundTypes.mock });
    const result = await scraper.scrape({ id: '000000000' });

    for (const account of result.accounts!) {
      expect(account.provider).toBe(HealthFundTypes.mock);
      for (const medication of account.medications) {
        expect(medication.provider).toBe(HealthFundTypes.mock);
      }
    }
  });
});
