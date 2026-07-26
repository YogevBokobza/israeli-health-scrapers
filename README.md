# israeli-health-scrapers

Typed, permission-scoped access to Israeli health fund (kupat holim) personal accounts —
as a library, and as an MCP server for AI agents.

Modelled directly on [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers):
one `createScraper` factory, one uniform result shape, one folder per fund.

**Status:** early. Maccabi is implemented for standing prescriptions (read-only). The
other funds are declared but not yet built. See [Calibration](#calibration) before the
first real run.

## Why

An AI agent asked to check when a prescription expires will otherwise be handed a
browser and left to navigate a medical account on its own. This gives it a small, named
set of operations instead — each one declaring whether it reads or writes, each one
refusable — so what the agent can do is a decision you make once, in a config file,
rather than something you discover afterwards from a log.

## Install

```bash
npm install
npx playwright install chromium   # skip if your image already ships one
cp .env.example .env              # fill in your ID
cp health.policy.example.json health.policy.json
```

Generate a session key so a login can be reused instead of triggering a fresh SMS each
run:

```bash
openssl rand -base64 32   # put it in IHS_SESSION_KEY
```

## Use as a library

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
every fund answers "is this about to run out" identically and no caller parses a Hebrew
date.

### Fund metadata

```ts
import { SCRAPERS } from 'israeli-health-scrapers';
// { maccabi: { name: 'מכבי שירותי בריאות', loginFields: ['id','password'], loginMethods: ['otp','password'] }, ... }
```

## Use as an MCP server

```bash
npm run login -- maccabi     # once, interactively — stores the session
npm run mcp                  # stdio MCP server
```

Client config:

```json
{
  "mcpServers": {
    "israeli-health": {
      "command": "node",
      "args": ["/path/to/israeli-health-scrapers/dist/mcp/server.js"],
      "env": {
        "IHS_MACCABI_ID": "000000000",
        "IHS_SESSION_KEY": "...",
        "IHS_MODE": "readonly",
        "IHS_PROFILE": "readonly"
      }
    }
  }
}
```

The agent never sees a credential: you log in once with the CLI, and it works off the
stored session.

### Tools

| Tool | Capability | Scope |
| --- | --- | --- |
| `auth_start` | — | always available |
| `auth_complete` | — | always available |
| `medications_list` | read | `maccabi:medications:read` |

`auth_start` / `auth_complete` are always listed regardless of policy: logging in is the
precondition for everything else, and an agent that cannot see how to re-authenticate
has no way to recover from an expired session except by failing repeatedly.

With more than one fund enabled, tool names gain a prefix (`maccabi_medications_list`).
The input schema is unchanged, so a prompt written against one fund keeps working.

## Permissions

Scopes are `fund:resource:capability`, e.g. `maccabi:medications:read`. Wildcards apply
to whole segments only (`*:*:write`), never partial ones.

`health.policy.json`:

```jsonc
{
  "defaultProfile": "readonly",
  "profiles": {
    "readonly": { "scopes": ["*:*:read"] },
    "assistant": {
      "scopes": ["maccabi:medications:read", "maccabi:messages:write"],
      "requireConfirmation": ["*:*:write"],
      "rateLimits": { "*:*:write": { "perHour": 5 } }
    }
  }
}
```

Enforcement happens at two points:

1. **Discovery** — an agent is never shown a tool it may not call, so it cannot report a
   capability you did not grant.
2. **Execution** — re-checked on every call. The tool list an agent holds is not
   evidence of anything.

Both matter. Filtering alone is presentation that a hand-written call walks straight
past; checking alone leaks the shape of everything that exists.

**Write confirmation.** A write matching `requireConfirmation` does not execute on the
first call. It returns a human-readable preview and a one-shot token; only a second call
carrying that token runs. The token is bound to the exact operation *and* input it was
issued for — otherwise you could approve a preview of one message and have the token
redeemed against another.

**Kill switch.** `IHS_MODE=readonly` blocks every write regardless of the policy file.
It is the default in Docker, and no policy edit can escalate past it.

**Audit.** Every attempt, including refusals, is appended to `data/audit.jsonl` with a
hash of the input — no names, no message bodies, no medical content.

## CLI

```bash
npm run login  -- maccabi                                  # interactive login
npm run action -- maccabi medications.list                 # run one operation
npm run action -- maccabi medications.list '{"expiringWithinDays":30}'
```

The CLI goes through the same permission engine as the MCP server, so a policy that
refuses an agent refuses you identically — and you can test a policy without an agent.

## Docker

```bash
docker compose run --rm login   # one-time login, writes ./data
docker compose run --rm mcp     # stdio MCP server
```

`./data` holds the session, the audit log and diagnostics dumps. It is the only thing
worth persisting, and it must not be committed.

A container has no display, so a fund that shows a CAPTCHA cannot be logged into from
one. Run `npm run login` on a desktop and copy `data/sessions/<fund>.json` across.

## Calibration

The Maccabi selectors were written against the site's expected structure but **have not
been verified against a live logged-in account** — that needs a real member login.
Treat your first run as a calibration pass.

On a parsing failure the scraper writes the page HTML and a screenshot to
`data/diagnostics/`, and every Maccabi URL and selector lives at the top of
`src/scrapers/maccabi.ts`. That is the only file to edit when the site changes.

The parser tests run off `test/fixtures/`, so improving a fixture with a real (redacted)
dump strengthens the tests without touching them.

## Adding a fund

1. `src/scrapers/<fund>.ts` extending `BaseScraperWithBrowser`.
2. Implement `getLoginOptions()` (URL, field selectors, and the `possibleResults` map
   from page conditions to `LoginResults`) and `fetchAccounts()`.
3. Map the fund's output onto the shared types in `src/definitions.ts`.
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
- It reports what the fund shows. It does not interpret anything medically, and neither
  should an agent built on it.
- Sessions, audit log and diagnostics stay on local disk. Diagnostics dumps contain
  page HTML from a logged-in medical account — treat that directory accordingly.

## Roadmap

Appointments (list, search slots, book), messages to a doctor, commitment forms
(טופס 17), background monitoring for expiring prescriptions, and the remaining funds.

Longer term: Israel's Medical Data Portability Law (2024) requires the funds to expose
certified FHIR R4 APIs on a programme running to 2029. When one lands, it joins as
another scraper behind the same interface — same operations, same schemas, same
permission model, no change for callers. That is the main reason the fund abstraction
exists this early.

## License

MIT
