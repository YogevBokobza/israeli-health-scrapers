import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

import type { HealthFundId } from '../../src/definitions.js';
import { capturesDir, ensureDir } from '../../src/helpers/paths.js';
import { buildLabel, buildManifestEntry, mergeManifestEntry, readManifest, writeManifest } from './manifest.js';
import type { ManifestEntry } from './manifest.js';
import { stripInputValues } from './strip-input-values.js';

export interface CaptureRequest {
  fund: HealthFundId;
  target: string;
  state: string;
}

/**
 * Writes one snapshot — stripped HTML, a full-page screenshot, the URL, and a
 * manifest entry — under `data/captures/<fund>/`. The maintainer has already logged
 * in and revealed whatever the snapshot should show; this only records the page as
 * it stands right now.
 */
export async function captureSnapshot(page: Page, request: CaptureRequest): Promise<ManifestEntry> {
  const dir = capturesDir(request.fund);
  await ensureDir(dir);

  const label = buildLabel(request.target, request.state);
  const rawHtml = await page.evaluate(() => document.documentElement.outerHTML);
  const html = stripInputValues(rawHtml);
  const url = page.url();

  // Owner-only, like the sessions and diagnostics dumps under the same data root: a
  // capture is page HTML from a logged-in medical account.
  const screenshotPath = path.join(dir, `${label}.png`);
  await fs.writeFile(path.join(dir, `${label}.html`), html, { encoding: 'utf8', mode: 0o600 });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await fs.chmod(screenshotPath, 0o600);
  await fs.writeFile(path.join(dir, `${label}.url.txt`), url, { encoding: 'utf8', mode: 0o600 });

  const entry = buildManifestEntry({ label, target: request.target, state: request.state, url });
  await writeManifest(dir, mergeManifestEntry(await readManifest(dir), entry));

  return entry;
}
