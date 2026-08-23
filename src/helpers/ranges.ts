import type { ReferenceStatus } from '../definitions.js';

/**
 * Places a measured value against its reference range.
 *
 * Shared for the same reason `deriveExpiry` is: "was this result abnormal" must mean
 * the same thing at every fund, and answering it is the whole point of storing a
 * reference range alongside a value. A fund that reports its ranges differently
 * normalizes to (min, max, null) before calling this rather than deciding for itself
 * what counts as out of range.
 *
 * A one-sided range is honoured — plenty of analytes are reported as "under 5" or
 * "over 40" with only the meaningful bound given. `unknown` is returned only when
 * there is nothing to compare: no value, or no bound at all.
 */
export function deriveReferenceStatus(
  value: number | null,
  referenceMin: number | null,
  referenceMax: number | null,
): ReferenceStatus {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  if (referenceMin === null && referenceMax === null) return 'unknown';

  if (referenceMin !== null && value < referenceMin) return 'below';
  if (referenceMax !== null && value > referenceMax) return 'above';

  return 'within';
}
