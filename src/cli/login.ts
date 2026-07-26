#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { HealthFundTypes, type HealthFundId } from '../definitions.js';
import { SCRAPERS, createScraper } from '../scrapers/factory.js';
import { requireCredentialsFromEnv } from '../helpers/credentials.js';

/**
 * One-time interactive login.
 *
 * This is the recommended way to authenticate: the member types their own code into
 * their own terminal, the session is stored, and every later run — including anything
 * an agent triggers — works off that session without a credential ever passing through
 * the agent.
 *
 * Usage: npm run login -- maccabi [--headless]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const companyId = (args.find((a) => !a.startsWith('--')) ?? HealthFundTypes.maccabi) as HealthFundId;

  // Headed by default: a first login is exactly when a CAPTCHA or an unexpected consent
  // screen shows up, and those are only solvable if the member can see the page.
  const showBrowser = !args.includes('--headless');

  const credentials = requireCredentialsFromEnv(companyId);
  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write(`מתחבר ל${SCRAPERS[companyId].name}...\n`);

  const scraper = createScraper({
    companyId,
    showBrowser,
    storeSession: true,
    verbose: args.includes('--verbose'),
    // Asked for only if the fund actually requests a code.
    otpCodeRetriever: async () => (await rl.question('הזן את קוד ה-SMS: ')).trim(),
  });

  try {
    const result = await scraper.login(credentials);

    if (!result.success) {
      stdout.write(`ההתחברות נכשלה: ${result.errorType} — ${result.errorMessage}\n`);
      process.exitCode = 1;
      return;
    }

    stdout.write('ההתחברות הושלמה וה-session נשמר.\n');
  } finally {
    rl.close();
    await scraper.terminate(true).catch(() => {});
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
