import { describe, expect, it } from 'vitest';

import { createScraper, SCRAPERS, IMPLEMENTED_FUNDS } from '../../src/scrapers/factory.js';
import { HealthFundTypes, healthAccountSchema } from '../../src/definitions.js';
import { operationsFor } from '../../src/operations.js';

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

  it('exposes operations whose scope names the fund they belong to', () => {
    for (const fund of [...IMPLEMENTED_FUNDS, HealthFundTypes.mock]) {
      for (const operation of operationsFor(fund)) {
        expect(operation.scope.startsWith(`${fund}:`)).toBe(true);
        expect(operation.companyId).toBe(fund);
      }
    }
  });
});
