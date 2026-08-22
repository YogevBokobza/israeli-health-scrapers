import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';

import {
  BaseScraperWithBrowser,
  LoginResults,
  waitForInitialLoginState,
  type LoginField,
  type LoginOptions,
  type PossibleLoginResults,
} from '../../src/scrapers/base-scraper-with-browser.js';
import { HealthFundTypes, type HealthAccount, type ScraperOptions } from '../../src/definitions.js';

function delayedPage(counts: Record<string, number[]>): Page {
  const attempts = new Map<string, number>();

  return {
    url: () => 'https://example.test/home',
    locator: (selector: string) => ({
      count: async () => {
        const attempt = attempts.get(selector) ?? 0;
        attempts.set(selector, attempt + 1);
        return counts[selector]?.[attempt] ?? counts[selector]?.at(-1) ?? 0;
      },
    }),
  } as unknown as Page;
}

const possibleResults: PossibleLoginResults = {
  [LoginResults.Success]: [async (page) => (await page.locator('[data-logged-in]').count()) > 0],
};

const fields: LoginField[] = [{ selectors: ['input[name="id"]'], value: '000000000' }];

describe('waitForInitialLoginState', () => {
  it('waits through a loading shell until the restored session renders a success marker', async () => {
    const page = delayedPage({
      '[data-logged-in]': [0, 1],
      'input[name="id"]': [0, 0],
    });

    await expect(waitForInitialLoginState(possibleResults, fields, page, 1_200)).resolves.toBe(
      'logged-in',
    );
  });

  it('returns as soon as the login form renders', async () => {
    const page = delayedPage({
      '[data-logged-in]': [0],
      'input[name="id"]': [1],
    });

    await expect(waitForInitialLoginState(possibleResults, fields, page, 1_200)).resolves.toBe(
      'login-form',
    );
  });
});

class TestScraper extends BaseScraperWithBrowser {
  constructor(options: ScraperOptions, private readonly loginOptions: LoginOptions, page: Page) {
    super(options);
    this.page = page;
  }

  protected getLoginOptions(): LoginOptions {
    return this.loginOptions;
  }

  protected override async fetchAccounts(): Promise<HealthAccount[]> {
    return [];
  }
}

describe('triggerTwoFactorAuth', () => {
  it('runs afterSubmit before polling for an outcome, so a fund with an interim verification-method screen (submit id -> pick SMS/call/password -> OTP field) is not left stuck on the picker', async () => {
    // Mirrors the real Maccabi bug: the OTP field only "appears" once afterSubmit has
    // clicked past the interim picker screen — exactly what triggerTwoFactorAuth used
    // to skip.
    let pastPickerScreen = false;

    const page = {
      url: () => 'https://example.test/login',
      goto: async () => {},
      locator: () => ({
        first: () => ({ count: async () => 1, fill: async () => {}, click: async () => {} }),
        count: async () => (pastPickerScreen ? 1 : 0),
      }),
    } as unknown as Page;

    const loginOptions: LoginOptions = {
      loginUrl: 'https://example.test/login',
      fields: () => [{ selectors: ['input#id'], value: '000000000' }],
      submitButtonSelectors: ['button[type="submit"]'],
      afterSubmit: async () => {
        pastPickerScreen = true;
      },
      possibleResults: {
        [LoginResults.TwoFactorRequired]: [
          async (p) => (await p.locator('input[name="otp"]').count()) > 0,
        ],
      },
    };

    const scraper = new TestScraper(
      { companyId: HealthFundTypes.maccabi, timeout: 500 },
      loginOptions,
      page,
    );

    await expect(scraper.triggerTwoFactorAuth({ id: '000000000' })).resolves.toEqual({
      success: true,
    });
  });
});
