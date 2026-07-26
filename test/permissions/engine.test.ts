import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PermissionEngine,
  PermissionDeniedError,
  ConfirmationRequiredError,
  RateLimitedError,
} from '../../src/permissions/engine.js';
import type { ResolvedPolicy } from '../../src/permissions/config.js';
import { scopeMatches } from '../../src/permissions/scopes.js';
import { HealthFundTypes } from '../../src/definitions.js';
import type { Operation } from '../../src/operations.js';

// Auditing writes to disk; the engine's behaviour is what is under test here.
process.env.IHS_AUDIT = 'off';

function operation(
  overrides: Partial<Operation<never, unknown>> = {},
): Operation<never, unknown> {
  return {
    name: 'medications.list',
    companyId: HealthFundTypes.maccabi,
    resource: 'medications',
    capability: 'read',
    scope: 'maccabi:medications:read',
    title: 'test operation',
    input: z.object({}).passthrough() as never,
    run: async () => ({}),
    ...overrides,
  } as Operation<never, unknown>;
}

const writeOperation = operation({
  name: 'messages.send',
  resource: 'messages',
  capability: 'write',
  scope: 'maccabi:messages:write',
  preview: async () => 'Would send a message to Dr. Cohen.',
});

function policy(overrides: Partial<ResolvedPolicy['profile']> = {}, readOnlyMode = false): ResolvedPolicy {
  return {
    profileName: 'test',
    readOnlyMode,
    profile: { scopes: [], requireConfirmation: [], rateLimits: {}, ...overrides },
  };
}

describe('scopeMatches', () => {
  it('wildcards whole segments', () => {
    expect(scopeMatches('*:*:read', 'maccabi:medications:read')).toBe(true);
    expect(scopeMatches('maccabi:*:*', 'maccabi:messages:write')).toBe(true);
  });

  it('does not treat a partial segment as a pattern', () => {
    // A grant that reads narrower than it is would be a security bug, not a nicety.
    expect(scopeMatches('medic*:*:*', 'maccabi:medications:read')).toBe(false);
  });

  it('refuses to match across funds', () => {
    expect(scopeMatches('maccabi:medications:read', 'clalit:medications:read')).toBe(false);
  });
});

describe('discovery', () => {
  it('hides an operation the profile does not grant', () => {
    const engine = new PermissionEngine(policy({ scopes: ['maccabi:appointments:read'] }));
    expect(engine.canDiscover(operation())).toBe(false);
  });

  it('shows only reads to a read-only profile', () => {
    const engine = new PermissionEngine(policy({ scopes: ['*:*:read'] }));
    const visible = engine.visibleOperations([operation(), writeOperation]);
    expect(visible.map((o) => o.name)).toEqual(['medications.list']);
  });

  it('hides every write when IHS_MODE=readonly, whatever the profile grants', () => {
    const engine = new PermissionEngine(policy({ scopes: ['*:*:*'] }, true));
    expect(engine.canDiscover(writeOperation)).toBe(false);
  });
});

describe('execution', () => {
  it('allows a granted read', async () => {
    const engine = new PermissionEngine(policy({ scopes: ['maccabi:medications:read'] }));
    await expect(engine.authorize(operation(), {})).resolves.toBeUndefined();
  });

  it('refuses an ungranted call even though it was never listed', async () => {
    // Discovery filtering is presentation; this is the check that actually holds.
    const engine = new PermissionEngine(policy({ scopes: ['maccabi:medications:read'] }));
    await expect(engine.authorize(writeOperation, {})).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('lets the read-only kill switch override a permissive profile', async () => {
    const engine = new PermissionEngine(policy({ scopes: ['*:*:*'] }, true));
    await expect(engine.authorize(writeOperation, {})).rejects.toThrow(/read-only/i);
  });
});

describe('write confirmation', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine(
      policy({ scopes: ['*:*:*'], requireConfirmation: ['*:*:write'] }),
    );
  });

  it('returns a preview and a token instead of executing the first call', async () => {
    const error = await engine.authorize(writeOperation, { body: 'hi' }).catch((e) => e);

    expect(error).toBeInstanceOf(ConfirmationRequiredError);
    expect(error.preview).toContain('Dr. Cohen');
    expect(error.confirmationToken).toBeTruthy();
  });

  it('executes on the second call with the token', async () => {
    const input = { body: 'hi' };
    const error = await engine.authorize(writeOperation, input).catch((e) => e);

    await expect(
      engine.authorize(writeOperation, input, { confirmationToken: error.confirmationToken }),
    ).resolves.toBeUndefined();
  });

  it('rejects a token redeemed against different input', async () => {
    // Otherwise a member could approve a preview of one message and the agent could
    // redeem the token against another — which would make confirmation theatre.
    const error = await engine.authorize(writeOperation, { body: 'hi' }).catch((e) => e);

    await expect(
      engine.authorize(writeOperation, { body: 'something else' }, {
        confirmationToken: error.confirmationToken,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('burns a token after one use', async () => {
    const input = { body: 'hi' };
    const error = await engine.authorize(writeOperation, input).catch((e) => e);
    await engine.authorize(writeOperation, input, { confirmationToken: error.confirmationToken });

    await expect(
      engine.authorize(writeOperation, input, { confirmationToken: error.confirmationToken }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('rejects a made-up token', async () => {
    await expect(
      engine.authorize(writeOperation, {}, { confirmationToken: 'not-a-real-token' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('rate limiting', () => {
  it('refuses once the hourly budget for the scope is spent', async () => {
    const engine = new PermissionEngine(
      policy({ scopes: ['*:*:*'], rateLimits: { '*:*:read': { perHour: 2 } } }),
    );

    await engine.authorize(operation(), {});
    await engine.authorize(operation(), {});

    await expect(engine.authorize(operation(), {})).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('leaves unrelated scopes unaffected', async () => {
    const engine = new PermissionEngine(
      policy({ scopes: ['*:*:*'], rateLimits: { '*:*:write': { perHour: 1 } } }),
    );

    await engine.authorize(operation(), {});
    await expect(engine.authorize(operation(), {})).resolves.toBeUndefined();
  });
});
