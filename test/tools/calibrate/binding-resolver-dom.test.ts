import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import { resolveSnapshotBindings } from '../../../tools/calibrate/binding-resolver.js';
import { maccabiBindingDefinitions } from '../../../tools/calibrate/maccabi-bindings.js';
import { browserAvailable, launchTestBrowser } from '../../browser.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/maccabi',
);
const medicationsFixture = fs.readFileSync(path.join(fixturesDir, 'medications.html'), 'utf8');

describe.skipIf(!browserAvailable)('binding resolver', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('resolves current Maccabi bindings and parser results against a snapshot', async () => {
    const resolution = await resolveSnapshotBindings(
      page,
      medicationsFixture,
      maccabiBindingDefinitions.medications,
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;

    expect(resolution.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'rows', matchCount: 4 }),
        expect.objectContaining({
          field: 'name',
          matchCount: 3,
          values: expect.arrayContaining(['SAMPLEXIN 250MG CAP']),
        }),
      ]),
    );
    expect(resolution.result).toHaveLength(4);
    expect(resolution.result[1]).toEqual(
      expect.objectContaining({ name: 'SAMPLEXIN 250MG CAP', isStanding: true }),
    );
  });

  it('reports an empty binding for a selector that no longer matches', async () => {
    const selector = '[data-testid="missing-prescription-row"]';
    const resolution = await resolveSnapshotBindings(page, medicationsFixture, {
      bindings: [{ field: 'rows', selector }],
      parse: (snapshotPage) => snapshotPage.locator(selector).allTextContents(),
    });

    expect(resolution).toEqual({
      status: 'resolved',
      bindings: [{ field: 'rows', selector, matchCount: 0, values: [] }],
      result: [],
    });
  });

  it('marks a target with no reconstructed code as pending', async () => {
    const resolution = await resolveSnapshotBindings(page, medicationsFixture, undefined);

    expect(resolution).toEqual({ status: 'pending', bindings: [], result: null });
  });
});
