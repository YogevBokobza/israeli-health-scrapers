import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { auditPath, ensureDir } from '../helpers/paths.js';

export type AuditOutcome = 'allowed' | 'denied' | 'confirmation_required' | 'rate_limited' | 'error';

export interface AuditEntry {
  ts: string;
  profile: string;
  companyId: string;
  operation: string;
  scope: string;
  capability: string;
  outcome: AuditOutcome;
  /** Why it was denied, when it was. */
  reason?: string;
  /**
   * SHA-256 of the serialized input, truncated. Enough to tell two calls apart and to
   * match a preview to its confirmation, without writing the message body or any
   * other personal content to disk.
   */
  inputHash: string;
  durationMs?: number;
}

export function hashInput(input: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input ?? null))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Append-only record of every attempt, including refusals — an audit log that only
 * recorded successes would miss exactly the events worth reviewing.
 *
 * Deliberately carries no PII and no medical content: names, message bodies and
 * results never land here.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  if (process.env.IHS_AUDIT === 'off') return;

  try {
    const file = auditPath();
    await ensureDir(path.dirname(file));
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // Auditing must not take down the action it is recording.
  }
}
