import type { Page } from 'playwright';

/**
 * Selector helpers built around ordered candidate lists.
 *
 * Every lookup takes several selectors and uses the first that exists, most-semantic
 * first. That is what lets a login survive a class rename: the accessible attribute is
 * tried before the brittle CSS that happens to work today.
 */

export async function elementExists(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    if ((await page.locator(selector).count()) > 0) return true;
  }
  return false;
}

/** Fills the first selector that exists. Returns false when none do. */
export async function fillFirst(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.fill(value);
      return true;
    }
  }
  return false;
}

export async function clickFirst(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.click();
      return true;
    }
  }
  return false;
}

/** Text of the first matching element, or null. */
export async function textOfFirst(
  page: Page,
  selectors: readonly string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      const text = (await locator.textContent())?.trim();
      if (text) return text;
    }
  }
  return null;
}

/**
 * Polls `predicate` until it returns true or the deadline passes.
 *
 * Used instead of waiting on a single selector because a login can resolve several
 * ways at once — personal area, error banner, code prompt — and we need whichever
 * arrives first, not whichever we guessed.
 */
export async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
