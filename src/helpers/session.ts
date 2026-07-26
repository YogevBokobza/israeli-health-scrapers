import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HealthFundId } from '../definitions.js';
import { ensureDir, sessionPath } from './paths.js';
import { DEFAULT_SESSION_TTL_HOURS } from '../constants.js';

/**
 * A saved Playwright storageState plus the metadata we need to decide whether it is
 * still worth trying. Sessions are per-companyId: a member of two funds never has
 * their cookies mixed.
 */
export interface StoredSession {
  companyId: HealthFundId;
  /** Playwright `storageState()` output. */
  storageState: unknown;
  savedAt: string;
  /** Soft expiry. We still try an expired-looking session; the fund is the authority. */
  expiresAt: string;
}

const ALGORITHM = 'aes-256-gcm';


/**
 * Derives the 32-byte key from IHS_SESSION_KEY.
 *
 * Sessions are cookies for a medical account, so we refuse to persist them without a
 * key rather than silently writing them in the clear.
 */
function sessionKey(): Buffer {
  const raw = process.env.IHS_SESSION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      'IHS_SESSION_KEY must be set to at least 16 characters to store a session. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export async function saveSession(
  companyId: HealthFundId,
  storageState: unknown,
  ttlHours = Number(process.env.IHS_SESSION_TTL_HOURS ?? DEFAULT_SESSION_TTL_HOURS),
): Promise<void> {
  const payload: StoredSession = {
    companyId,
    storageState,
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlHours * 3600_000).toISOString(),
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, sessionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  const envelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  };

  const file = sessionPath(companyId);
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(envelope), { mode: 0o600 });
}

/** Returns the stored session, or null when there is none / it cannot be read. */
export async function loadSession(companyId: HealthFundId): Promise<StoredSession | null> {
  let envelope: { iv: string; tag: string; data: string };
  try {
    envelope = JSON.parse(await fs.readFile(sessionPath(companyId), 'utf8'));
  } catch {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      sessionKey(),
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as StoredSession;
  } catch {
    // Wrong key or a tampered file. Treat as "no session" rather than crashing —
    // the caller will just start a fresh login.
    return null;
  }
}

export function isExpired(session: StoredSession, now: Date = new Date()): boolean {
  return Date.parse(session.expiresAt) <= now.getTime();
}

export async function clearSession(companyId: HealthFundId): Promise<void> {
  await fs.rm(sessionPath(companyId), { force: true });
}
