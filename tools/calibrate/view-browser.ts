import type { Browser, Page } from 'playwright';

/** Creates a report page that follows the real window when Chrome is resized. */
export async function newFlowViewPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: null });
  return context.newPage();
}
