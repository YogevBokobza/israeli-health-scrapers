# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Shared parsing lives in `src/helpers/dates.ts`**: `parseIsraeliDate` (day-first
formats, 2- or 4-digit years) and `deriveExpiry` (computes `daysUntilExpiry` and
`status` from a `validUntil` ISO date against `EXPIRING_SOON_DAYS`, in `constants.ts`).
Every fund is expected to funnel through `deriveExpiry` rather than compute its own
status, so "is this about to run out" answers identically across funds.

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
