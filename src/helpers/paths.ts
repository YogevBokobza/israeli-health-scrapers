import path from 'node:path';
import fs from 'node:fs/promises';
import type { HealthFundId } from '../definitions.js';

/**
 * Where the library keeps the little state it owns: stored login sessions, and
 * diagnostics dumps written when parsing fails.
 *
 * A consumer with its own storage — a database, an audit log — picks its own
 * locations. This root covers only what the scrapers themselves need.
 */
export function dataRoot(): string {
  return process.env.IHS_DATA_DIR ?? path.resolve(process.cwd(), 'data');
}

export function sessionPath(companyId: HealthFundId): string {
  return path.join(dataRoot(), 'sessions', `${companyId}.json`);
}

export function diagnosticsDir(): string {
  return path.join(dataRoot(), 'diagnostics');
}

/** Creates a directory tree with owner-only permissions. */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}
