import crypto from 'node:crypto';

import { anyScopeMatches, type Scope } from './scopes.js';
import { resolvePolicy, type ResolvedPolicy } from './config.js';
import { hashInput, writeAudit, type AuditOutcome } from './audit.js';
import { CONFIRMATION_TTL_MS } from '../constants.js';
import type { Operation } from '../operations.js';

export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
}

export class ConfirmationRequiredError extends Error {
  readonly code = 'CONFIRMATION_REQUIRED';
  constructor(
    readonly preview: string,
    readonly confirmationToken: string,
    readonly expiresInSeconds: number,
  ) {
    super('This action requires confirmation before it runs.');
  }
}

export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';
  constructor(
    readonly limitedScope: string,
    readonly retryAfterSeconds: number,
  ) {
    super(`Rate limit reached for ${limitedScope}. Retry in ${retryAfterSeconds}s.`);
  }
}

interface PendingConfirmation {
  operationName: string;
  inputHash: string;
  expiresAt: number;
}

/**
 * Enforces the permission model at the two points that matter:
 *
 *  1. discovery — an agent is never shown an operation it may not call, so it is never
 *     tempted to try and never reports a capability the member did not grant;
 *  2. execution — re-checked on every call, because the tool list an agent holds is
 *     not evidence of anything.
 *
 * Both are needed: (1) alone is a presentation detail a hand-written call walks
 * straight past, and (2) alone leaks the shape of everything that exists.
 */
export class PermissionEngine {
  private readonly confirmations = new Map<string, PendingConfirmation>();
  private readonly rateCounters = new Map<string, number[]>();

  constructor(private readonly policy: ResolvedPolicy = resolvePolicy()) {}

  get profileName(): string {
    return this.policy.profileName;
  }

  get readOnlyMode(): boolean {
    return this.policy.readOnlyMode;
  }

  /** Whether this operation may appear in a tool listing at all. */
  canDiscover(operation: Operation<never, unknown>): boolean {
    if (this.policy.readOnlyMode && operation.capability === 'write') return false;
    return anyScopeMatches(this.policy.profile.scopes, operation.scope);
  }

  visibleOperations<T extends Operation<never, unknown>>(all: readonly T[]): T[] {
    return all.filter((operation) => this.canDiscover(operation));
  }

  private requiresConfirmation(operationScope: Scope): boolean {
    return anyScopeMatches(this.policy.profile.requireConfirmation, operationScope);
  }

  /** Sliding-window rate limit. Returns seconds to wait, or null when within budget. */
  private checkRateLimit(operationScope: Scope): number | null {
    const limits = this.policy.profile.rateLimits;
    const pattern = Object.keys(limits).find((p) => anyScopeMatches([p], operationScope));
    if (!pattern) return null;

    const limit = limits[pattern];
    if (!limit) return null;

    const now = Date.now();
    const windowStart = now - 3600_000;
    const hits = (this.rateCounters.get(pattern) ?? []).filter((t) => t > windowStart);

    if (hits.length >= limit.perHour) {
      const oldest = hits[0] ?? now;
      return Math.max(1, Math.ceil((oldest + 3600_000 - now) / 1000));
    }

    hits.push(now);
    this.rateCounters.set(pattern, hits);
    return null;
  }

  private issueConfirmation(operationName: string, inputHash: string): string {
    const token = crypto.randomUUID();
    this.confirmations.set(token, {
      operationName,
      inputHash,
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    });
    return token;
  }

  /**
   * A token is valid only for the exact operation and input it was issued for.
   *
   * Without that binding, a member could approve a preview of one message and the
   * token could be redeemed against a different one — which would make the whole
   * confirmation step theatre.
   */
  private redeemConfirmation(token: string, operationName: string, inputHash: string): boolean {
    const pending = this.confirmations.get(token);
    if (!pending) return false;

    this.confirmations.delete(token);

    if (Date.now() > pending.expiresAt) return false;
    if (pending.operationName !== operationName) return false;
    if (pending.inputHash !== inputHash) return false;

    return true;
  }

  /**
   * Authorizes one call. Throws on refusal; returns when the operation may run.
   *
   * Runs before any browser is opened: refusing a call should never require touching
   * the fund's site.
   */
  async authorize(
    operation: Operation<never, unknown>,
    input: unknown,
    options: { confirmationToken?: string } = {},
  ): Promise<void> {
    const inputHash = hashInput(input);

    const audit = (outcome: AuditOutcome, reason?: string) =>
      writeAudit({
        ts: new Date().toISOString(),
        profile: this.policy.profileName,
        companyId: operation.companyId,
        operation: operation.name,
        scope: operation.scope,
        capability: operation.capability,
        outcome,
        reason,
        inputHash,
      });

    if (this.policy.readOnlyMode && operation.capability === 'write') {
      await audit('denied', 'IHS_MODE=readonly');
      throw new PermissionDeniedError(
        `${operation.name} is a write operation and the server runs in read-only mode (IHS_MODE=readonly).`,
      );
    }

    if (!anyScopeMatches(this.policy.profile.scopes, operation.scope)) {
      await audit('denied', 'scope_not_granted');
      throw new PermissionDeniedError(
        `Profile "${this.policy.profileName}" does not grant ${operation.scope}.`,
      );
    }

    const retryAfter = this.checkRateLimit(operation.scope);
    if (retryAfter !== null) {
      await audit('rate_limited');
      throw new RateLimitedError(operation.scope, retryAfter);
    }

    if (this.requiresConfirmation(operation.scope)) {
      if (options.confirmationToken) {
        if (!this.redeemConfirmation(options.confirmationToken, operation.name, inputHash)) {
          await audit('denied', 'invalid_or_expired_confirmation');
          throw new PermissionDeniedError(
            'The confirmation token is invalid, expired, or was issued for different input. Request a fresh preview.',
          );
        }
      } else {
        const preview = operation.preview
          ? await operation.preview(input as never)
          : `Execute ${operation.name} on ${operation.companyId}.`;
        const token = this.issueConfirmation(operation.name, inputHash);
        await audit('confirmation_required');
        throw new ConfirmationRequiredError(preview, token, CONFIRMATION_TTL_MS / 1000);
      }
    }

    await audit('allowed');
  }
}
