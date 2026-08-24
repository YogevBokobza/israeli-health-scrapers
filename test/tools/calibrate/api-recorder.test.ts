import { describe, expect, it } from 'vitest';

import {
  isPastVisitsResponse,
  pastVisitsResultsFrom,
} from '../../../tools/calibrate/api-recorder.js';

const PAST_VISITS_URL =
  'https://online.maccabi4u.co.il/sonline/AppointmentOrderAPI/webapi/mac/v1/members/12/34567890/visits/history';

describe('isPastVisitsResponse', () => {
  it('matches the past-visits list POST', () => {
    expect(isPastVisitsResponse(PAST_VISITS_URL, 'POST')).toBe(true);
    expect(isPastVisitsResponse(`${PAST_VISITS_URL}?lang=he`, 'post')).toBe(true);
  });

  it('ignores the same URL on a non-POST method', () => {
    expect(isPastVisitsResponse(PAST_VISITS_URL, 'GET')).toBe(false);
  });

  it('ignores other AppointmentOrder and test-results endpoints', () => {
    expect(
      isPastVisitsResponse(
        'https://online.maccabi4u.co.il/sonline/AppointmentOrderAPI/webapi/mac/v1/members/12/34/slots',
        'POST',
      ),
    ).toBe(false);
    expect(
      isPastVisitsResponse(
        'https://online.maccabi4u.co.il/sonline/TestResultsAPI/webapi/mac/v1/members/12/34/tests',
        'POST',
      ),
    ).toBe(false);
  });
});

describe('pastVisitsResultsFrom', () => {
  it('returns the results array of a well-shaped payload', () => {
    const results = pastVisitsResultsFrom(
      JSON.stringify({ results: [{ identification_method: 4 }, { identification_method: 1 }] }),
    );
    expect(results).toEqual([{ identification_method: 4 }, { identification_method: 1 }]);
  });

  it('is null for a body that is not JSON', () => {
    expect(pastVisitsResultsFrom('<html>401</html>')).toBeNull();
  });

  it('is null when the payload has no results array', () => {
    expect(pastVisitsResultsFrom(JSON.stringify({ results: 'nope' }))).toBeNull();
    expect(pastVisitsResultsFrom(JSON.stringify({}))).toBeNull();
    expect(pastVisitsResultsFrom(JSON.stringify(null))).toBeNull();
  });
});
