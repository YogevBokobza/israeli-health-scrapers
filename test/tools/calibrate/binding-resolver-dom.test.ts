import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import {
  maccabiLoginBindingDefinition,
  maccabiMedicationBindingDefinition,
} from '../../../src/scrapers/maccabi.js';
import { LoginResults } from '../../../src/scrapers/base-scraper-with-browser.js';
import { resolveSnapshotBindings } from '../../../tools/calibrate/binding-resolver.js';
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

  it('resolves current Maccabi bindings and parser results against a fixture', async () => {
    const resolution = await resolveSnapshotBindings(
      page,
      medicationsFixture,
      maccabiMedicationBindingDefinition,
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;

    const bindingsByField = new Map(
      resolution.bindings.map((binding) => [binding.field, binding]),
    );
    expect(bindingsByField.get('rows')).toEqual(
      expect.objectContaining({ field: 'rows', matchCount: 4, value: resolution.result }),
    );
    expect(bindingsByField.get('name')).toEqual(
      expect.objectContaining({
        field: 'name',
        matchCount: 3,
        value: expect.arrayContaining(['SAMPLEXIN 250MG CAP']),
      }),
    );
    expect(bindingsByField.get('isStanding')?.value).toEqual([true, true, false, true]);
    expect(resolution.result).toHaveLength(4);
    expect(resolution.result[1]).toEqual(
      expect.objectContaining({ name: 'SAMPLEXIN 250MG CAP', isStanding: true }),
    );
  });

  it('reports an empty binding for a selector that no longer matches', async () => {
    const selector = '[data-testid="missing-prescription-row"]';
    const resolution = await resolveSnapshotBindings(page, medicationsFixture, {
      bindings: [{ field: 'rows', selector, valueFromResult: (rows) => rows }],
      parse: async (fixturePage) => {
        expect(await fixturePage.locator('[data-testid="prescription-row"]').count()).toBe(4);
        return ['parser fallback'];
      },
    });

    expect(resolution).toEqual({
      status: 'resolved',
      bindings: [{ field: 'rows', selector, matchCount: 0, value: null }],
      result: ['parser fallback'],
    });
  });

  it('marks a target with no reconstructed code as pending', async () => {
    const resolution = await resolveSnapshotBindings(page, medicationsFixture, undefined);

    expect(resolution).toEqual({ status: 'pending', bindings: [], result: null });
  });

  it('uses the captured URL when resolving the current login outcome', async () => {
    const resolution = await resolveSnapshotBindings(
      page,
      '<html><body></body></html>',
      maccabiLoginBindingDefinition,
      'https://online.maccabi4u.co.il/sonline/homepage/',
    );

    expect(resolution.status).toBe('resolved');
    if (resolution.status !== 'resolved') return;
    expect(resolution.result.outcome).toBe(LoginResults.Success);
  });
});
