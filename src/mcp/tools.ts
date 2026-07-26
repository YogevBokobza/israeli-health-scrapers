import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { HealthFundId } from '../definitions.js';
import { SCRAPERS, enabledFunds } from '../scrapers/factory.js';
import { allOperations, type Operation } from '../operations.js';
import type { PermissionEngine } from '../permissions/engine.js';

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  operation: Operation<never, unknown>;
  companyId: HealthFundId;
}

/**
 * Tool names stay unqualified while a single fund is configured (`medications_list`)
 * and gain a fund prefix once more than one is (`maccabi_medications_list`).
 *
 * The input schema is identical either way, so a prompt written against one fund keeps
 * working when a second is added.
 */
export function toolNameFor(operation: Operation<never, unknown>, qualify: boolean): string {
  const base = operation.name.replace(/\./g, '_');
  return qualify ? `${operation.companyId}_${base}` : base;
}

/**
 * The tool list for the current policy.
 *
 * Only operations the profile may call are returned — an agent is never shown a tool it
 * would be refused for, so it cannot report a capability the member did not grant.
 */
export function buildToolDescriptors(permissions: PermissionEngine): McpToolDescriptor[] {
  const funds = enabledFunds();
  const qualify = funds.length > 1;

  return permissions.visibleOperations(allOperations(funds)).map((operation) => ({
    name: toolNameFor(operation, qualify),
    description: `[${SCRAPERS[operation.companyId].name} · ${
      operation.capability === 'write' ? 'כתיבה' : 'קריאה'
    }] ${operation.title}`,
    inputSchema: toolInputSchema(operation),
    operation,
    companyId: operation.companyId,
  }));
}

/**
 * The tool's input schema: the operation's own input, plus `confirmationToken` for
 * write operations so the confirm round-trip is a visible part of the contract instead
 * of something the agent has to infer from an error message.
 */
function toolInputSchema(operation: Operation<never, unknown>): Record<string, unknown> {
  const schema =
    operation.capability === 'write'
      ? z.intersection(
          operation.input as z.ZodType<unknown>,
          z.object({
            confirmationToken: z
              .string()
              .optional()
              .describe(
                'Token from the previous preview call. Omit on the first call to receive a preview.',
              ),
          }),
        )
      : (operation.input as z.ZodType<unknown>);

  return zodToJsonSchema(schema, { target: 'jsonSchema7' }) as Record<string, unknown>;
}
