import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import {
  ScraperErrorTypes,
  ScraperProgressTypes,
  type HealthAccount,
  type ScraperCredentials,
  type ScraperLoginResult,
  type ScraperOptions,
} from '../definitions.js';
import {
  BROWSER_LOCALE,
  BROWSER_TIMEZONE,
  DEFAULT_TIMEOUT_MS,
  VIEWPORT,
} from '../constants.js';
import { BaseScraper } from './base-scraper.js';
import { ScraperError, TwoFactorRetrieverMissingError } from './errors.js';
import { clickFirst, elementExists, fillFirst, waitUntil } from '../helpers/elements.js';
import { captureDiagnostics } from '../helpers/debug.js';
import { isExpired, loadSession, saveSession } from '../helpers/session.js';

export enum LoginResults {
  Success = 'SUCCESS',
  InvalidPassword = 'INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  /** The fund is asking for an SMS code. Not a failure — a second step. */
  TwoFactorRequired = 'TWO_FACTOR_REQUIRED',
  UnknownError = 'UNKNOWN_ERROR',
}

/**
 * A condition that identifies a login outcome: a URL fragment, a URL pattern, or an
 * arbitrary check against the page.
 */
export type LoginCondition = string | RegExp | ((page: Page) => Promise<boolean>);

export type PossibleLoginResults = Partial<Record<LoginResults, LoginCondition[]>>;

export interface LoginField {
  selectors: readonly string[];
  value: string;
}

/**
 * A fund's login expressed as data rather than code.
 *
 * Keeping it declarative is what makes adding a fund cheap and makes a broken login
 * a one-line fix in a selector list instead of a rewritten control flow.
 */
export interface LoginOptions {
  loginUrl: string;
  /** Built per-attempt because the values come from the member's credentials. */
  fields: (credentials: ScraperCredentials) => LoginField[];
  submitButtonSelectors: readonly string[];
  /** Runs before filling; use for cookie banners or a "log in" tab that must be opened. */
  checkReadiness?: (page: Page) => Promise<void>;
  /**
   * How to tell which outcome happened. Evaluated in order, first match wins, so put
   * the specific conditions before the general ones.
   */
  possibleResults: PossibleLoginResults;
  /** Where the OTP code is typed, when the fund asks for one. */
  otpFieldSelectors?: readonly string[];
  otpSubmitSelectors?: readonly string[];
  /** Runs after a successful login, e.g. dismissing an interstitial. */
  postLogin?: (page: Page) => Promise<void>;
}

async function conditionMatches(condition: LoginCondition, page: Page): Promise<boolean> {
  if (typeof condition === 'string') return page.url().includes(condition);
  if (condition instanceof RegExp) return condition.test(page.url());
  return condition(page);
}

/**
 * Resolves the current page to a login outcome.
 *
 * Returns null while nothing matches yet, so the caller can keep polling — a login
 * can resolve several ways at once and we want whichever actually arrives, not
 * whichever we guessed to wait on.
 */
export async function matchLoginResult(
  possibleResults: PossibleLoginResults,
  page: Page,
): Promise<LoginResults | null> {
  for (const [result, conditions] of Object.entries(possibleResults) as [
    LoginResults,
    LoginCondition[],
  ][]) {
    for (const condition of conditions) {
      if (await conditionMatches(condition, page)) return result;
    }
  }
  return null;
}

const LOGIN_RESULT_ERRORS: Partial<Record<LoginResults, ScraperErrorTypes>> = {
  [LoginResults.InvalidPassword]: ScraperErrorTypes.InvalidPassword,
  [LoginResults.ChangePassword]: ScraperErrorTypes.ChangePassword,
  [LoginResults.AccountBlocked]: ScraperErrorTypes.AccountBlocked,
  [LoginResults.UnknownError]: ScraperErrorTypes.General,
};

/**
 * Browser-backed base class: owns the browser lifecycle, the session reuse, and the
 * login state machine. Subclasses supply `getLoginOptions()` and `fetchAccounts()`.
 */
export abstract class BaseScraperWithBrowser extends BaseScraper {
  protected browser?: Browser;
  protected context?: BrowserContext;
  protected page?: Page;
  /** Set when we launched the browser ourselves and are therefore responsible for it. */
  private ownsBrowser = false;

  protected abstract getLoginOptions(): LoginOptions;

  protected abstract override fetchAccounts(): Promise<HealthAccount[]>;

  protected get activePage(): Page {
    if (!this.page) throw new ScraperError('Scraper used before initialize().');
    return this.page;
  }

