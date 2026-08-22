import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFlowView } from '../../../tools/calibrate/flow-view.js';
import type { BindingResolution } from '../../../tools/calibrate/binding-resolver.js';

describe('calibration flow view', () => {
  let dataDir: string;
  const resolutions: Record<string, BindingResolution<unknown>> = {
    medications: {
      status: 'resolved',
      bindings: [
        {
          field: 'rows',
          selector: '[data-testid="prescription-row"]',
          matchCount: 1,
          value: [{ name: 'PLACEHOLDER DRUG' }],
        },
      ],
      result: [{ name: 'PLACEHOLDER DRUG' }],
    },
    form17: {
      status: 'resolved',
      bindings: [{ field: 'rows', selector: '[role="listitem"]', matchCount: 1, value: [] }],
      result: [],
    },
  };

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ihs-flow-view-'));
    process.env.IHS_DATA_DIR = dataDir;
    const captureDir = path.join(dataDir, 'captures', 'maccabi');
    await fs.mkdir(captureDir, { recursive: true });
    await fs.writeFile(path.join(captureDir, 'medications--list.html'), '<html></html>');
    await fs.writeFile(path.join(captureDir, 'medications--list.png'), 'placeholder');
    await fs.writeFile(path.join(captureDir, 'form17--detail.html'), '<html></html>');
    await fs.writeFile(path.join(captureDir, 'form17--detail.png'), 'placeholder');
    await fs.writeFile(path.join(captureDir, 'manifest.json'), JSON.stringify([
      {
        label: 'medications--list',
        target: 'medications',
        state: 'list',
        url: 'https://example.test/medications',
        capturedAt: '2026-08-21T10:00:00.000Z',
        provisional: false,
        role: { kind: 'standalone' },
      },
      {
        label: 'form17--detail',
        target: 'form17',
        state: 'detail',
        url: 'https://example.test/form17',
        capturedAt: '2026-08-21T10:01:00.000Z',
        provisional: true,
        role: { kind: 'standalone' },
      },
    ]));
  });

  afterEach(async () => {
    delete process.env.IHS_DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('renders all captured targets, including a promoted provisional capture', async () => {
    const reportPath = await buildFlowView('maccabi', undefined, async (entry) => resolutions[entry.target]!);
    const report = await fs.readFile(reportPath, 'utf8');

    expect(report).toContain('<h2>medications</h2>');
    expect(report).toContain('[data-testid=&quot;prescription-row&quot;]');
    expect(report).toContain('PLACEHOLDER DRUG');
    expect(report).toContain('<h2>form17</h2>');
    expect(report).toContain('[role=&quot;listitem&quot;]');
    expect(report).not.toContain('Pending reconstruction');
  });

  it('renders only the requested target', async () => {
    const reportPath = await buildFlowView('maccabi', 'medications', async (entry) => resolutions[entry.target]!);
    const report = await fs.readFile(reportPath, 'utf8');

    expect(path.basename(reportPath)).toBe('flow-view--medications.html');
    expect(report).toContain('<h2>medications</h2>');
    expect(report).not.toContain('<h2>form17</h2>');
  });
});
