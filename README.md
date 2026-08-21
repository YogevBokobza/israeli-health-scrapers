# israeli-health-scrapers

Scrapers for Israeli health funds (kupot holim). Read your own medical account data
through one uniform, typed API.

Built in the shape of [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers):
a `createScraper` factory per fund, one result shape, one folder per fund.

This is **a library**. It knows how to talk to a fund and nothing else — storage,
permissions, agent protocols and CLIs belong to whatever consumes it. The MCP server
for AI agents lives in [health-mcp](https://github.com/YogevBokobza/health-mcp), the
same way `moneyman` and `asher-mcp` sit on top of the bank scrapers.

**Status:** early. Maccabi is implemented for standing prescriptions. The other funds
are declared but not yet built. See [Calibration](#calibration) before the first real run.

## Install

```bash
npm install israeli-health-scrapers
npx playwright install chromium
```

## Use

```ts
import { createScraper, HealthFundTypes } from 'israeli-health-scrapers';

const scraper = createScraper({
  companyId: HealthFundTypes.maccabi,
  storeSession: true,
  // Called only if the fund actually asks for a code.
  otpCodeRetriever: async () => promptTheUserSomehow(),
});

const result = await scraper.scrape({ id: '000000000' });

if (!result.success) {
  console.error(result.errorType, result.errorMessage);
} else {
  for (const medication of result.accounts![0].medications) {
    console.log(medication.name, medication.validUntil, medication.daysUntilExpiry);
  }
}
```

A failed scrape is a returned value, not an exception — so a loop over several funds
does not abort because one is down.

### Result shape

```ts
{
  success: boolean,
  accounts?: [{
    provider: 'maccabi',
    medications: [{
      name: string,
      dosage: string | null,
      form: string | null,
      prescribedBy: string | null,
      lastDispensed: string | null,     // ISO date
      validUntil: string | null,        // ISO date
      refillsRemaining: number | null,
      daysUntilExpiry: number | null,   // negative once expired
      status: 'active' | 'expiring_soon' | 'expired' | 'unknown',
      provider: HealthFundId,
      raw?: Record<string, unknown>     // unmapped source columns
    }]
  }],
  errorType?: ScraperErrorTypes,
  errorMessage?: string
}
```

`daysUntilExpiry` and `status` are computed in shared code rather than per fund, so
every fund answers "is this about to run out" identically and no caller has to parse a
Hebrew date.

### Options

| Option | Meaning |
| --- | --- |
| `companyId` | Which fund. Required. |
| `showBrowser` | Run headed. Needed to solve a CAPTCHA or an unexpected consent screen. |
| `storeSession` | Persist and reuse the login (default on). Without it, an OTP account sends an SMS every run. |
| `otpCodeRetriever` | `() => Promise<string>`, called only when the fund asks for a code. |
| `fetch` | Which collections to read. Defaults to `['medications']`. |
| `onProgress` | Lifecycle events (`START_SCRAPING`, `LOGIN_SUCCESS`, …). |
| `browser` / `browserContext` | Reuse an existing Playwright instance. |
| `timeout`, `executablePath`, `args`, `verbose` | As you'd expect. |

### Two-step login

A caller that cannot block while someone reads an SMS — an agent protocol, an HTTP
handler — can split the login:

```ts
await scraper.triggerTwoFactorAuth(credentials);  // sends the SMS, keeps the browser open
await scraper.getLongTermTwoFactorToken(code);    // redeems it, stores the session
```

The browser must stay alive between the two: the fund ties the code to that session.

### Fund metadata

```ts
import { SCRAPERS } from 'israeli-health-scrapers';
// { maccabi: { name: 'מכבי שירותי בריאות', loginFields: ['id','password'], loginMethods: ['otp','password'] }, ... }
```

### Sessions

With `storeSession`, the Playwright storage state is written to
`data/sessions/<fund>.json`, encrypted with AES-256-GCM using `IHS_SESSION_KEY`, mode
`0600`. Without that key nothing is persisted — cookies to a medical account are not
written in the clear. Override the location with `IHS_DATA_DIR`.

```bash
openssl rand -base64 32   # IHS_SESSION_KEY
```

## Calibration

The Maccabi selectors were written against the site's expected structure but **have not
been verified against a live logged-in account** — that needs a real member login. Treat
your first run as a calibration pass.

On a parsing failure the scraper writes the page HTML and a screenshot to
`data/diagnostics/`, and every Maccabi URL and selector lives at the top of
`src/scrapers/maccabi.ts`. That is the only file to edit when the site changes.

Parser tests run off `test/fixtures/`, so replacing a fixture with a real redacted dump
strengthens them without touching test code.

`npm run calibrate -- <fund>` opens a headed browser scoped to a fund and captures
labelled snapshots (stripped HTML + screenshot + URL + a manifest entry) to gitignored
`data/captures/<fund>/`. It reuses a stored session when one exists; otherwise log in by
hand — the tool never depends on that fund's scraper code existing. See
`docs/adr/0001-user-driven-capture-and-agent-reconstruction.md` and `CONTEXT.md` for the
full calibration workflow this is the first piece of.

## Adding a fund

1. `src/scrapers/<fund>.ts` extending `BaseScraperWithBrowser`.
2. Implement `getLoginOptions()` — the login URL, field selectors, and a
   `possibleResults` map from page conditions to `LoginResults`. Adding a fund is a
   selector list, not new control flow.
3. Implement `fetchAccounts()`, mapping onto the shared types in `src/definitions.ts`.
4. Register it in `src/scrapers/factory.ts` and add it to `IMPLEMENTED_FUNDS`.
5. Add fixtures under `test/fixtures/<fund>/` and make `test/contract/` pass.

The contract suite runs against a mock fund exactly as it does against a real one — so
if adding a fund ever starts requiring changes to the shared layers, that suite breaks
first.

## Tests

```bash
npm test        # hermetic: no browser, no account
npm run typecheck
```

DOM tests run against saved fixtures in a real browser and skip *visibly* when no
browser binary is present. Point `IHS_CHROMIUM_PATH` at a Chromium build if Playwright's
pinned one is not installed.

## Scope and limits

- For **your own account**, with your own credentials. Not a multi-tenant service.
- Subject to your fund's terms of use.
- It reports what the fund shows. It does not interpret anything medically.
- Sessions and diagnostics stay on local disk. Diagnostics dumps contain page HTML from
  a logged-in medical account — treat that directory accordingly.

## Roadmap

Maccabi appointments are scaffolded but uncalibrated (need a live account pass, same as
medications originally did — see `src/scrapers/maccabi.ts`). Still open: messages,
commitment forms (טופס 17), and the remaining funds.

Longer term: Israel's Medical Data Portability Law (2024) requires the funds to expose
certified FHIR R4 APIs, on a programme running to 2029. When one lands it joins as
another scraper behind the same interface — same schemas, no change for callers. That is
the main reason the fund abstraction exists this early.

## License

MIT
