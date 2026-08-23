# Israeli-Health-Scrapers

## What this is

A pure TypeScript library — no server, no CLI, no storage beyond session cookies —
that scrapes Israeli health funds (kupot holim), modeled directly on
[israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers). One
`createScraper({ companyId, ... })` factory, one result shape, one file per fund.
Storage, permissions, agent protocols, and CLIs belong to whatever consumes it — that's
[health-mcp](https://github.com/YogevBokobza/health-mcp), a separate private repo, the
same way `moneyman`/`asher-mcp` sit on top of the bank scrapers.

Only Maccabi (`HealthFundTypes.maccabi`) is implemented (`IMPLEMENTED_FUNDS` in
`src/scrapers/factory.ts`). Clalit, Meuhedet, and Leumit are declared in `SCRAPERS`
metadata but `createScraper` throws "declared but not implemented yet" for them.

## Commands

```bash
npm run build       # tsc -p tsconfig.json → dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run — hermetic, no browser, no account
npm run test:watch
npx playwright install chromium   # needed once, for the DOM-level tests and any real run
```

Run a single test file or case with vitest directly, e.g.:

```bash
npx vitest run test/scrapers/maccabi.test.ts
npx vitest run -t "derives expiry"
```

## Architecture

**Scraper class hierarchy** (`src/scrapers/`):
`BaseScraper` (`base-scraper.ts`) owns the fund-agnostic lifecycle — `scrape()` is
initialize → login → fetchData → terminate, with progress events and every thrown
error converted into a `{ success: false, errorType, errorMessage }` envelope rather
than propagating, so a caller looping over several funds never has one down fund abort
the rest. `BaseScraperWithBrowser` (`base-scraper-with-browser.ts`) extends it with a
Playwright-backed, **declarative** login state machine: a fund implements
`getLoginOptions()` (URL, field selectors, submit selectors, and a `possibleResults` map
from page conditions to `LoginResults`) and `fetchAccounts()`, and gets session reuse,
OTP handling, and diagnostics capture for free. Adding a fund is meant to be a selector
list in a new file, not new control flow — see the "Adding a fund" steps in
[README.md](README.md).

**Two login paths, same state machine.** `login()` is the one-shot path (blocks through
an SMS wait via `otpCodeRetriever`). `triggerTwoFactorAuth()` / `getLongTermTwoFactorToken()`
split the same flow across two calls that keep the same browser alive between them —
this exists because health-mcp's stdio-based tool calls can't block waiting for a member
to read a text message; the fund ties the OTP to the browser session that requested it.

**Everything Maccabi-specific lives in `src/scrapers/maccabi.ts`** — URLs, selectors,
and the medications parser. That file's header comment explains the current
calibration state; read it before touching selectors. Two load-bearing details learned
from calibrating against a live account (see git history / open PRs for the full list):
the login flow is a multi-screen SPA — ID → a verification picker (SMS / phone call /
"כניסה עם סיסמה" link) → OTP, *or*, only if that link is clicked, a separate id+password
screen — and the medications data lives at `ValidPrescriptions` as a
`[data-testid="prescription-row"]` card list, not a `<table>` — `Lobby` (the "all
medications" tab) is a dispense *history* where the same drug reappears per purchase
event, which is the wrong model for "standing prescriptions + expiry".

**Test results are read through an API, not the DOM.** Not for elegance: the rendered
timeline rows omit the `request_id`/`doc_id` that identify a result and the per-entry
`hash`/`time_stamp` that authorize downloading its document, all of which live only in
React state. A DOM-only scraper therefore reaches a lab result's values only by clicking
each row in turn and reaches a document not at all. Through `TestResultsAPI` the whole
timeline is one request, and each result's values or PDF is one more. Three things about
it that cost real debugging time and are easy to get wrong again:

- the API answers cookies alone with a 401. The SPA writes a short-lived JWT to
  `sessionStorage.token`, and the member id and sex to `sessionStorage.customerData`;
  `readMaccabiMember` reads both after navigating to the timeline. Sex is not cosmetic —
  reference ranges are sex-specific, so sending the wrong one returns the right numbers
  against the wrong normal range.
- the entry `hash` arrives **already percent-encoded**. Encoding it again yields a 400.
- an `imaging_study` entry has no `result_files` and no downloadable file: it is the
  films, shown only in the fund's own viewer. Its report is a *separate*
  `imaging_result` entry on the same day, and that one has the PDF. Asking the download
  endpoint for a study returns an HTML page with a 200, which is why the PDF magic
  number, not the status code, decides whether a document came back.

**Past visits follow the same API-first rule** (`AppointmentOrderAPI`, not their own):
the rendered lobby rows carry no id at all, while the list response's `appointment_id`
is the stable fund-native identity — the test-results identity bug (hash ids collapsing
distinct rows) is what this avoids from day one. The list spans roughly the last year
(the page's own widest filter; nothing older behind it) and carries no location — only
an opaque facility id with no name — so `PastVisit` has none. What the doctor wrote at
each visit is the later `visitSummaries` resource; `pastVisits` is list-only and never
clicks into summaries.

**Shared parsing lives in `src/helpers/dates.ts`**: `parseIsraeliDate` (day-first
formats, 2- or 4-digit years) and `deriveExpiry` (computes `daysUntilExpiry` and
`status` from a `validUntil` ISO date against `EXPIRING_SOON_DAYS`, in `constants.ts`).
Every fund is expected to funnel through `deriveExpiry` rather than compute its own
status, so "is this about to run out" answers identically across funds.
`src/helpers/ranges.ts` is the same idea for measurements: `deriveReferenceStatus`
places a value against its reference range, so "was this result abnormal" also means one
thing everywhere. A fund normalizes its own encoding of "no range given" to nulls before
calling it — Maccabi's is `min_lim`/`max_lim` both zero — rather than each fund deciding
for itself what counts as out of range.

**The contract suite** (`test/contract/scrapers.test.ts`) runs against `MockScraper`
(`src/scrapers/mock.ts`) — a fund that doesn't exist, implemented against the same
`BaseScraper` contract as Maccabi. If adding a real fund ever requires touching the
shared base classes instead of just adding a selector file, this suite is what would
break first.

**Diagnostics, not silent failure.** On a selector-drift or unresolved-login error, the
scraper writes page HTML + a screenshot to `data/diagnostics/` (`src/helpers/debug.ts`,
`captureDiagnostics`) before throwing. This is how live-account calibration issues get
fixed without guessing — always check for a diagnostics dump path in an error message
before changing a selector blind. `IHS_DIAGNOSTICS=off` disables this.

**Sessions** are per-fund, AES-256-GCM-encrypted with `IHS_SESSION_KEY`
(`src/helpers/session.ts`), stored under `IHS_DATA_DIR` (defaults to `./data`). Without
that key, nothing is persisted — an OTP fund will send a fresh SMS on every run rather
than silently storing cookies in the clear. A consumer wiring this up needs to set
`IHS_SESSION_KEY` itself; the library never invents or falls back to a default.

## Tests and fixtures

The test-results parsers need no browser and no HTML fixture: they map API payloads, so
`test/scrapers/maccabi.test.ts` exercises them against invented JSON of the same shape.
The same PII rule applies — the shapes are real, every value in them is not.
`fetchLabValues` gets its own suite against fake responses because its return value
decides what a consumer writes over stored data: null means "not read, keep what you
had", and a wrong answer there deletes a member's history.

DOM-level tests (`test/scrapers/maccabi-dom.test.ts`) run the real parsing functions
against saved HTML fixtures (`test/fixtures/maccabi/`) in an actual launched Chromium,
and skip *visibly* (`describe.skipIf`) rather than silently passing when no browser
binary is found — never make a skipped suite look green. Pure-parser tests
(`test/scrapers/maccabi.test.ts`) exercise the same logic without a browser at all.

**Never put real account data into a fixture or test** — no real drug names, doctor
names, ID numbers, or dates from an actual logged-in session, even when a fixture was
built by capturing the *shape* of a real session during calibration. This repo is
public. Always invent placeholder data with the same structural shape (same edge
cases: a two-digit year, a missing name, a row without the expected badge) instead, and
replace every real value before committing — not just before pushing.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub issues (`gh` CLI) in `YogevBokobza/israeli-health-scrapers`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
