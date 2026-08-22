import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';

import {
  appointmentRowToAppointment,
  expandForm17Details,
  expandVaccinationDetails,
  form17RowToRequest,
  prescriptionRowToMedication,
  scrapeAppointmentDetail,
  scrapeAppointmentRows,
  scrapeForm17Rows,
  loadAllTestResultRows,
  loadAllForm17Rows,
  scrapePrescriptionRows,
  scrapeTestResultRows,
  testResultRowToTestResult,
  scrapeVaccinationRows,
  vaccinationRowToVaccination,
} from '../../src/scrapers/maccabi.js';
import { browserAvailable, launchTestBrowser } from '../browser.js';

/**
 * Exercises the DOM traversal against the saved fixture, in a real browser.
 *
 * The pure parser tests cover interpretation; this covers the part only a DOM can
 * exercise — which elements are found inside each prescription-row card.
 *
 * The suite is skipped, visibly, when no browser binary exists. It must never degrade
 * into tests that return early and pass while asserting nothing.
 */

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/maccabi');
const fixture = fs.readFileSync(path.join(fixturesDir, 'medications.html'), 'utf8');
const appointmentsFixture = fs.readFileSync(path.join(fixturesDir, 'appointments.html'), 'utf8');
const appointmentDetailFixture = fs.readFileSync(path.join(fixturesDir, 'appointment-detail.html'), 'utf8');
const testResultsFixture = fs.readFileSync(path.join(fixturesDir, 'testResults.html'), 'utf8');
const vaccinationsFixture = fs.readFileSync(path.join(fixturesDir, 'vaccinations.html'), 'utf8');
const form17ListFixture = fs.readFileSync(path.join(fixturesDir, 'form17/list.html'), 'utf8');
const form17ExpandedFixture = fs.readFileSync(path.join(fixturesDir, 'form17/expanded.html'), 'utf8');

const NOW = new Date('2026-07-26T12:00:00Z');

describe.skipIf(!browserAvailable)('maccabi DOM extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(fixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('reads every prescription-row card off the page', async () => {
    const rows = await scrapePrescriptionRows(page);
    // The fixture has a standing row, a one-off row, and a row missing its name.
    expect(rows.length).toBe(4);
  });

  it('parses the fixture end to end into medications', async () => {
    const rows = await scrapePrescriptionRows(page);
    const medications = rows
      .map((row) => prescriptionRowToMedication(row, NOW))
      .filter((medication) => medication !== null);

    // Two standing rows have both a badge and a name; the one-off and the nameless
    // row must not survive.
    expect(medications).toHaveLength(2);
    expect(medications.map((medication) => medication!.name)).toContain('SAMPLEXIN 250MG CAP');
  });

  it('derives expiry across the fixture rows', async () => {
    const rows = await scrapePrescriptionRows(page);
    const byName = new Map(
      rows
        .map((row) => prescriptionRowToMedication(row, NOW))
        .filter((medication) => medication !== null)
        .map((medication) => [medication!.name, medication!]),
    );

    expect(byName.get('FICTAMOL 500MG TAB (20)')?.status).toBe('expiring_soon');
    expect(byName.get('SAMPLEXIN 250MG CAP')?.status).toBe('active');
    expect(byName.get('SAMPLEXIN 250MG CAP')?.validUntil).toBe('2027-01-03');
  });

  it('excludes the one-off prescription with no standing badge', async () => {
    const rows = await scrapePrescriptionRows(page);
    const medications = rows
      .map((row) => prescriptionRowToMedication(row, NOW))
      .filter((medication) => medication !== null);

    expect(medications.some((medication) => medication!.name.includes('TESTOPRIL'))).toBe(false);
  });
});

describe.skipIf(!browserAvailable)('maccabi appointment extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(appointmentsFixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('reads every appointment-row card off the page', async () => {
    const rows = await scrapeAppointmentRows(page);
    expect(rows.length).toBe(3);
  });

  it('parses the fixture end to end into appointments, dropping the incomplete row', async () => {
    const rows = await scrapeAppointmentRows(page);
    const appointments = rows.map((row) => appointmentRowToAppointment(row)).filter((a) => a !== null);

    expect(appointments).toHaveLength(2);
    expect(appointments.map((a) => a!.doctorName)).toContain('דר לוי אבי');
  });
});

