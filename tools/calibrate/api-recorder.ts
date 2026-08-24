import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, Response } from 'playwright';

import { HealthFundTypes, type HealthFundId } from '../../src/definitions.js';
import { capturesDir, ensureDir } from '../../src/helpers/paths.js';
import { auditPastVisitsPayload, formatIdentificationAudit } from './identification-audit.js';

/**
 * Matches the Maccabi past-visits list POST — the one response that carries
 * `identification_method`, which lives only in the AppointmentOrder API JSON and never in
 * the DOM the capture button snapshots. Matched on the API's own path segments rather
 * than the full URL because the member id/code sit in the middle of it.
 */
export function isPastVisitsResponse(url: string, method: string): boolean {
  return (
    method.toUpperCase() === 'POST' &&
    url.includes('/AppointmentOrderAPI/') &&
    /\/visits\/history(?:$|[/?#])/.test(url)
  );
}

/** The `results` array of a past-visits payload, or null when the body is not that shape. */
export function pastVisitsResultsFrom(
  bodyText: string,
): { identification_method?: number | null }[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const results = (parsed as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? (results as { identification_method?: number | null }[]) : null;
}

/**
 * The lobby HTML a prior Capture click saved for this fund, when one exists — so the
 * audit can correlate the code distribution against the digital-badge count on the same
 * page. Best-effort: no capture yet, or an unreadable one, just leaves the count to the eye.
 */
async function findPastVisitsHtml(dir: string): Promise<string | undefined> {
  try {
    const files = await fs.readdir(dir);
    const match = files.find((file) => file.startsWith('pastvisits') && file.endsWith('.html'));
    if (!match) return undefined;
    return await fs.readFile(path.join(dir, match), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Persists one past-visits payload and prints its identification_method audit. The JSON
 * is owner-only, like every other dump under `data/` — it is a logged-in medical account's
 * visit list. Returns the file it wrote so a caller (and the tests) can see where it landed.
 */
async function recordPastVisits(
  fund: HealthFundId,
  bodyText: string,
  results: readonly { identification_method?: number | null }[],
): Promise<string> {
  const dir = path.join(capturesDir(fund), 'api');
  await ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `past-visits-${stamp}.json`);
  await fs.writeFile(file, bodyText, { encoding: 'utf8', mode: 0o600 });

  const html = await findPastVisitsHtml(capturesDir(fund));
  const audit = auditPastVisitsPayload(results, html);
  console.log(`\n[api-recorder] captured past visits → ${file}`);
  console.log(formatIdentificationAudit(audit));
  if (html === undefined) {
    console.log(
      '  (tip: click Capture with target "pastVisits" on this lobby to save its HTML and auto-correlate the badge count.)\n',
    );
  }
  return file;
}

/**
 * Watches calibration network traffic for the one response the isDigital mapping is
 * verified from. Only Maccabi has a modeled API today; other funds attach nothing.
 * Thin glue over the tested pieces — `isPastVisitsResponse` and `pastVisitsResultsFrom`
 * are what decide whether a response is the right one.
 */
export async function installApiRecorder(page: Page, fund: HealthFundId): Promise<void> {
  if (fund !== HealthFundTypes.maccabi) return;

  page.on('response', (response: Response) => {
    void (async () => {
      const request = response.request();
      if (!isPastVisitsResponse(response.url(), request.method())) return;
      const bodyText = await response.text().catch(() => '');
      const results = pastVisitsResultsFrom(bodyText);
      if (!results) return;
      await recordPastVisits(fund, bodyText, results);
    })().catch((error: unknown) => {
      console.error(`[api-recorder] ${error instanceof Error ? error.message : String(error)}`);
    });
  });
}
