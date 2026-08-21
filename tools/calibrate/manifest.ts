import fs from 'node:fs/promises';
import path from 'node:path';

import { isKnownTarget } from './target-picker.js';

export type ManifestRole =
  | {
      kind: 'before-after';
      position: 'before' | 'after';
      counterpartLabel: string;
    }
  | {
      kind: 'list-detail';
      position: 'list' | 'detail';
      counterpartLabel: string;
    }
  | { kind: 'ordered-login'; position: number }
  | { kind: 'standalone' };

/**
 * The capture manifest: one entry per snapshot, tying its label to what it's a
 * snapshot of. See CONTEXT.md's "Capture manifest" and "Target" entries.
 */
export interface ManifestEntry {
  label: string;
  target: string;
  state: string;
  url: string;
  capturedAt: string;
  /** True when `target` is not yet a modeled `FetchTarget` — a free-text calibration slug. */
  provisional: boolean;
  /** How this snapshot relates to the other snapshots in the capture session. */
  role: ManifestRole;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Filesystem- and JSON-safe identifier for one snapshot, built from its target and
 * state. Recapturing the same target/state pair reuses the same label, which is what
 * lets `mergeManifestEntry` treat a recapture as a redo rather than a duplicate.
 */
export function buildLabel(target: string, state: string): string {
  const targetSlug = slug(target);
  if (!targetSlug) throw new Error('A snapshot target is required to build its label.');

  const stateSlug = slug(state);
  return stateSlug ? `${targetSlug}--${stateSlug}` : targetSlug;
}

function roleFor(target: string, state: string, loginPosition: number): ManifestRole {
  if (target === 'login') return { kind: 'ordered-login', position: loginPosition };

  switch (state.trim().toLowerCase()) {
    case 'collapsed':
      return {
        kind: 'before-after',
        position: 'before',
        counterpartLabel: buildLabel(target, 'expanded'),
      };
    case 'expanded':
      return {
        kind: 'before-after',
        position: 'after',
        counterpartLabel: buildLabel(target, 'collapsed'),
      };
    case 'list':
      return {
        kind: 'list-detail',
        position: 'list',
        counterpartLabel: buildLabel(target, 'detail'),
      };
    case 'detail':
      return {
        kind: 'list-detail',
        position: 'detail',
        counterpartLabel: buildLabel(target, 'list'),
      };
    default:
      return { kind: 'standalone' };
  }
}

/** Recomputes relationship metadata from manifest order, including stable login positions. */
function linkManifestRoles(entries: readonly ManifestEntry[]): ManifestEntry[] {
  let loginPosition = 0;
  return entries.map((entry) => {
    if (entry.target === 'login') loginPosition += 1;
    return {
      ...entry,
      role: roleFor(entry.target, entry.state, loginPosition),
    };
  });
}

export function buildManifestEntry(params: {
  label: string;
  target: string;
  state: string;
  url: string;
  capturedAt?: string;
}): ManifestEntry {
  return {
    label: params.label,
    target: params.target,
    state: params.state,
    url: params.url,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    provisional: !isKnownTarget(params.target),
    role: roleFor(params.target, params.state, 1),
  };
}

/** Adds `entry`, replacing a recapture in place so ordered-login positions remain stable. */
export function mergeManifestEntry(
  entries: readonly ManifestEntry[],
  entry: ManifestEntry,
): ManifestEntry[] {
  const existingIndex = entries.findIndex((existing) => existing.label === entry.label);
  const merged =
    existingIndex === -1
      ? [...entries, entry]
      : entries.map((existing, index) => (index === existingIndex ? entry : existing));
  return linkManifestRoles(merged);
}

function manifestPath(dir: string): string {
  return path.join(dir, 'manifest.json');
}

/** Reads a capture session's manifest, or an empty list when none exists yet. */
export async function readManifest(dir: string): Promise<ManifestEntry[]> {
  try {
    // Re-link on read so manifests captured before role metadata was introduced are
    // upgraded in memory and become complete on the next write.
    return linkManifestRoles(JSON.parse(await fs.readFile(manifestPath(dir), 'utf8')) as ManifestEntry[]);
  } catch {
    return [];
  }
}

export async function writeManifest(dir: string, entries: readonly ManifestEntry[]): Promise<void> {
  await fs.writeFile(manifestPath(dir), JSON.stringify(entries, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}
