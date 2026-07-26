import { EXPIRING_SOON_DAYS } from '../constants.js';
import type { MedicationStatus } from '../definitions.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Collapses whitespace and strips the bidirectional control characters Hebrew pages
 * sprinkle into text nodes — invisible, but they break every comparison and every
 * date regex that would otherwise work.
 */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cell values that mean "the fund did not say", as opposed to zero. */
export function isBlank(value: string): boolean {
  return value === '' || value === '-' || value === '--' || value === 'ללא';
}

/** Returns trimmed text, or null when the cell carries no information. */
export function textOrNull(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  return isBlank(text) ? null : text;
}

/**
 * Parses the day-first formats Israeli sites use (25/07/2026, 25.7.26, 25-07-2026)
 * into an ISO date.
 *
 * Day-first is assumed because that is what the funds render. An already-ISO value is
 * passed through so a normalized input is never re-parsed as day-first.
 */
export function parseIsraeliDate(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  if (isBlank(text)) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  if (!dayRaw || !monthRaw || !yearRaw) return null;

  const day = Number(dayRaw);
  const month = Number(monthRaw);
  // A 2-digit year on a live prescription is this century; these are not archives.
  const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject impossible dates (31/02) rather than letting Date roll them forward.
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Pulls the first integer out of a cell like "נותרו 2 ניפוקים". */
export function parseInteger(value: string | null | undefined): number | null {
  const text = normalizeText(value);
  if (isBlank(text)) return null;
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * Derives `daysUntilExpiry` and `status` from a validUntil date.
 *
 * Both sides are compared at UTC midnight so a run at 23:50 and one at 00:10 the next
 * morning do not disagree by a day for reasons unrelated to the prescription.
 */
export function deriveExpiry(
  validUntil: string | null,
  now: Date = new Date(),
): { daysUntilExpiry: number | null; status: MedicationStatus } {
  if (!validUntil) return { daysUntilExpiry: null, status: 'unknown' };

  const expiry = Date.parse(`${validUntil}T00:00:00Z`);
  if (Number.isNaN(expiry)) return { daysUntilExpiry: null, status: 'unknown' };

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysUntilExpiry = Math.round((expiry - today) / MS_PER_DAY);

  const status: MedicationStatus =
    daysUntilExpiry < 0
      ? 'expired'
      : daysUntilExpiry <= EXPIRING_SOON_DAYS
        ? 'expiring_soon'
        : 'active';

  return { daysUntilExpiry, status };
}
