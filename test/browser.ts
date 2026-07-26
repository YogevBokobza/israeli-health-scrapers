import fs from 'node:fs';
import { chromium, type Browser } from 'playwright';

/**
 * Resolves a usable Chromium for the browser-backed tests.
 *
 * Playwright pins a browser build per version, so an image that ships a different
 * build (a CI runner, this dev container) has a working browser at a path Playwright
 * will not look in. PLAYWRIGHT_CHROMIUM_PATH points at it explicitly.
 */
export function chromiumExecutablePath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    process.env.IHS_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
  ].filter((p): p is string => Boolean(p));

  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * Launches a browser, or returns null when none is available.
 *
 * Callers must use this with `describe.skipIf` so a missing browser shows up as a
 * visibly skipped suite. Returning null into a test that then `return`s early would
 * make the suite pass while asserting nothing — worse than having no test at all.
 */
export async function launchTestBrowser(): Promise<Browser | null> {
  try {
    return await chromium.launch({ executablePath: chromiumExecutablePath() });
  } catch {
    return null;
  }
}

/** Whether a browser binary exists at all. Evaluated synchronously for skipIf. */
export const browserAvailable = chromiumExecutablePath() !== undefined;
