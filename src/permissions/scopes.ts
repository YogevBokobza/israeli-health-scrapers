import type { HealthFundId } from '../definitions.js';


/**
 * Scopes are `provider:resource:action`, e.g. `maccabi:medications:read`.
 *
 * Including the provider is what lets a member grant an agent read-only access to one
 * fund and write access to another — which matters as soon as more than one fund is
 * configured, and costs nothing before that.
 */
export type Scope = `${string}:${string}:${string}`;

export type Capability = 'read' | 'write';
export type Resource = 'medications' | 'appointments' | 'messages' | 'commitments';

export function scope(fund: HealthFundId, resource: Resource, capability: Capability): Scope {
  return `${fund}:${resource}:${capability}`;
}

/**
 * Matches a concrete scope against a pattern where any of the three segments may be
 * `*`, e.g. `*:*:write` or `maccabi:appointments:*`.
 *
 * Only whole segments wildcard: `medic*` is not a pattern, it is a literal that will
 * never match. Partial matching invites a grant that reads narrower than it is.
 */
export function scopeMatches(pattern: string, granted: Scope): boolean {
  const patternParts = pattern.split(':');
  const grantedParts = granted.split(':');
  if (patternParts.length !== 3 || grantedParts.length !== 3) return false;

  return patternParts.every((part, i) => part === '*' || part === grantedParts[i]);
}

/** True when any pattern in the list matches. */
export function anyScopeMatches(patterns: readonly string[], granted: Scope): boolean {
  return patterns.some((pattern) => scopeMatches(pattern, granted));
}

/** Reads the capability segment back out of a scope. */
export function capabilityOf(s: Scope): Capability | null {
  const last = s.split(':')[2];
  return last === 'read' || last === 'write' ? last : null;
}
