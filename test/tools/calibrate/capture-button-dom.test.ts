import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import { injectCaptureButton } from '../../../tools/calibrate/capture-button.js';
import { browserAvailable, launchTestBrowser } from '../../browser.js';

/**
 * Exercises the injected button against a real Chromium DOM — the one part of the
 * capture button worth testing beyond pure functions, since its whole job (surviving
 * an SPA route change) only shows up in a real browser. Screenshot capture and the
 * headed-launch CLI stay untested integration shells, per the spec.
 */
describe.skipIf(!browserAvailable)('capture button', () => {
  let browser: Browser;
  let page: Page;
  const captured: Array<{ target: string; state: string }> = [];

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');
    browser = launched;
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  afterEach(async () => {
    captured.length = 0;
    await page?.close().catch(() => {});
  });

  async function pageWithButton(): Promise<Page> {
    page = await browser.newPage();
    // A real origin, not `about:blank` — `history.pushState` (used by the SPA-safety
    // hook) throws against the opaque origin `setContent` alone would leave us on.
    await page.route('**/fund-page', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body><h1>fund page</h1></body></html>' }),
    );
    await page.goto('https://calibrate.test/fund-page');
    await page.exposeFunction('__ihsCapture', async (target: string, state: string) => {
      captured.push({ target, state });
      return { ok: true, label: `${target}--${state}` };
    });
    await injectCaptureButton(page);
    return page;
  }

  it('injects a floating capture button onto the page', async () => {
    const page = await pageWithButton();

    expect(await page.locator('#ihs-calibrate-capture-button').isVisible()).toBe(true);
  });

  it('offers the known targets plus login and an "other" escape', async () => {
    const page = await pageWithButton();

    const options = await page
      .locator('#ihs-calibrate-capture-button select')
      .first()
      .locator('option')
      .allTextContents();

    expect(options).toEqual(
      expect.arrayContaining(['login', 'medications', 'appointments', 'testResults', 'vaccinations', 'other…']),
    );
  });

  it('captures the selected target and state via the exposed function', async () => {
    const page = await pageWithButton();
    const root = page.locator('#ihs-calibrate-capture-button');

    await root.locator('select').first().selectOption('vaccinations');
    await root.locator('select').nth(1).selectOption('expanded');
    await root.locator('button[type="submit"]').click();

    await expect.poll(() => root.locator('span').textContent()).toBe('captured "vaccinations--expanded"');
    expect(captured).toEqual([{ target: 'vaccinations', state: 'expanded' }]);
  });

  it('rejects a provisional target that is not a lowerCamel slug without capturing', async () => {
    const page = await pageWithButton();
    const root = page.locator('#ihs-calibrate-capture-button');

    await root.locator('select').first().selectOption('__other__');
    await root.locator('input[type="text"]').fill('Form 17');
    await root.locator('button[type="submit"]').click();

    expect(captured).toEqual([]);
    const isValid = await page.evaluate(
      () => document.querySelector<HTMLInputElement>('#ihs-calibrate-capture-button input')!.validity.valid,
    );
    expect(isValid).toBe(false);
  });

  it('accepts a lowerCamel provisional target', async () => {
    const page = await pageWithButton();
    const root = page.locator('#ihs-calibrate-capture-button');

    await root.locator('select').first().selectOption('__other__');
    await root.locator('input[type="text"]').fill('form17');
    await root.locator('button[type="submit"]').click();

    await expect.poll(() => root.locator('span').textContent()).toBe('captured "form17--"');
    expect(captured).toEqual([{ target: 'form17', state: '' }]);
  });

  it('re-creates the button after an SPA route change removes it', async () => {
    const page = await pageWithButton();

    await page.evaluate(() => {
      document.getElementById('ihs-calibrate-capture-button')?.remove();
      history.pushState({}, '', '/detail');
    });

    await expect.poll(() => page.locator('#ihs-calibrate-capture-button').isVisible()).toBe(true);
  });

  it('re-creates the button after the whole body is replaced', async () => {
    const page = await pageWithButton();

    await page.evaluate(() => {
      document.body.innerHTML = '<h1>detail page</h1>';
    });

    await expect.poll(() => page.locator('#ihs-calibrate-capture-button').isVisible()).toBe(true);
  });
});
