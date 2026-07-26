import { describe, expect, it } from 'vitest';

import {
  chooseTable,
  mapHeaders,
  matchHeaderToField,
  rowToMedication,
  tableToRawRows,
  type ScrapedTable,
} from '../../src/scrapers/maccabi.js';
import { medicationSchema } from '../../src/definitions.js';

const NOW = new Date('2026-07-26T12:00:00Z');

/** The prescriptions table from the fixture, as `scrapeTables` would return it. */
const prescriptionsTable: ScrapedTable = {
  headers: [
    'שם התרופה',
    'מינון',
    'צורת מתן',
    'רופא מטפל',
    'ניפוק אחרון',
    'בתוקף עד',
    'ניפוקים שנותרו',
    'מרפאה',
  ],
  rows: [
    [
      'אומפרדקס 20 מ"ג',
      '20 מ"ג',
      'קפסולות',
      'ד"ר כהן רותי',
      '12/05/2026',
      '12/08/2026',
      'נותרו 2 ניפוקים',
      'מרפאת רמת אביב',
    ],
    ['ונטולין', '-', 'משאף', 'ד"ר כהן רותי', '20/01/2026', '20/04/2026', '0', 'מרפאת רמת אביב'],
    ['', '', '', '', '', '', 'סה"כ 2', ''],
  ],
};

const unrelatedTable: ScrapedTable = {
  headers: ['הודעות', 'תאריך'],
  rows: [['תזכורת לחיסון', '01/06/2026']],
};

describe('matchHeaderToField', () => {
  it('maps the Hebrew headers the fund renders', () => {
    expect(matchHeaderToField('שם התרופה')).toBe('name');
    expect(matchHeaderToField('בתוקף עד')).toBe('validUntil');
    expect(matchHeaderToField('ניפוקים שנותרו')).toBe('refills');
  });

  it('matches a longer header containing a known label', () => {
    // Real pages say "תוקף המרשם", not the bare label we listed.
    expect(matchHeaderToField('תוקף המרשם')).toBe('validUntil');
  });

  it('returns null for a column we do not model', () => {
    expect(matchHeaderToField('מרפאה')).toBeNull();
  });
});

describe('mapHeaders', () => {
  it('maps every recognizable column', () => {
    const mapping = mapHeaders(prescriptionsTable.headers);
    expect(mapping?.get(0)).toBe('name');
    expect(mapping?.get(5)).toBe('validUntil');
  });

  it('keeps the first column when two headers match the same field', () => {
    // A generic "תאריך" later in the row must not overwrite an explicit "בתוקף עד".
    const mapping = mapHeaders(['בתוקף עד', 'תוקף']);
    expect(mapping?.get(0)).toBe('validUntil');
    expect(mapping?.get(1)).toBeUndefined();
  });

  it('returns null when nothing is recognizable', () => {
    expect(mapHeaders(['foo', 'bar'])).toBeNull();
  });
});

describe('chooseTable', () => {
  it('picks the prescriptions table over an unrelated one on the same page', () => {
    const chosen = chooseTable([unrelatedTable, prescriptionsTable]);
    expect(chosen?.table).toBe(prescriptionsTable);
  });

  it('ignores a table that maps fields but never names a drug', () => {
    const datesOnly: ScrapedTable = { headers: ['בתוקף עד'], rows: [['12/08/2026']] };
    expect(chooseTable([datesOnly])).toBeNull();
  });

  it('returns null when the page has no usable table', () => {
    expect(chooseTable([unrelatedTable])).toBeNull();
  });
});

describe('tableToRawRows', () => {
  it('keeps unmapped columns under extra rather than dropping them', () => {
    const chosen = chooseTable([prescriptionsTable])!;
    const rows = tableToRawRows(chosen.table, chosen.mapping);
    expect(rows[0]?.extra).toEqual({ מרפאה: 'מרפאת רמת אביב' });
  });
});

describe('rowToMedication', () => {
  const chosen = chooseTable([prescriptionsTable])!;
  const rows = tableToRawRows(chosen.table, chosen.mapping);

  it('produces a value matching the shared schema', () => {
    const medication = rowToMedication(rows[0]!, NOW);
    expect(() => medicationSchema.parse(medication)).not.toThrow();
  });

  it('normalizes dates and derives the expiry fields', () => {
    const medication = rowToMedication(rows[0]!, NOW)!;
    expect(medication.name).toBe('אומפרדקס 20 מ"ג');
    expect(medication.validUntil).toBe('2026-08-12');
    expect(medication.lastDispensed).toBe('2026-05-12');
    expect(medication.refillsRemaining).toBe(2);
    expect(medication.daysUntilExpiry).toBe(17);
    expect(medication.status).toBe('expiring_soon');
  });

  it('marks a past prescription expired and keeps a real zero as zero', () => {
    const medication = rowToMedication(rows[1]!, NOW)!;
    expect(medication.status).toBe('expired');
    expect(medication.refillsRemaining).toBe(0);
    expect(medication.dosage).toBeNull(); // the "-" cell means "not stated"
  });

  it('drops a totals row that carries no drug name', () => {
    expect(rowToMedication(rows[2]!, NOW)).toBeNull();
  });

  it('tags every row with the fund it came from', () => {
    expect(rowToMedication(rows[0]!, NOW)?.provider).toBe('maccabi');
  });
});