  protected override async initialize(): Promise<void> {
    const timeout = this.options.timeout ?? DEFAULT_TIMEOUT_MS;

    if (this.options.browserContext) {
      this.context = this.options.browserContext;
    } else {
      this.browser =
        this.options.browser ??
        (await chromium.launch({
          headless: !this.options.showBrowser,
          // Falls back to an env override so an image shipping a Chromium build other
          // than the one Playwright pins can still be used without patching code.
          executablePath: this.options.executablePath ?? process.env.IHS_CHROMIUM_PATH,
          args: this.options.args,
        }));
      this.ownsBrowser = !this.options.browser;

      // A stored session is loaded at context creation because that is the only point
      // Playwright accepts cookies for — and reusing it is what keeps an OTP fund from
      // sending an SMS on every run.
      const stored =
        this.options.storeSession !== false ? await loadSession(this.options.companyId) : null;

      this.context = await this.browser.newContext({
        locale: BROWSER_LOCALE,
        timezoneId: BROWSER_TIMEZONE,
        viewport: { ...VIEWPORT },
        ...(stored && !isExpired(stored) ? { storageState: stored.storageState as never } : {}),
      });
    }

    this.context.setDefaultTimeout(timeout);
    this.page = await this.context.newPage();
  }

  /**
   * Checks whether the session we restored is still good, by loading the login URL and
   * seeing whether the fund lets us straight through.
   */
  private async alreadyLoggedIn(loginOptions: LoginOptions): Promise<boolean> {
    const successConditions = loginOptions.possibleResults[LoginResults.Success];
    if (!successConditions) return false;

    for (const condition of successConditions) {
      if (await conditionMatches(condition, this.activePage)) return true;
    }
    return false;
  }

  override async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const loginOptions = this.getLoginOptions();
    const page = this.activePage;

    await page.goto(loginOptions.loginUrl, { waitUntil: 'domcontentloaded' });

    if (await this.alreadyLoggedIn(loginOptions)) {
      this.log('reused stored session');
      await loginOptions.postLogin?.(page);
      return { success: true };
    }

    await loginOptions.checkReadiness?.(page);

    for (const field of loginOptions.fields(credentials)) {
      if (!(await fillFirst(page, field.selectors, field.value))) {
        throw new ScraperError(
          `Could not find a login field matching: ${field.selectors.join(', ')}`,
          ScraperErrorTypes.SelectorDrift,
        );
      }
    }

    if (!(await clickFirst(page, loginOptions.submitButtonSelectors))) {
      throw new ScraperError(
        'Could not find the login submit button.',
        ScraperErrorTypes.SelectorDrift,
      );
    }

    let result = await this.awaitLoginResult(loginOptions);

    if (result === LoginResults.TwoFactorRequired) {
      result = await this.handleTwoFactor(loginOptions);
    }

    if (result === LoginResults.Success) {
      await loginOptions.postLogin?.(page);
      await this.persistSession();
      return { success: true };
    }

