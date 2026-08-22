import { describe, expect, it } from 'vitest';

import { buildLabel, buildManifestEntry, mergeManifestEntry } from '../../../tools/calibrate/manifest.js';

describe('buildLabel', () => {
  it('joins a target and a state into one filesystem-safe label', () => {
    expect(buildLabel('medications', 'expanded')).toBe('medications--expanded');
  });

  it('slugs spaces and mixed case in either part', () => {
    expect(buildLabel('Test Results', 'List View')).toBe('test-results--list-view');
  });

  it('omits the separator when no state is given', () => {
    expect(buildLabel('login', '')).toBe('login');
  });

  it('accepts a lowerCamel provisional target slug unchanged in shape', () => {
    expect(buildLabel('form17', 'collapsed')).toBe('form17--collapsed');
  });

  it('throws when the target is blank', () => {
    expect(() => buildLabel('   ', 'expanded')).toThrow();
  });
});

describe('buildManifestEntry', () => {
  it('marks a known FetchTarget as not provisional', () => {
    const entry = buildManifestEntry({
      label: 'medications--expanded',
      target: 'medications',
      state: 'expanded',
      url: 'https://example.test/medications',
      capturedAt: '2026-08-21T10:00:00.000Z',
    });

    expect(entry).toEqual({
      label: 'medications--expanded',
      target: 'medications',
      state: 'expanded',
      url: 'https://example.test/medications',
      capturedAt: '2026-08-21T10:00:00.000Z',
      provisional: false,
      role: {
        kind: 'before-after',
        position: 'after',
        counterpartLabel: 'medications--collapsed',
      },
    });
  });

  it('marks "login" as not provisional', () => {
    const entry = buildManifestEntry({
      label: 'login--id-screen',
      target: 'login',
      state: 'id-screen',
      url: 'https://example.test/login',
    });

    expect(entry.provisional).toBe(false);
    expect(entry.role).toEqual({ kind: 'ordered-login', position: 1 });
  });

  it('marks a target outside the known set as provisional', () => {
    const entry = buildManifestEntry({
      label: 'futureTarget--collapsed',
      target: 'futureTarget',
      state: 'collapsed',
      url: 'https://example.test/forms/17',
    });

    expect(entry.provisional).toBe(true);
    expect(entry.role).toEqual({
      kind: 'before-after',
      position: 'before',
      counterpartLabel: 'futuretarget--expanded',
    });
  });

  it.each([
    ['collapsed', 'before', 'vaccinations--expanded'],
    ['expanded', 'after', 'vaccinations--collapsed'],
  ] as const)('links the %s state into a before/after pair', (state, position, counterpartLabel) => {
    const entry = buildManifestEntry({
      label: `vaccinations--${state}`,
      target: 'vaccinations',
      state,
      url: 'https://example.test/vaccinations',
    });

    expect(entry.role).toEqual({ kind: 'before-after', position, counterpartLabel });
  });

  it.each([
    ['list', 'list', 'appointments--detail'],
    ['detail', 'detail', 'appointments--list'],
  ] as const)('links the %s state into a list/detail pair', (state, position, counterpartLabel) => {
    const entry = buildManifestEntry({
      label: `appointments--${state}`,
      target: 'appointments',
      state,
      url: 'https://example.test/appointments',
    });

    expect(entry.role).toEqual({ kind: 'list-detail', position, counterpartLabel });
  });

  it('records a custom non-login state as standalone', () => {
    const entry = buildManifestEntry({
      label: 'medications--archived',
      target: 'medications',
      state: 'archived',
      url: 'https://example.test/medications',
    });

    expect(entry.role).toEqual({ kind: 'standalone' });
  });

  it('defaults capturedAt to now when not given', () => {
    const before = Date.now();
    const entry = buildManifestEntry({
      label: 'medications--list',
      target: 'medications',
      state: 'list',
      url: 'https://example.test/medications',
    });
    const after = Date.now();

    expect(Date.parse(entry.capturedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(entry.capturedAt)).toBeLessThanOrEqual(after);
  });
});

describe('mergeManifestEntry', () => {
  const first = buildManifestEntry({
    label: 'medications--collapsed',
    target: 'medications',
    state: 'collapsed',
    url: 'https://example.test/medications',
    capturedAt: '2026-08-21T10:00:00.000Z',
  });
  const second = buildManifestEntry({
    label: 'medications--expanded',
    target: 'medications',
    state: 'expanded',
    url: 'https://example.test/medications',
    capturedAt: '2026-08-21T10:05:00.000Z',
  });

  it('appends a new label onto an empty list', () => {
    expect(mergeManifestEntry([], first)).toEqual([first]);
  });

  it('appends a new label alongside existing entries', () => {
    expect(mergeManifestEntry([first], second)).toEqual([first, second]);
  });

  it('replaces an existing entry sharing the same label, rather than duplicating it', () => {
    const recaptured = buildManifestEntry({
      label: 'medications--collapsed',
      target: 'medications',
      state: 'collapsed',
      url: 'https://example.test/medications?v=2',
      capturedAt: '2026-08-21T11:00:00.000Z',
    });

    const merged = mergeManifestEntry([first, second], recaptured);

    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual(recaptured);
    expect(merged).not.toContainEqual(first);
    expect(merged).toContainEqual(second);
  });

  it('orders login screens by first capture and keeps that order when one is recaptured', () => {
    const idScreen = buildManifestEntry({
      label: 'login--id-screen',
      target: 'login',
      state: 'id-screen',
      url: 'https://example.test/login/id',
      capturedAt: '2026-08-21T10:00:00.000Z',
    });
    const otpScreen = buildManifestEntry({
      label: 'login--otp-screen',
      target: 'login',
      state: 'otp-screen',
      url: 'https://example.test/login/otp',
      capturedAt: '2026-08-21T10:01:00.000Z',
    });

    const captured = mergeManifestEntry(mergeManifestEntry([], idScreen), otpScreen);

    expect(captured.map((entry) => entry.role)).toEqual([
      { kind: 'ordered-login', position: 1 },
      { kind: 'ordered-login', position: 2 },
    ]);

    const recapturedIdScreen = buildManifestEntry({
      label: 'login--id-screen',
      target: 'login',
      state: 'id-screen',
      url: 'https://example.test/login/id?retry=1',
      capturedAt: '2026-08-21T10:02:00.000Z',
    });
    const recaptured = mergeManifestEntry(captured, recapturedIdScreen);

    expect(recaptured.map((entry) => entry.label)).toEqual(['login--id-screen', 'login--otp-screen']);
    expect(recaptured.map((entry) => entry.role)).toEqual([
      { kind: 'ordered-login', position: 1 },
      { kind: 'ordered-login', position: 2 },
    ]);
  });
});
