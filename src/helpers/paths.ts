import path from 'node:path';
import fs from 'node:fs/promises';
import type { HealthFundId } from '../definitions.js';

/**
 * Everything mutable lives under one data root so a container only needs a single
 * volume mount, and so nothing sensitive is ever written next to the source.
 */
export function dataRoot(): string {
  return process.env.IHS_DATA_DIR ?? path.resolve(process.cwd(), 'data');
}

export function sessionPath(companyId: HealthFundId): string {
  return path.join(dataRoot(), 'sessions', `${companyId}.json`);
}

export function auditPath(): string {
  return path.join(dataRoot(), 'audit.jsonl');
}

export function diagnosticsDir(): string {
  return path.join(dataRoot(), 'diagnostics');
}

/** Creates a directory tree with owner-only permissions. */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}