    return {
      success: false,
      errorType: LOGIN_RESULT_ERRORS[result] ?? ScraperErrorTypes.General,
      errorMessage: `Login finished as ${result}.`,
    };
  }

  /** Polls until one of the declared outcomes matches, or we run out of time. */
  private async awaitLoginResult(loginOptions: LoginOptions): Promise<LoginResults> {
    let matched: LoginResults | null = null;

    const settled = await waitUntil(async () => {
      matched = await matchLoginResult(loginOptions.possibleResults, this.activePage);
      return matched !== null;
    }, this.options.timeout ?? DEFAULT_TIMEOUT_MS);

    if (!settled || matched === null) {
      const diagnostics = await captureDiagnostics(
        this.activePage,
        this.options.companyId,
        'login-unresolved',
      );
      throw new ScraperError(
        `The login did not resolve to a known outcome.${diagnostics ? ` Diagnostics: ${diagnostics}.` : ''}`,
        ScraperErrorTypes.Timeout,
      );
    }

    return matched;
  }

  /**
   * Completes the SMS step using the caller's `otpCodeRetriever`.
   *
   * Refusing loudly when no retriever was supplied is deliberate: the alternative is a
   * timeout that looks like the fund being down, when in fact nobody was ever going to
   * type the code.
   */
  private async handleTwoFactor(loginOptions: LoginOptions): Promise<LoginResults> {
    this.emitProgress(ScraperProgressTypes.LoggingIn);

    if (!this.options.otpCodeRetriever) throw new TwoFactorRetrieverMissingError();
    if (!loginOptions.otpFieldSelectors) {
      throw new ScraperError(
        'The fund asked for a one-time code but this scraper declares no OTP field.',
        ScraperErrorTypes.SelectorDrift,
      );
    }

    const code = await this.options.otpCodeRetriever();
    const page = this.activePage;

    if (!(await fillFirst(page, loginOptions.otpFieldSelectors, code))) {
      throw new ScraperError(
        'The one-time code field is no longer on the page.',
        ScraperErrorTypes.SelectorDrift,
      );
    }

    await clickFirst(page, loginOptions.otpSubmitSelectors ?? loginOptions.submitButtonSelectors);

    const result = await this.awaitLoginResult(loginOptions);

    // A second TwoFactorRequired means the code was rejected and the fund is asking
    // again; reporting that as "still waiting" would loop forever.
    return result === LoginResults.TwoFactorRequired ? LoginResults.InvalidPassword : result;
  }

  /** Saves the current cookies so the next run can skip the SMS. */
  protected async persistSession(): Promise<void> {
    if (this.options.storeSession === false || !this.context) return;
    try {
      await saveSession(this.options.companyId, await this.context.storageState());
    } catch (error) {
      // A missing IHS_SESSION_KEY should not fail a scrape that otherwise worked.
      this.log('could not persist session', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  override async terminate(success = true): Promise<void> {
    if (!success && this.page) {
      await captureDiagnostics(this.page, this.options.companyId, 'terminate-failure');
    }

    if (this.page) await this.page.close().catch(() => {});

    // Only tear down what we created: a caller who passed in a browser or context
    // keeps ownership of it.
    if (!this.options.browserContext && this.context) {
      await this.context.close().catch(() => {});
    }
    if (this.ownsBrowser && !this.options.skipCloseBrowser && this.browser) {
      await this.browser.close().catch(() => {});
    }

    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
  }

  /**
   * Runs the login only as far as triggering the SMS, leaving the browser open.
   *
   * This is what lets MCP split authentication across two tool calls: a call cannot
   * block waiting for a member to read a text, and a fresh browser would invalidate
   * the code the fund just sent.
   */
  async triggerTwoFactorAuth(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    if (!this.page) await this.initialize();

    const loginOptions = this.getLoginOptions();
    const page = this.activePage;

    await page.goto(loginOptions.loginUrl, { waitUntil: 'domcontentloaded' });
    await loginOptions.checkReadiness?.(page);

    for (const field of loginOptions.fields(credentials)) {
      await fillFirst(page, field.selectors, field.value);
    }
    await clickFirst(page, loginOptions.submitButtonSelectors);

    const result = await this.awaitLoginResult(loginOptions);

    if (result === LoginResults.TwoFactorRequired) return { success: true };
    if (result === LoginResults.Success) {
      await this.persistSession();
      return { success: true };
    }

    return {
      success: false,
      errorType: LOGIN_RESULT_ERRORS[result] ?? ScraperErrorTypes.General,
      errorMessage: `Login finished as ${result}.`,
    };
  }

  /** Submits a code obtained after `triggerTwoFactorAuth` and stores the session. */
  async getLongTermTwoFactorToken(otpCode: string): Promise<{ success: boolean; token?: string }> {
    const loginOptions = this.getLoginOptions();
    const page = this.activePage;

    if (!loginOptions.otpFieldSelectors) {
      throw new ScraperError('This scraper declares no OTP field.', ScraperErrorTypes.SelectorDrift);
    }

    if (!(await fillFirst(page, loginOptions.otpFieldSelectors, otpCode))) {
      throw new ScraperError(
        'The one-time code field is no longer on the page.',
        ScraperErrorTypes.SelectorDrift,
      );
    }
    await clickFirst(page, loginOptions.otpSubmitSelectors ?? loginOptions.submitButtonSelectors);

    const result = await this.awaitLoginResult(loginOptions);
    if (result !== LoginResults.Success) return { success: false };

    await loginOptions.postLogin?.(page);
    await this.persistSession();

    // The "token" is the stored session: the funds issue no long-lived API token, so
    // the reusable artifact is the cookie jar we just saved.
    return { success: true, token: this.options.companyId };
  }

  /** Convenience for subclasses: is any of these selectors on the page right now. */
  protected async pageHas(selectors: readonly string[]): Promise<boolean> {
    return elementExists(this.activePage, selectors);
  }
}
