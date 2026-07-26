import crypto from 'node:crypto';

import { OTP_CHALLENGE_TTL_MS } from '../constants.js';
import type { HealthFundId } from '../definitions.js';
import type { Scraper } from '../scrapers/interface.js';

/**
 * MCP is not an interactive channel: a tool call cannot block while the member reads an
 * SMS. So an OTP login is split into `auth_start` and `auth_complete`, and the live
 * scraper — with its open browser — has to survive between the two calls, because the
 * fund ties the code to that session and a fresh browser would invalidate it.
 *
 * Holding an open browser in memory is bounded by a short TTL, so a login the member
 * abandoned does not leave one running indefinitely.
 */
export interface PendingChallenge {
  challengeId: string;
  companyId: HealthFundId;
  scraper: Scraper;
  expiresAt: number;
}

const pending = new Map<string, PendingChallenge>();

export function createChallenge(
  companyId: HealthFundId,
  scraper: Scraper,
  ttlMs = OTP_CHALLENGE_TTL_MS,
): PendingChallenge {
  const challenge: PendingChallenge = {
    challengeId: crypto.randomUUID(),
    companyId,
    scraper,
    expiresAt: Date.now() + ttlMs,
  };
  pending.set(challenge.challengeId, challenge);
  return challenge;
}

/** Returns the challenge, or null when unknown or expired. Expired ones are cleaned up. */
export function takeChallenge(challengeId: string): PendingChallenge | null {
  const challenge = pending.get(challengeId);
  if (!challenge) return null;

  if (Date.now() > challenge.expiresAt) {
    pending.delete(challengeId);
    void challenge.scraper.terminate(false);
    return null;
  }
  return challenge;
}

export function finishChallenge(challengeId: string): void {
  pending.delete(challengeId);
}

/** Drops challenges past their TTL. Safe to call on a timer. */
export function sweepExpiredChallenges(now = Date.now()): number {
  let swept = 0;
  for (const [id, challenge] of pending) {
    if (now > challenge.expiresAt) {
      pending.delete(id);
      void challenge.scraper.terminate(false);
      swept++;
    }
  }
  return swept;
}

/** Terminates every open challenge. Called on shutdown. */
export async function closeAllChallenges(): Promise<void> {
  const open = [...pending.values()];
  pending.clear();
  await Promise.all(open.map((c) => c.scraper.terminate(false).catch(() => {})));
}
