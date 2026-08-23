import {
  ScraperProgressTypes,
  type HealthAccount,
  type ScraperCredentials,
  type ScraperLoginResult,
  type ScraperOptions,
  type ScraperScrapingResult,
} from '../definitions.js';
import { toErrorResult } from './errors.js';
import type { Scraper } from './interface.js';

/**
 * Shared lifecycle for every fund scraper, independent of how the fund is reached.
 *
 * Subclasses supply the fund-specific parts; this class owns the ordering, the
 * progress events, and the conversion of a thrown error into a result envelope — so
 * that a caller iterating over several funds gets a uniform answer from each and one
 * fund being down never aborts the rest.
 */
export abstract class BaseScraper implements Scraper {
  constructor(protected readonly options: ScraperOptions) {}

  protected emitProgress(type: ScraperProgressTypes): void {
    this.options.onProgress?.(this.options.companyId, type);
  }

  protected log(message: string, fields: Record<string, unknown> = {}): void {
    if (!this.options.verbose) return;
    // stderr, never stdout: stdout is the MCP stdio transport and any stray write
    // there corrupts the protocol stream.
    process.stderr.write(
      `${JSON.stringify({ ts: new Date().toISOString(), companyId: this.options.companyId, message, ...fields })}\n`,
    );
  }

  /** Prepare whatever the fund needs (a browser, an HTTP client, a token). */
  protected abstract initialize(): Promise<void>;

  abstract login(credentials: ScraperCredentials): Promise<ScraperLoginResult>;

  /** Read the requested collections. Called only after a successful login. */
  protected abstract fetchAccounts(): Promise<HealthAccount[]>;

  abstract terminate(success?: boolean): Promise<void>;

  async fetchData(): Promise<ScraperScrapingResult> {
    try {
      this.emitProgress(ScraperProgressTypes.ScrapingData);
      return { success: true, accounts: await this.fetchAccounts() };
    } catch (error) {
      return { success: false, ...toErrorResult(error) };
    }
  }

  /**
   * The one-shot path: initialize, log in, fetch, clean up.
   *
   * `terminate` runs in a finally block and is told whether the scrape succeeded,
   * because a failed run is exactly when the on-failure diagnostics are worth keeping.
   */
  async scrape(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);

    let result: ScraperScrapingResult | undefined;

    try {
      this.emitProgress(ScraperProgressTypes.Initializing);
      await this.initialize();

      this.emitProgress(ScraperProgressTypes.LoggingIn);
      const loginResult = await this.login(credentials);

      if (!loginResult.success) {
        this.emitProgress(ScraperProgressTypes.LoginFailed);
        result = {
          success: false,
          errorType: loginResult.errorType,
          errorMessage: loginResult.errorMessage,
        };
      } else {
        this.emitProgress(ScraperProgressTypes.LoginSuccess);
        result = await this.fetchData();
      }
    } catch (error) {
      result = { success: false, ...toErrorResult(error) };
    } finally {
      this.emitProgress(ScraperProgressTypes.Terminating);
      // Passing the real outcome, not a constant `false`: terminate treats failure as
      // the signal to dump the page, and a successful run does not need a copy of a
      // logged-in medical page written to disk. An unset result means we never got
      // past initialize, which is a failure.
      await this.terminate(result?.success === true).catch(() => {});
    }

    this.emitProgress(ScraperProgressTypes.EndScraping);
    return result;
  }
}
