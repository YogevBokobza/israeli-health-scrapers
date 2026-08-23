import { ScraperErrorTypes } from '../definitions.js';

/**
 * Errors thrown inside a scraper are caught by the base class and turned into a
 * result envelope. These classes exist so that conversion can be precise instead of
 * collapsing everything into GENERIC.
 */
export class ScraperError extends Error {
  constructor(
    message: string,
    readonly errorType: ScraperErrorTypes = ScraperErrorTypes.Generic,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The page loaded but did not contain what the scraper expects. */
export class SelectorDriftError extends ScraperError {
  constructor(
    what: string,
    readonly diagnosticsPath?: string,
  ) {
    super(
      `Could not find ${what}. The site markup likely changed.` +
        (diagnosticsPath ? ` Diagnostics written to ${diagnosticsPath}.` : ''),
      ScraperErrorTypes.SelectorDrift,
    );
  }
}

/** The fund asked for a one-time code and the caller supplied no way to get one. */
export class TwoFactorRetrieverMissingError extends ScraperError {
  constructor() {
    super(
      'This fund requires an SMS code. Pass an `otpCodeRetriever` in the scraper options, ' +
        'or log in once with the CLI so a session is stored.',
      ScraperErrorTypes.TwoFactorRetrieverMissing,
    );
  }
}

export class TimeoutError extends ScraperError {
  constructor(message: string) {
    super(message, ScraperErrorTypes.Timeout);
  }
}

/**
 * Rebuilds a failed HTTP request as an error that carries no credentials.
 *
 * Playwright appends a call log to the message of a failed request, and that log
 * contains the request's URL *and every request header* — so a DNS blip on an
 * authenticated call produces an error message containing the member's live bearer
 * token and their member id. Those messages do not stay inside the process: a consumer
 * stores them (health-mcp writes them to a `sync_runs` row an agent can read back) and
 * prints them. Only the first line, which names the transport failure, is kept.
 */
export function requestFailure(what: string, error: unknown): ScraperError {
  const raw = error instanceof Error ? error.message : String(error);
  const reason = (raw.split('\n')[0] ?? '').replace(/Bearer\s+\S+/gi, 'Bearer <redacted>').trim();

  return new ScraperError(
    `${what} failed: ${reason}`,
    /timeout/i.test(reason) ? ScraperErrorTypes.Timeout : ScraperErrorTypes.Generic,
  );
}

/** Maps an unknown thrown value onto the result envelope's error fields. */
export function toErrorResult(error: unknown): {
  errorType: ScraperErrorTypes;
  errorMessage: string;
} {
  if (error instanceof ScraperError) {
    return { errorType: error.errorType, errorMessage: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);

  // Playwright surfaces its own timeouts as plain Errors; recognizing them is worth
  // more to a caller than another GENERIC.
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return { errorType: ScraperErrorTypes.Timeout, errorMessage: message };
  }

  return { errorType: ScraperErrorTypes.Generic, errorMessage: message };
}
