import type { HealthFundId, ScraperCredentials } from '../definitions.js';

/**
 * Reads credentials from the environment, e.g. IHS_MACCABI_ID / IHS_MACCABI_PASSWORD.
 *
 * Returns null rather than throwing so a caller can fall back to an interactive login
 * instead of failing outright — and so credentials never have to be passed through an
 * agent to reach the scraper.
 */
export function credentialsFromEnv(companyId: HealthFundId): ScraperCredentials | null {
  const prefix = `IHS_${companyId.toUpperCase()}`;
  const id = process.env[`${prefix}_ID`];
  if (!id) return null;

  return { id, password: process.env[`${prefix}_PASSWORD`] };
}

/** Same, but with a message naming exactly what to set. */
export function requireCredentialsFromEnv(companyId: HealthFundId): ScraperCredentials {
  const credentials = credentialsFromEnv(companyId);
  if (!credentials) {
    const prefix = `IHS_${companyId.toUpperCase()}`;
    throw new Error(`Set ${prefix}_ID (and ${prefix}_PASSWORD for password login) first.`);
  }
  return credentials;
}
