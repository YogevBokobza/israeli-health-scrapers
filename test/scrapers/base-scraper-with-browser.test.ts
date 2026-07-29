import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';

import {
  LoginResults,
  waitForInitialLoginState,
  type LoginField,
  type PossibleLoginResults,
} from '../../src/scrapers/base-scraper-with-browser.js';

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