describe.skipIf(!browserAvailable)('maccabi appointment detail extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(appointmentDetailFixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('matches the address by its title, not the first shared-class value (phone)', async () => {
    const detail = await scrapeAppointmentDetail(page);
    expect(detail.clinic).toBe('רחוב הדוגמה 1, עיר בדיונית');
  });

  it('reads every pre-visit instruction line', async () => {
    const detail = await scrapeAppointmentDetail(page);
    expect(detail.instructions).toEqual([
      'הביקור כרוך בהשתתפות עצמית, הנגבית באמצעות הוראת קבע.',
      'בהיעדר הוראת קבע, הבא את הסכום המדויק במזומן.',
    ]);
  });
});

describe.skipIf(!browserAvailable)('maccabi test-result extraction', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const launched = await launchTestBrowser();
    if (!launched) throw new Error('A browser binary was found but would not launch.');

    browser = launched;
    page = await browser.newPage();
    await page.setContent(testResultsFixture);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('reads vaccination fixture rows with optional fields and normalized text', async () => {
    await page.setContent(vaccinationsFixture);
    const rows = await scrapeVaccinationRows(page);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({
      vaccineName: 'חיסון דוגמה',
      administeredOn: '14/03/2025',
      dose: 'מנה 1',
      location: 'מרפאת דוגמה',
      ageAtAdministration: null,
    });
    expect(rows[1]?.dose).toBeNull();
    expect(rows[2]?.vaccineName).toBeNull();
    expect(rows[3]?.administeredOn).toBe('not-a-date');
    expect(rows.map(vaccinationRowToVaccination).filter(Boolean)).toHaveLength(5);
  });

  it('does not cross selector boundaries into unrelated markup', async () => {
    await page.setContent(`${vaccinationsFixture}<div data-hook="VaccineName">outside</div>`);
    const rows = await scrapeVaccinationRows(page);
    expect(rows).toHaveLength(7);
    expect(rows[0]?.vaccineName).toBe('חיסון דוגמה');
  });

  it('reads the vaccine timeline value rather than the member display name', async () => {
    await page.setContent(vaccinationsFixture);
    const rows = await scrapeVaccinationRows(page);
    const liveShapeRows = rows.slice(-3);

    expect(liveShapeRows).toEqual([
      expect.objectContaining({
        vaccineName: 'Fictional Vaccine',
        administeredOn: '09/09/2021',
        ageAtAdministration: '21.4',
      }),
      expect.objectContaining({
        vaccineName: 'Fictional Vaccine',
        administeredOn: '10/08/2020',
        ageAtAdministration: '20.3',
      }),
      expect.objectContaining({
        vaccineName: 'Fictional Vaccine',
        administeredOn: '11/07/2019',
        ageAtAdministration: '19',
      }),
    ]);
    expect(liveShapeRows.every((row) => row.vaccineName !== 'Fictional Member')).toBe(true);
  });

  it('opens every collapsed vaccination timeline row before extraction', async () => {
    await page.setContent(`
      <div data-testid="vaccination-row">
        <button role="button" aria-expanded="false" onclick="this.setAttribute('aria-expanded', 'true'); this.nextElementSibling.classList.add('show')">
          <span style="display:block;width:10px;height:10px" class="src-components-VaccinationsList-TimelineRow-TimelineRow__timlinearrow___one"></span>
        </button>
        <div class="collapse"><div class="src-components-VaccinationsList-ExpandedItem-ExpandedItem__wrapExpandedItem___one"></div></div>
      </div>
      <div data-testid="vaccination-row">
        <button role="button" aria-expanded="false" onclick="this.setAttribute('aria-expanded', 'true'); this.nextElementSibling.classList.add('show')">
          <span style="display:block;width:10px;height:10px" class="src-components-VaccinationsList-TimelineRow-TimelineRow__timlinearrow___two"></span>
        </button>
        <div class="collapse"><div class="src-components-VaccinationsList-ExpandedItem-ExpandedItem__wrapExpandedItem___two"></div></div>
      </div>
    `);

    await expandVaccinationDetails(page);

    expect(await page.locator('[role="button"][aria-expanded="true"]').count()).toBe(2);
  });

  it('waits for asynchronously rendered administrations, not only aria-expanded', async () => {
    await page.setContent(`
      <div data-testid="vaccination-row" id="delayed-vaccination">
        <span data-hook="VaccineName">Fictional Delayed Vaccine</span>
        <span data-hook="VaccinationDate">09/09/2021</span>
        <button
          role="button"
          aria-expanded="false"
          onclick="
            this.setAttribute('aria-expanded', 'true');
            setTimeout(() => {
              document.querySelector('#delayed-vaccination').insertAdjacentHTML('beforeend', \`
                <div class='collapse show'>
                  <div class='d-md-block d-none'>
                    <div class='src-components-VaccinationsList-ExpandedItem-ExpandedItem__wrapExpandedItem___one'>
                      <div class='src-components-VaccinationsList-ExpandedItem-ExpandedItem__vaccineDetailBlue___one'>30.2</div>
                    </div>
                    <div class='src-components-VaccinationsList-ExpandedItem-ExpandedItem__wrapExpandedItem___two'>
                      <span>08/08/2020</span>
                      <div class='src-components-VaccinationsList-ExpandedItem-ExpandedItem__vaccineDetailBlue___two'>29.1</div>
                    </div>
                  </div>
                </div>
              \`);
            }, 500);
          "
        >
          <span style="display:block;width:10px;height:10px" class="src-components-VaccinationsList-TimelineRow-TimelineRow__timlinearrow___delayed"></span>
        </button>
      </div>
    `);

    await expandVaccinationDetails(page);
    const rows = await scrapeVaccinationRows(page);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.administeredOn)).toEqual(['09/09/2021', '08/08/2020']);
  });

  it('reads every timeline entry off the page', async () => {
    await page.setContent(testResultsFixture);
    const rows = await scrapeTestResultRows(page);
    expect(rows).toHaveLength(3);
  });

  it('extracts the laboratory category, execution date, and referring doctor', async () => {
    const rows = await scrapeTestResultRows(page);
    expect(rows[0]).toEqual({
      testName: 'מעבדה',
      date: 'תאריך הבדיקה: 20/12/24',
      timelineDate: '21/12/24',
      orderingDoctor: 'דר דוגמה רונית',
    });
  });

  it('combines a category and subtype into the timeline result name', async () => {
    const rows = await scrapeTestResultRows(page);
    expect(rows[1]?.testName).toBe('קרדיולוגיה | תוצאת בדיקה לדוגמה');
  });

  it('prefers the execution date and falls back to the timeline date', async () => {
    const rows = await scrapeTestResultRows(page);
    const testResults = rows.map((row) => testResultRowToTestResult(row));

    expect(testResults[0]?.performedOn).toBe('2024-12-20');
    expect(testResults[2]?.performedOn).toBe('2024-06-08');
  });

  it('loads every lazy timeline batch before extraction', async () => {
    await page.setContent(`
      <div data-hook="LazyLoading">
        <div role="listitem" data-hook="TimeLineItem">first</div>
        <div id="sentinel"></div>
      </div>
      <script>
        let batch = 1;
        let loading = false;
        window.scrollTo = () => {
          if (loading || batch > 2) return;
          loading = true;
          setTimeout(() => {
            const row = document.createElement('div');
            row.role = 'listitem';
            row.dataset.hook = 'TimeLineItem';
            row.textContent = String(++batch);
            document.querySelector('[data-hook="LazyLoading"]').insertBefore(
              row,
              document.querySelector('#sentinel'),
            );
            setTimeout(() => { loading = false; }, 20);
          }, 20);
        };
      </script>
    `);

    await loadAllTestResultRows(page, 30, 1_000);

    expect(await page.locator('[role="listitem"][data-hook="TimeLineItem"]').count()).toBe(3);
  });

  it('ignores a matching component wrapper around a real timeline list item', async () => {
    await page.setContent(`
      <div role="list" data-hook="LazyLoading">
        <div data-hook="TimeLineItem">
          <div role="listitem" data-hook="TimeLineItem">
            <div data-hook="TimeLineDate">21/12/24</div>
            <div data-hook="HeaderTimeLineItem">קטגוריה לדוגמה</div>
            <ul role="presentation">
              <li data-hook="TestExecuteDate"><span>תאריך הבדיקה: 20/12/24</span></li>
              <li><span>רופא מפנה: דר דוגמה רונית</span></li>
            </ul>
          </div>
        </div>
      </div>
    `);

    await expect(scrapeTestResultRows(page)).resolves.toHaveLength(1);
  });
});

