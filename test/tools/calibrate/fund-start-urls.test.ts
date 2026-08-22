import { describe, expect, it } from 'vitest';

import { fundStartUrl } from '../../../tools/calibrate/fund-start-urls.js';
import { HealthFundTypes } from '../../../src/definitions.js';

describe('fundStartUrl', () => {
  it('starts Maccabi calibration on its login site instead of a blank page', () => {
    expect(fundStartUrl('maccabi')).toBe('https://online.maccabi4u.co.il/');
  });

  it.each([
    [HealthFundTypes.clalit, 'https://e-services.clalit.co.il/onlineweb/'],
    [HealthFundTypes.meuhedet, 'https://www.meuhedet.co.il/'],
    [HealthFundTypes.leumit, 'https://www.leumit.co.il/'],
  ] as const)('has a configured start page for %s', (fund, expected) => {
    expect(fundStartUrl(fund)).toBe(expected);
  });

  it('rejects a fund without a real calibration site', () => {
    expect(() => fundStartUrl(HealthFundTypes.mock)).toThrow('No calibration start URL');
  });
});
