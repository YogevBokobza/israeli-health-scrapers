import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';

import { HealthFundTypes, type HealthFundId } from '../../src/definitions.js';
import { BROWSER_LOCALE, BROWSER_TIMEZONE, VIEWPORT } from '../../src/constants.js';
import { isExpired, loadSession } from '../../src/helpers/session.js';
import { installCaptureButton } from './capture-button.js';
import { installApiRecorder } from './api-recorder.js';
import { fundStartUrl } from './fund-start-urls.js';

/** Real funds only — `mock` is a fixture-backed id with no site to calibrate against. */
const CALIBRATABLE_FUNDS: HealthFundId[] = Object.values(HealthFundTypes).filter(
  (id) => id !== HealthFundTypes.mock,
);

function parseFund(argv: string[]): HealthFundId {
  const [fund] = argv;
  if (!fund || !CALIBRATABLE_FUNDS.includes(fund as HealthFundId)) {
    throw new Error(`Usage: calibrate -- <fund>. Known funds: ${CALIBRATABLE_FUNDS.join(', ')}.`);
  }
  return fund as HealthFundId;
}

async function main(): Promise<void> {
  const fund = parseFund(process.argv.slice(2));

  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.IHS_CHROMIUM_PATH,
  });

  // Reusing a stored session is a fast path only: capture must work identically for a
  // fund with no scraper — and therefore no stored session — implemented yet.
  const stored = await loadSession(fund).catch(() => null);
  const reuseSession = stored !== null && !isExpired(stored);

  const context = await browser.newContext({
    locale: BROWSER_LOCALE,
    timezoneId: BROWSER_TIMEZONE,
    viewport: { ...VIEWPORT },
    ...(reuseSession ? { storageState: stored!.storageState as never } : {}),
  });
  const page = await context.newPage();

  console.log(
    reuseSession
      ? `Reused the stored session for ${fund} — navigate to what you want to capture.`
      : `No stored session for ${fund} — log in by hand, then navigate to what you want to capture.`,
  );
  console.log(
    'A capture button is floating on the page — pick a target and state there, then click Capture.\n' +
      'It survives navigating around the site. Press Enter here when you are done to close the browser.\n',
  );
  if (fund === HealthFundTypes.maccabi) {
    console.log(
      'Opening the past-visits lobby also prints its identification_method distribution here\n' +
        '(the isDigital audit) and saves the API JSON under data/captures/maccabi/api/.\n',
    );
  }

  await installCaptureButton(page, fund);
  // Records API JSON the DOM snapshot can't — Maccabi's past-visits list carries
  // identification_method only here. Prints the code distribution when that list loads.
  await installApiRecorder(page, fund);
  await page.goto(fundStartUrl(fund), { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    await rl.question('');
  } finally {
    rl.close();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
