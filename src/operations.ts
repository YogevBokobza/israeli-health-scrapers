import { z } from 'zod';

import {
  HealthFundTypes,
  type HealthFundId,
  type Medication,
  type ScraperCredentials,
  type ScraperOptions,
  type ScraperScrapingResult,
} from './definitions.js';
import { SCRAPERS, createScraper, enabledFunds } from './scrapers/factory.js';
import { scope, type Capability, type Resource, type Scope } from './permissions/scopes.js';

/**
 * An operation is one thing an agent can ask for, declared rather than implied.
 *
 * The scrapers know how to talk to a fund; operations are the vocabulary exposed to
 * callers. Keeping them separate is what lets the permission engine reason about
 * "read prescriptions at Maccabi" without knowing anything about Maccabi.
 */
export interface Operation<TIn = unknown, TOut = unknown> {
  /** Fund-independent name, e.g. 'medications.list'. */
  name: string;
  companyId: HealthFundId;
  resource: Resource;
  capability: Capability;
  scope: Scope;
  /** Shown to the agent as the tool description. */
  title: string;
  input: z.ZodType<TIn, z.ZodTypeDef, unknown>;

  /** Write operations only: what executing would do, rendered before anything is sent. */
  preview?(input: TIn): Promise<string>;

  run(input: TIn, ctx: OperationContext): Promise<TOut>;
}

export interface OperationContext {
  credentials: ScraperCredentials;
  scraperOptions?: Partial<ScraperOptions>;
}

const listMedicationsInput = z
  .object({
    expiringWithinDays: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Return only prescriptions expiring within this many days.'),
    includeExpired: z.boolean().default(true),
  })
  .default({ includeExpired: true });

export type ListMedicationsInput = z.infer<typeof listMedicationsInput>;

export interface ListMedicationsOutput {
  items: Medication[];
  retrievedAt: string;
}

/**
 * Runs a full scrape and returns the envelope.
 *
 * Failures come back as values rather than exceptions, matching the scraper contract,
 * so a caller sweeping several funds gets a uniform answer from each.
 */
async function scrapeFund(
  companyId: HealthFundId,
  ctx: OperationContext,
  fetch: ScraperOptions['fetch'],
): Promise<ScraperScrapingResult> {
  const scraper = createScraper({
    companyId,
    fetch,
    storeSession: true,
    ...ctx.scraperOptions,
  });

  return scraper.scrape(ctx.credentials);
}

function medicationsListOperation(companyId: HealthFundId): Operation<
  ListMedicationsInput,
  ListMedicationsOutput
> {
  return {
    name: 'medications.list',
    companyId,
    resource: 'medications',
    capability: 'read',
    scope: scope(companyId, 'medications', 'read'),
    title: `רשימת התרופות הקבועות ב${SCRAPERS[companyId].name}, כולל תוקף המרשם וכמה ימים נותרו עד שיפוג.`,
    input: listMedicationsInput,

    async run(input, ctx) {
      const result = await scrapeFund(companyId, ctx, ['medications']);

      if (!result.success) {
        // Surfaced as an exception here on purpose: an operation has a single caller
        // that wants the data, unlike a scrape sweeping many funds.
        throw new Error(`${result.errorType ?? 'ERROR'}: ${result.errorMessage ?? 'scrape failed'}`);
      }

      let items = result.accounts?.flatMap((account) => account.medications) ?? [];

      if (!input.includeExpired) {
        items = items.filter((medication) => medication.status !== 'expired');
      }

      if (input.expiringWithinDays !== undefined) {
        const limit = input.expiringWithinDays;
        items = items.filter(
          (medication) =>
            medication.daysUntilExpiry !== null && medication.daysUntilExpiry <= limit,
        );
      }

      return { items, retrievedAt: new Date().toISOString() };
    },
  };
}

/**
 * Every operation available for a fund.
 *
 * Only medications are implemented today; appointments, messages and commitments join
 * this list as their scrapers land, and gain permission handling for free.
 */
export function operationsFor(companyId: HealthFundId): Operation<never, unknown>[] {
  return [medicationsListOperation(companyId) as unknown as Operation<never, unknown>];
}

/** Operations across every enabled fund. */
export function allOperations(funds: HealthFundId[] = enabledFunds()): Operation<never, unknown>[] {
  return funds.flatMap((companyId) => operationsFor(companyId));
}

export function findOperation(
  companyId: HealthFundId,
  name: string,
): Operation<never, unknown> | null {
  return operationsFor(companyId).find((operation) => operation.name === name) ?? null;
}

export { HealthFundTypes };
