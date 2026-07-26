/** Threshold, in days, under which a still-valid prescription counts as expiring soon. */
export const EXPIRING_SOON_DAYS = 30;

export const DEFAULT_TIMEOUT_MS = 30_000;

/** How long a saved session is assumed good before we re-authenticate proactively. */
export const DEFAULT_SESSION_TTL_HOURS = 12;

/** How long an unfinished OTP login (and its open browser) is kept alive. */
export const OTP_CHALLENGE_TTL_MS = 5 * 60_000;

/** How long a write action's confirmation token stays redeemable. */
export const CONFIRMATION_TTL_MS = 5 * 60_000;

/**
 * The funds render Hebrew dates and appointment times relative to Israel. Getting
 * either wrong silently corrupts every date we parse, so they are pinned rather than
 * inherited from the host.
 */
export const BROWSER_LOCALE = 'he-IL';
export const BROWSER_TIMEZONE = 'Asia/Jerusalem';

export const VIEWPORT = { width: 1440, height: 900 } as const;
