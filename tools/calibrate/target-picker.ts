import { FETCH_TARGETS } from '../../src/definitions.js';

/**
 * The capture button's target picker: every `FetchTarget` plus `login`, which is not
 * itself a `FetchTarget` but is the one other value the picker offers. The single
 * source of truth the manifest's provisional check and the button's dropdown both
 * read from.
 */
export const CAPTURE_TARGETS = ['login', ...FETCH_TARGETS] as const;

/**
 * Suggestions only, offered via the capture button's state datalist — not a closed
 * set. Login-calibration needs one free-text label per ordered screen (`id-screen`,
 * `otp-screen`, ...), which none of these four fit.
 */
export const CAPTURE_STATES = ['collapsed', 'expanded', 'list', 'detail'] as const;

export function isKnownTarget(target: string): boolean {
  return (CAPTURE_TARGETS as readonly string[]).includes(target);
}

/**
 * A provisional target's free-text label must be a lowerCamel slug, so it can legally
 * become both a `FetchTarget` union member and a fixture directory name once promoted.
 * See CONTEXT.md's "Provisional target" entry.
 */
export function isLowerCamelSlug(value: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(value);
}

export type TargetValidation = { ok: true } | { ok: false; error: string };

/** Accepts a known target outright; accepts anything else only as a lowerCamel provisional slug. */
export function validateCaptureTarget(target: string): TargetValidation {
  const trimmed = target.trim();
  if (!trimmed) return { ok: false, error: 'A target is required.' };
  if (isKnownTarget(trimmed)) return { ok: true };
  if (isLowerCamelSlug(trimmed)) return { ok: true };
  return {
    ok: false,
    error: `"${trimmed}" must be a lowerCamel slug (e.g. form17) to use as a provisional target.`,
  };
}
