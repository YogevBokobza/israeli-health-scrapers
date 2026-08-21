import fs from 'node:fs/promises';
import path from 'node:path';

import { FETCH_TARGETS } from '../../src/definitions.js';

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
}

/**
 * Targets the manifest already knows about; anything else is a provisional target.
 * `login` is not a `FetchTarget` — it is the one other value the capture picker offers.
 */
const KNOWN_TARGETS: ReadonlySet<string> = new Set<string>(['login', ...FETCH_TARGETS]);

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
    provisional: !KNOWN_TARGETS.has(params.target),
  };
}

/** Adds `entry`, replacing any existing entry with the same label rather than duplicating it. */
export function mergeManifestEntry(
  entries: readonly ManifestEntry[],
  entry: ManifestEntry,
): ManifestEntry[] {
  return [...entries.filter((existing) => existing.label !== entry.label), entry];
}

function manifestPath(dir: string): string {
  return path.join(dir, 'manifest.json');
}

/** Reads a capture session's manifest, or an empty list when none exists yet. */
export async function readManifest(dir: string): Promise<ManifestEntry[]> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(dir), 'utf8')) as ManifestEntry[];
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
