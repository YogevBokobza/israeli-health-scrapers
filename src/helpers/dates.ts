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

/**
 * Reads the UTC offset (in minutes) Jerusalem observes at a given instant.
 *
 * Used instead of a hard-coded +2/+3 so a date crossing a DST boundary still lands on
 * the right day — Node ships full tz data, so this is a stdlib lookup, not a guess.
 */
function jerusalemOffsetMinutes(instant: Date): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value;

  const match = part?.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) * 60 : 120;
}

/**
 * Combines a day-first date and an "HH:mm" time, both rendered in Israel local time,
 * into an ISO instant.
 *
 * ponytail: the offset is resolved once from a same-day UTC guess rather than
 * iterated to convergence — wrong only in the ambiguous hour around a DST switch,
 * which does not matter for an appointment reminder.
 */
export function parseIsraeliDateTime(
  dateValue: string | null | undefined,
  timeValue: string | null | undefined,
): string | null {
  const date = parseIsraeliDate(dateValue);
  const time = normalizeText(timeValue);
  // Not anchored: Maccabi renders this as "שעה 09:55", not a bare "09:55".
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!date || !match) return null;

  const [, hourRaw, minuteRaw] = match;
  const [yearRaw, monthRaw, dayRaw] = date.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMinutes = jerusalemOffsetMinutes(new Date(guessUtcMs));
  const instant = new Date(guessUtcMs - offsetMinutes * 60_000);

  return instant.toISOString();
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
