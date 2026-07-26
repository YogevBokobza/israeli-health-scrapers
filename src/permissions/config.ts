import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const rateLimitSchema = z.object({
  perHour: z.number().int().positive(),
});

const profileSchema = z.object({
  /** Scope patterns granted to this profile. */
  scopes: z.array(z.string()).default([]),
  /** Scope patterns that additionally require the confirm round-trip. */
  requireConfirmation: z.array(z.string()).default([]),
  /** Scope pattern -> limit. */
  rateLimits: z.record(rateLimitSchema).default({}),
});

export const policyFileSchema = z.object({
  defaultProfile: z.string(),
  profiles: z.record(profileSchema),
});

export type PolicyProfile = z.infer<typeof profileSchema>;
export type PolicyFile = z.infer<typeof policyFileSchema>;

/**
 * The built-in policy when no file is present.
 *
 * It grants reads and nothing else. A misconfigured deployment should be useless,
 * not permissive.
 */
export const DEFAULT_POLICY: PolicyFile = {
  defaultProfile: 'readonly',
  profiles: {
    readonly: {
      scopes: ['*:*:read'],
      requireConfirmation: [],
      rateLimits: {},
    },
  },
};

export interface ResolvedPolicy {
  profileName: string;
  profile: PolicyProfile;
  /**
   * Hard global override from IHS_MODE=readonly. No profile can escalate past it —
   * it is checked separately from the grant list precisely so a policy file edit
   * cannot turn writes back on.
   */
  readOnlyMode: boolean;
}

export function policyFilePath(): string {
  return process.env.IHS_POLICY_FILE ?? path.resolve(process.cwd(), 'health.policy.json');
}

export function loadPolicyFile(filePath = policyFilePath()): PolicyFile {
  if (!fs.existsSync(filePath)) return DEFAULT_POLICY;
  const parsed = policyFileSchema.safeParse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid policy file at ${filePath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Picks the active profile. IHS_PROFILE wins over the file's defaultProfile so a
 * single install can serve a cautious agent and a trusted CLI from one policy file.
 */
export function resolvePolicy(file: PolicyFile = loadPolicyFile()): ResolvedPolicy {
  const profileName = process.env.IHS_PROFILE ?? file.defaultProfile;
  const profile = file.profiles[profileName];

  if (!profile) {
    throw new Error(
      `Policy profile "${profileName}" is not defined. Available: ${Object.keys(file.profiles).join(', ')}`,
    );
  }

  return {
    profileName,
    profile,
    readOnlyMode: process.env.IHS_MODE === 'readonly',
  };
}
