import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';

import { HealthFundTypes, type HealthFundId } from '../../src/definitions.js';
import { resolveSnapshotBindings } from './binding-resolver.js';
import { buildFlowView } from './flow-view.js';
import { bindingDefinitionFor } from './fund-bindings.js';
import { newFlowViewPage } from './view-browser.js';

const VIEWABLE_FUNDS: HealthFundId[] = Object.values(HealthFundTypes).filter(
  (fund) => fund !== HealthFundTypes.mock,
);

function parseArgs(argv: string[]): { fund: HealthFundId; target?: string } {
  const [fund, target, ...extra] = argv;
  if (!fund || !VIEWABLE_FUNDS.includes(fund as HealthFundId) || extra.length > 0) {
    throw new Error(`Usage: calibrate:view -- <fund> [target]. Known funds: ${VIEWABLE_FUNDS.join(', ')}.`);
  }
  return { fund: fund as HealthFundId, ...(target ? { target } : {}) };
}

async function main(): Promise<void> {
  const { fund, target } = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.IHS_CHROMIUM_PATH,
    args: ['--start-maximized'],
  });
  const page = await newFlowViewPage(browser);

  try {
    const reportPath = await buildFlowView(fund, target, (entry, html) =>
      resolveSnapshotBindings(page, html, bindingDefinitionFor(fund, entry), entry.url),
    );
    await page.goto(pathToFileURL(reportPath).href);
    console.log(`Opened ${reportPath}. Press Enter to close the browser.`);
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      await rl.question('');
    } finally {
      rl.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
