#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { HealthFundTypes, type HealthFundId } from '../definitions.js';
import { findOperation, operationsFor } from '../operations.js';
import { enabledFunds } from '../scrapers/factory.js';
import { requireCredentialsFromEnv } from '../helpers/credentials.js';
import { PermissionEngine } from '../permissions/engine.js';

/**
 * Runs a single operation from the terminal, through the same permission engine the
 * MCP server uses — so a policy that refuses an agent refuses the CLI identically, and
 * testing the policy does not require an agent.
 *
 * Usage: npm run action -- maccabi medications.list '{"expiringWithinDays":30}'
 */
async function main(): Promise<void> {
  const [companyIdArg, operationName, inputJson] = process.argv.slice(2);

  if (!operationName) {
    stdout.write('Usage: npm run action -- <fund> <operation> [inputJson]\n\n');
    for (const fund of enabledFunds()) {
      for (const operation of operationsFor(fund)) {
        stdout.write(`  ${fund} ${operation.name}  — ${operation.title}\n`);
      }
    }
    process.exitCode = 1;
    return;
  }

  const companyId = (companyIdArg ?? HealthFundTypes.maccabi) as HealthFundId;
  const operation = findOperation(companyId, operationName);

  if (!operation) {
    stdout.write(`Unknown operation "${operationName}" for ${companyId}.\n`);
    process.exitCode = 1;
    return;
  }

  const input = operation.input.parse(inputJson ? JSON.parse(inputJson) : undefined);
  const permissions = new PermissionEngine();

  // A write operation from the CLI still goes through the confirmation round-trip; the
  // difference is that here the human answering is the one who typed the command.
  await permissions.authorize(operation, input).catch(async (error: unknown) => {
    if (error && typeof error === 'object' && 'confirmationToken' in error) {
      const { preview, confirmationToken } = error as {
        preview: string;
        confirmationToken: string;
      };
      const rl = readline.createInterface({ input: stdin, output: stdout });
      try {
        stdout.write(`\n${preview}\n\n`);
        const answer = (await rl.question('לבצע? [y/N] ')).trim().toLowerCase();
        if (answer !== 'y') throw new Error('בוטל.');
        await permissions.authorize(operation, input, { confirmationToken });
      } finally {
        rl.close();
      }
      return;
    }
    throw error;
  });

  const credentials = requireCredentialsFromEnv(companyId);
  const result = await operation.run(input as never, {
    credentials,
    scraperOptions: { verbose: process.argv.includes('--verbose') },
  });

  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
