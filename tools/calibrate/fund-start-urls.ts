import { HealthFundTypes, type HealthFundId } from '../../src/definitions.js';

const FUND_START_URLS: Partial<Record<HealthFundId, string>> = {
  [HealthFundTypes.maccabi]: 'https://online.maccabi4u.co.il/',
  [HealthFundTypes.clalit]: 'https://e-services.clalit.co.il/onlineweb/',
  [HealthFundTypes.meuhedet]: 'https://www.meuhedet.co.il/',
  [HealthFundTypes.leumit]: 'https://www.leumit.co.il/',
};

export function fundStartUrl(fund: HealthFundId): string {
  const url = FUND_START_URLS[fund];
  if (!url) throw new Error(`No calibration start URL is configured for ${fund}.`);
  return url;
}
