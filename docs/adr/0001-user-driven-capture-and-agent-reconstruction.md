# Calibration by user-driven capture + agent reconstruction

To calibrate a fund's pages we build one fund-agnostic capture tool
(`npm run calibrate -- <fund>`, a committed dev CLI) with two modes —
extraction and login — plus an agent-side reconstruction step, rather than an
automated scraper-generator or an actions/codegen recorder. A human drives a
**headed** browser: for a new fund they log in by hand (the tool never depends on
a fund's login code existing) and, in the same session, snapshot each login screen
*and* each data page, driving every reveal themselves (expanding, scrolling,
clicking into detail). Snapshots — `outerHTML` with input values stripped +
screenshot + URL, plus a manifest tying labels together — land only in gitignored
`data/captures/`. The agent then reads them and hand-authors the committed
artifacts: selectors, parsers, interaction functions, and **minimal reconstructed
fixtures** (placeholder data, seeded edge cases). One live run closes the loop; on
drift the scraper's existing diagnostics dump is the input to the next iteration,
so first-time calibration and re-calibration are one loop.

## Considered options

- **Scrub a real dump into a fixture** instead of reconstructing minimally —
  rejected: this repo is public, and one missed node leaks real medical data;
  scrubbed dumps are also unreadable and fragile. Raw stays in `data/`; the
  committed fixture is a deliberate reconstruction.
- **Actions/codegen recorder** for the whole flow — rejected for extraction (login
  is already declarative, and a static snapshot is what tests run against), and
  rejected even for login: multi-*screen* login flow is expressed well enough by an
  ordered set of screen snapshots, so a second fragile capture path isn't worth it.
- **Agent drives the browser and handles credentials/OTP** — rejected: credentials
  and 2FA are the member's; a public tool automating around them is a liability.

## Consequences

- Interaction code (e.g. expand-then-read) is runtime control flow the agent still
  authors; a static fixture can't be clicked. Capturing both the collapsed and
  expanded states lets the agent pin the trigger selector against real markup.
- Login-calibration captures only the happy path. `possibleResults` failure markers
  (blocked, invalid password) are authored speculatively and harden through the
  diagnostics loop.
- The capture tool is a dev dependency, not shipped in `dist/`.
- A **flow view** (`npm run calibrate:view -- <fund>`) renders a calibrated flow as
  an on-demand HTML report over a capture session's snapshots. It computes its
  per-step bindings and results by running the *actual* current fund selectors and
  parser against the captured DOM — not from metadata baked in at capture time — so
  it is a genuine verification of the calibration and doubles as a drift check when
  a selector resolves to nothing. Because it needs the reconstructed code to run, it
  is a re-runnable post-reconstruction step, separate from capture.
- The **target** (`login` or a `FetchTarget`) is chosen per snapshot via the capture
  button's picker, not as a per-run flag — one session spans several targets. The
  picker offers the known set plus a free-text escape for a **provisional target**
  the union does not model yet (lowerCamel slug, e.g. `form17`); the manifest flags
  it unmodeled and reconstruction promotes it into the `FetchTarget` union, a result
  type, a fetch method, and a fixture dir. The tool is therefore both fund- and
  target-agnostic; the closed union is the single place targets are enumerated. A
  provisional target's flow view renders its screens with bindings marked pending
  until its code exists.

## Reconstruction procedure

1. Run `npm run calibrate -- <fund>`. The member logs in and drives the page; capture
   the list and every state that reveals data or changes the DOM. Keep the generated
   HTML, screenshot, URL, and manifest only under gitignored `data/captures/<fund>/`.
2. Inspect structure, not member values. Record stable `data-hook`, ARIA, and semantic
   selectors; avoid generated CSS hashes and broad text selectors. Define the result
   fields before writing extraction code, and exclude member display names unless the
   public model explicitly requires them.
3. Hand-author the smallest useful fixture under `test/fixtures/<fund>/<target>/`.
   Recreate only relevant hierarchy and attributes, use invented values, and seed edge
   cases such as optional fields, malformed dates, and layout-only rows. Never sanitize
   a raw capture into a committed fixture.
4. Add pure mapping tests, real-browser DOM tests, and interaction tests for actions
   such as expanding rows. Register a `TargetBindingDefinition` that runs the same
   parser and selectors used at runtime.
5. For a provisional target, add its slug to `FETCH_TARGETS`, add and export its Zod
   schema and result type, add the optional collection to `HealthAccount`, implement
   the fund's `fetch<Target>()`, call it from `fetchAccounts()`, add its fixture
   directory, and register its binding in `tools/calibrate/fund-bindings.ts`.
6. Run focused tests and `npm run calibrate:view -- <fund> <target>`. Every intended
   binding must have matches and the result must contain only expected fields. The
   manifest entry may remain historical evidence that the capture was provisional;
   current code, not that flag, changes the flow from pending to bound.
7. Run one live scrape. If rows are unexpectedly empty or a login marker reappears,
   use the path emitted by `captureDiagnostics`, compare that private dump with the
   fixture, update selectors/parser/fixture, and repeat the DOM, flow-view, and live
   checks. This diagnostics loop is also the recalibration procedure after DOM drift.
