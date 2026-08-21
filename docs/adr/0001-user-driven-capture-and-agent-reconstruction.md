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
