# Graph Report - israeli-health-scrapers  (2026-08-20)

## Corpus Check
- 28 files · ~16,821 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 296 nodes · 664 edges · 14 communities (13 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `121c4ddb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.ts
- maccabi.test.ts
- package.json
- base-scraper-with-browser.ts
- Maccabi Valid Prescriptions Fixture
- compilerOptions
- Israeli Health Scrapers Project Instructions
- session.ts
- errors.ts
- AES-256-GCM Session Storage
- Codebase Intelligence for israeli-health-scrapers (Repowise)
- maccabi.ts
- playwright

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `ScraperCredentials` - 15 edges
3. `BaseScraperWithBrowser` - 15 edges
4. `captureDiagnostics()` - 14 edges
5. `MaccabiScraper` - 13 edges
6. `waitUntil()` - 12 edges
7. `BaseScraper` - 12 edges
8. `ScraperLoginResult` - 11 edges
9. `elementExists()` - 11 edges
10. `Scraper` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Maccabi Calibrated Scraper` --shares_data_with--> `Maccabi Valid Prescriptions Fixture`  [INFERRED]
  AGENTS.md → test/fixtures/maccabi/medications.html
- `Selector Diagnostics Capture` --rationale_for--> `Maccabi Calibration Workflow`  [INFERRED]
  AGENTS.md → README.md
- `Maccabi Data Roadmap` --conceptually_related_to--> `Maccabi Future Appointments Fixture`  [INFERRED]
  README.md → test/fixtures/maccabi/appointments.html
- `TestableMaccabiScraper` --inherits--> `MaccabiScraper`  [EXTRACTED]
  test/scrapers/maccabi.test.ts → src/scrapers/maccabi.ts
- `Chromium DOM Parsing Coverage` --conceptually_related_to--> `Maccabi Appointment Detail Fixture`  [INFERRED]
  .github/workflows/ci.yml → test/fixtures/maccabi/appointment-detail.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Maccabi DOM Fixture Coverage** — test_fixtures_maccabi_appointment_detail_appointment_detail_fixture, test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_testresults_test_results_timeline_fixture [INFERRED 0.95]
- **Future Appointment Parsing Shape** — test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_appointments_timeline_appointment_row, test_fixtures_maccabi_appointments_required_start_filter, test_fixtures_maccabi_appointments_combined_specialty_visit_type, test_fixtures_maccabi_appointments_absent_list_location [EXTRACTED 1.00]
- **Standing Prescription Extraction Shape** — test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_medications_prescription_card_structure, test_fixtures_maccabi_medications_standing_medication_filter, test_fixtures_maccabi_medications_invalid_prescription_row_filter [EXTRACTED 1.00]

## Communities (14 total, 1 thin omitted)

### Community 0 - "index.ts"
Cohesion: 0.10
Nodes (30): appointmentSchema, FetchTarget, HealthAccount, healthAccountSchema, HealthFundTypes, isoDateSchema, LoginMethod, medicationSchema (+22 more)

### Community 1 - "maccabi.test.ts"
Cohesion: 0.15
Nodes (21): deriveExpiry(), formatOffset(), isBlank(), jerusalemOffsetMinutes(), normalizeText(), parseInteger(), parseIsraeliDate(), parseIsraeliDateTime() (+13 more)

### Community 2 - "package.json"
Cohesion: 0.06
Nodes (30): dependencies, playwright, zod, description, devDependencies, @types/node, typescript, vitest (+22 more)

### Community 3 - "base-scraper-with-browser.ts"
Cohesion: 0.13
Nodes (17): VIEWPORT, clickFirst(), fillFirst(), typeFirst(), isExpired(), BaseScraperWithBrowser, conditionMatches(), LOGIN_RESULT_ERRORS (+9 more)

### Community 4 - "Maccabi Valid Prescriptions Fixture"
Cohesion: 0.10
Nodes (26): Chromium DOM Parsing Coverage, CI Workflow, Node.js 20 Runtime, Typecheck Test Build Quality Gates, Selector Diagnostics Capture, Sanitized Medical Test Fixtures, Maccabi Calibration Workflow, Maccabi Data Roadmap (+18 more)

### Community 5 - "compilerOptions"
Cohesion: 0.08
Nodes (24): DOM, ES2022, node_modules, src/**/*.ts, test, compilerOptions, declaration, declarationMap (+16 more)

### Community 6 - "Israeli Health Scrapers Project Instructions"
Cohesion: 0.10
Nodes (22): BaseScraper Lifecycle, Scraper Contract Suite, Declarative Login State Machine, Encrypted Session Persistence, health-mcp Consumer, israeli-bank-scrapers, Maccabi Calibrated Scraper, Israeli Health Scrapers Project Instructions (+14 more)

### Community 7 - "session.ts"
Cohesion: 0.35
Nodes (10): HealthFundId, dataRoot(), diagnosticsDir(), ensureDir(), sessionPath(), clearSession(), loadSession(), saveSession() (+2 more)

### Community 8 - "errors.ts"
Cohesion: 0.29
Nodes (5): ScraperErrorTypes, ScraperError, SelectorDriftError, TimeoutError, TwoFactorRetrieverMissingError

### Community 11 - "Codebase Intelligence for israeli-health-scrapers (Repowise)"
Cohesion: 0.18
Nodes (9): Architecture, Code health, Codebase Intelligence for israeli-health-scrapers (Repowise), Commands, Entry points, Files that need care (bug-fix history first, then churn — check `get_risk` before editing), How to work in this repo, Key modules (+1 more)

### Community 12 - "maccabi.ts"
Cohesion: 0.14
Nodes (26): Appointment, Medication, TestResult, Vaccination, captureDiagnostics(), elementExists(), waitUntil(), expandVaccinationDetails() (+18 more)

### Community 13 - "playwright"
Cohesion: 0.22
Nodes (9): keywords, health, israel, kupat-holim, maccabi, playwright, scraper, chromiumExecutablePath() (+1 more)

## Knowledge Gaps
- **88 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+83 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `playwright` connect `playwright` to `index.ts`, `maccabi.test.ts`, `base-scraper-with-browser.ts`, `session.ts`, `maccabi.ts`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `keywords` connect `playwright` to `package.json`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _88 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10180995475113122 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `base-scraper-with-browser.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1268939393939394 - nodes in this community are weakly interconnected._
- **Should `Maccabi Valid Prescriptions Fixture` be split into smaller, more focused modules?**
  _Cohesion score 0.09538461538461539 - nodes in this community are weakly interconnected._