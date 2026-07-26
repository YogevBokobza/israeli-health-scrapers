import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { HealthFundId } from '../definitions.js';
import { diagnosticsDir, ensureDir } from './paths.js';

/**
 * Dumps the page HTML and a screenshot when a page object fails to find what it
 * expects. Repairing a broken selector is otherwise guesswork against a site you
 * cannot see without logging in again.
 *
 * The dump contains personal medical data, so it stays under the data root with the
 * rest of the private state and is never uploaded anywhere.
 */
export async function captureDiagnostics(
  page: Page,
  companyId: HealthFundId,
  label: string,
): Promise<string | undefined> {
  if (process.env.IHS_DIAGNOSTICS === 'off') return undefined;

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(diagnosticsDir(), `${companyId}-${label}-${stamp}`);
    await ensureDir(dir);

    await fs.writeFile(path.join(dir, 'page.html'), await page.content(), { mode: 0o600 });
    await page.screenshot({ path: path.join(dir, 'page.png'), fullPage: true });
    await fs.writeFile(path.join(dir, 'url.txt'), page.url(), { mode: 0o600 });

    return dir;
  } catch {
    // Diagnostics are best-effort: never let them mask the original failure.
    return undefined;
  }
}