describe.skipIf(!browserAvailable)('maccabi Form 17 extraction', () => {
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

  it('reads list fields without collecting the member name or unrelated page text', async () => {
    await page.setContent(`${form17ListFixture}<div data-hook="TimeLineDate">31/12/99</div>`);
    const rows = await scrapeForm17Rows(page);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.id).toBe('request-example-1');
    expect(rows[0]?.requestType).toBe('בקשת התחייבות לדוגמה');
    expect(rows[0]?.status).toBe('אושרה');
    expect(rows[0]?.statusUpdatedOn).toBe('15/03/25');
    expect(rows[0]?.providerName).toBe('מרכז רפואי בדיוני');
    expect(rows[0]?.appointmentOn).toBeNull();
    expect(rows[0]?.documentLabels).toEqual([]);
    expect(rows[0]?.canChangeAppointment).toBe(false);
    expect(rows[0]?.requiresAdditionalInfo).toBe(false);
    expect(rows[0]?.submittedOn).toContain('14/03/25');
    expect(rows[1]).toMatchObject({
      providerName: null,
      appointmentOn: null,
      documentLabels: [],
      requiresAdditionalInfo: true,
    });
    expect(rows.map(form17RowToRequest).filter(Boolean)).toHaveLength(2);
  });

  it('reads document and appointment details from an expanded reconstruction', async () => {
    await page.setContent(form17ExpandedFixture);
    const [row] = await scrapeForm17Rows(page);
    expect(row).toMatchObject({
      appointmentOn: '20/03/25',
      documentLabels: ['התחייבות', 'סיכום בקשה'],
      canChangeAppointment: true,
    });
  });

  it('opens each collapsed row before extraction', async () => {
    await page.setContent(form17ListFixture.replaceAll(
      'role="button" aria-expanded="false"',
      'role="button" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\', \'true\')"',
    ));

    await expandForm17Details(page);

    expect(await page.locator('[role="listitem"] [aria-expanded="true"]').count()).toBe(3);
  });

  it('waits for asynchronously rendered detail regions', async () => {
    await page.setContent(`
      <div data-hook="LazyLoading" role="list">
        <div role="listitem" id="delayed-form17">
          <button aria-expanded="false">expand</button>
        </div>
      </div>
    `);
    const expansion = expandForm17Details(page);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.evaluate(`(function () {
      var button = document.querySelector('#delayed-form17 button');
      button.setAttribute('aria-expanded', 'true');
      var detail = document.createElement('div');
      detail.setAttribute('role', 'region');
      detail.className = 'ExpandedItem__wrapExpandedItem';
      document.querySelector('#delayed-form17').append(detail);
    })()`);

    await expansion;

    expect(await page.locator('#delayed-form17 [role="region"]').count()).toBe(1);
  });

  it('loads every lazy Form 17 timeline batch before extraction', async () => {
    await page.setContent(`
      <div data-hook="LazyLoading" role="list"><div role="listitem">first</div></div>
      <script>
        let batch = 1;
        let loading = false;
        window.scrollTo = () => {
          if (loading || batch > 2) return;
          loading = true;
          setTimeout(() => {
            const row = document.createElement('div');
            row.setAttribute('role', 'listitem');
            row.textContent = String(++batch);
            document.querySelector('[data-hook="LazyLoading"]').appendChild(row);
            setTimeout(() => { loading = false; }, 20);
          }, 20);
        };
      </script>
    `);

    await loadAllForm17Rows(page, 100, 2_000);

    expect(await page.locator('[data-hook="LazyLoading"] > [role="listitem"]').count()).toBe(3);
  });
});
