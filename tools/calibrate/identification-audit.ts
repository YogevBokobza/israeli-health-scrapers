import {
  DIGITAL_VISIT_IDENTIFICATION,
  summarizeIdentificationMethods,
  type IdentificationMethodTally,
  type MaccabiVisitEntry,
} from '../../src/scrapers/maccabi.js';

/**
 * The badge the past-visits lobby renders on a digital visit. The DOM ground truth this
 * audit weighs `identification_method` against — the list API carries the code, never
 * this text, so verifying the code→meaning mapping means reading both at once.
 */
export const DIGITAL_BADGE_TEXT = 'ביקור דיגיטלי';

/** How many times the "ביקור דיגיטלי" badge appears in a captured lobby's HTML. */
export function countDigitalBadges(html: string, badgeText: string = DIGITAL_BADGE_TEXT): number {
  if (!badgeText) return 0;
  return html.split(badgeText).length - 1;
}

export interface IdentificationAudit {
  /** The lobby's code distribution, from {@link summarizeIdentificationMethods}. */
  tallies: IdentificationMethodTally[];
  /**
   * How many rows the captured DOM badged digital. Omit when no lobby HTML was captured
   * alongside the API response — the readout then asks the operator to count by eye.
   */
  badgeCount?: number;
  /** The code isDigital is derived from; defaults to {@link DIGITAL_VISIT_IDENTIFICATION}. */
  digitalCode?: number;
}

function tallyLine(tally: IdentificationMethodTally, digitalCode: number): string {
  const label = tally.code === null ? '(no code)' : `code ${tally.code}`;
  const mark = tally.code === digitalCode ? '   ← treated as isDigital' : '';
  return `  ${label}: ${tally.count}${mark}`;
}

/**
 * The identification_method readout printed during a live calibration run: the lobby's
 * code distribution, and — when the lobby HTML was captured too — whether the count of
 * digital badges matches the count of entries on {@link DIGITAL_VISIT_IDENTIFICATION}.
 *
 * The list API hands over no per-row id shared with the DOM, so this correlates by count,
 * not by row: an equal count is the closed-set confirmation the issue asks for, and any
 * gap names which of the two mislabels (a digital visit shipping `false`, or an in-clinic
 * visit shipping `true`) is actually happening on the account.
 */
export function formatIdentificationAudit(audit: IdentificationAudit): string {
  const digitalCode = audit.digitalCode ?? DIGITAL_VISIT_IDENTIFICATION;
  const total = audit.tallies.reduce((sum, tally) => sum + tally.count, 0);
  const digitalCount = audit.tallies.find((tally) => tally.code === digitalCode)?.count ?? 0;

  const lines = [
    `identification_method distribution (${total} entries across the visits lobby):`,
    ...audit.tallies.map((tally) => tallyLine(tally, digitalCode)),
  ];

  if (audit.badgeCount === undefined) {
    lines.push(
      `verify: count the "${DIGITAL_BADGE_TEXT}" rows on the page and compare to code ${digitalCode} (${digitalCount}).`,
      `  equal ⇒ ${digitalCode} is the digital code and nothing else is; a difference ⇒ the isDigital mapping needs a fix.`,
    );
    return lines.join('\n');
  }

  lines.push(`"${DIGITAL_BADGE_TEXT}" rows in the captured DOM: ${audit.badgeCount}`);
  if (audit.badgeCount === digitalCount) {
    lines.push(
      `consistent: the digital-badge count equals the code-${digitalCode} count, so ${digitalCode} maps to digital and no other code does on this account.`,
    );
  } else if (audit.badgeCount > digitalCount) {
    lines.push(
      `MISMATCH: ${audit.badgeCount} badged rows but only ${digitalCount} on code ${digitalCode} — a digital visit is shipping isDigital: false. Map the missing code(s).`,
    );
  } else {
    lines.push(
      `MISMATCH: ${digitalCount} entries on code ${digitalCode} but only ${audit.badgeCount} badged rows — an in-clinic visit is shipping isDigital: true.`,
    );
  }
  return lines.join('\n');
}

/** Builds the audit from a raw past-visits API payload plus, optionally, the lobby HTML. */
export function auditPastVisitsPayload(
  results: readonly Pick<MaccabiVisitEntry, 'identification_method'>[],
  html?: string,
): IdentificationAudit {
  return {
    tallies: summarizeIdentificationMethods(results),
    ...(html !== undefined ? { badgeCount: countDigitalBadges(html) } : {}),
  };
}
