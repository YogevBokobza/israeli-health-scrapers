import { describe, expect, it } from 'vitest';

import {
  CAPTURE_STATES,
  CAPTURE_TARGETS,
  isKnownTarget,
  isLowerCamelSlug,
  validateCaptureTarget,
} from '../../../tools/calibrate/target-picker.js';

describe('CAPTURE_TARGETS', () => {
  it('includes login alongside every FetchTarget', () => {
    expect(CAPTURE_TARGETS).toContain('login');
    expect(CAPTURE_TARGETS).toContain('medications');
    expect(CAPTURE_TARGETS).toContain('vaccinations');
  });
});

describe('CAPTURE_STATES', () => {
  it('offers the four before/after and list/detail states', () => {
    expect(CAPTURE_STATES).toEqual(['collapsed', 'expanded', 'list', 'detail']);
  });
});

describe('isKnownTarget', () => {
  it('accepts a modeled FetchTarget', () => {
    expect(isKnownTarget('medications')).toBe(true);
  });

  it('accepts login', () => {
    expect(isKnownTarget('login')).toBe(true);
  });

  it('rejects a target outside the known set', () => {
    expect(isKnownTarget('form17')).toBe(false);
  });
});

describe('isLowerCamelSlug', () => {
  it('accepts a lowerCamel word', () => {
    expect(isLowerCamelSlug('form17')).toBe(true);
  });

  it('rejects an upperCamel word', () => {
    expect(isLowerCamelSlug('Form17')).toBe(false);
  });

  it('rejects a value with spaces', () => {
    expect(isLowerCamelSlug('form 17')).toBe(false);
  });

  it('rejects a kebab-case value', () => {
    expect(isLowerCamelSlug('form-17')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isLowerCamelSlug('')).toBe(false);
  });
});

describe('validateCaptureTarget', () => {
  it('accepts a known target', () => {
    expect(validateCaptureTarget('appointments')).toEqual({ ok: true });
  });

  it('accepts a lowerCamel provisional target', () => {
    expect(validateCaptureTarget('form17')).toEqual({ ok: true });
  });

  it('rejects a blank target', () => {
    const result = validateCaptureTarget('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects a provisional target that is not a lowerCamel slug', () => {
    const result = validateCaptureTarget('Form 17');
    expect(result).toEqual({
      ok: false,
      error: '"Form 17" must be a lowerCamel slug (e.g. form17) to use as a provisional target.',
    });
  });
});
