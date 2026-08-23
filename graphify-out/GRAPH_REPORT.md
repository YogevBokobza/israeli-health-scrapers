# Graph Report - israeli-health-scrapers  (2026-08-23)

## Corpus Check
- 58 files · ~35,040 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 507 nodes · 1141 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `14727b01`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.ts
- capture.ts
- package.json
- base-scraper-with-browser.ts
- Maccabi Valid Prescriptions Fixture
- compilerOptions
- Israeli Health Scrapers Project Instructions
- playwright
- compilerOptions
- AES-256-GCM Session Storage
- Codebase Intelligence for israeli-health-scrapers (Repowise)
- maccabi-dom.test.ts
- cli.ts
- maccabi.ts
- Issue tracker: GitHub
- Domain Docs
- Israeli Health Scrapers
- Calibration by user-driven capture + agent reconstruction
- triage-labels.md
- Changelog
- capture-button.ts

## God Nodes (most connected - your core abstractions)
1. `MaccabiScraper` - 23 edges
2. `playwright` - 18 edges
3. `captureDiagnostics()` - 18 edges
4. `BaseScraperWithBrowser` - 17 edges
5. `ScraperCredentials` - 16 edges
6. `compilerOptions` - 16 edges
7. `HealthFundId` - 15 edges
8. `ScraperLoginResult` - 14 edges
9. `elementExists()` - 14 edges
10. `waitUntil()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Maccabi Calibrated Scraper` --shares_data_with--> `Maccabi Valid Prescriptions Fixture`  [INFERRED]
  AGENTS.md → test/fixtures/maccabi/medications.html
- `CaptureRequest` --references--> `HealthFundId`  [EXTRACTED]
  tools/calibrate/capture.ts → src/definitions.ts
- `Maccabi Data Roadmap` --conceptually_related_to--> `Maccabi Future Appointments Fixture`  [INFERRED]
  README.md → test/fixtures/maccabi/appointments.html
- `captureSnapshot()` --calls--> `ensureDir()`  [EXTRACTED]
  tools/calibrate/capture.ts → src/helpers/paths.ts
- `TestableMaccabiScraper` --inherits--> `MaccabiScraper`  [EXTRACTED]
  test/scrapers/maccabi.test.ts → src/scrapers/maccabi.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Future Appointment Parsing Shape** — test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_appointments_timeline_appointment_row, test_fixtures_maccabi_appointments_required_start_filter, test_fixtures_maccabi_appointments_combined_specialty_visit_type, test_fixtures_maccabi_appointments_absent_list_location [EXTRACTED 1.00]
- **Standing Prescription Extraction Shape** — test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_medications_prescription_card_structure, test_fixtures_maccabi_medications_standing_medication_filter, test_fixtures_maccabi_medications_invalid_prescription_row_filter [EXTRACTED 1.00]

## Communities (22 total, 2 thin omitted)

### Community 0 - "index.ts"
Cohesion: 0.06
Nodes (52): Appointment, appointmentSchema, documentSchema, FETCH_TARGETS, FetchTarget, Form17Request, form17RequestSchema, HealthAccount (+44 more)

### Community 1 - "capture.ts"
Cohesion: 0.17
Nodes (23): capturesDir(), BindingResolution, CaptureRequest, captureSnapshot(), buildFlowView(), escapeHtml(), FlowStep, formatJson() (+15 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (40): dependencies, playwright, zod, description, devDependencies, tsx, @types/node, typescript (+32 more)

### Community 3 - "base-scraper-with-browser.ts"
Cohesion: 0.13
Nodes (16): clickFirst(), fillFirst(), typeFirst(), BaseScraperWithBrowser, conditionMatches(), LOGIN_RESULT_ERRORS, LoginCondition, LoginField (+8 more)

### Community 4 - "Maccabi Valid Prescriptions Fixture"
Cohesion: 0.11
Nodes (21): Chromium DOM Parsing Coverage, CI Workflow, Node.js 20 Runtime, Typecheck Test Build Quality Gates, Selector Diagnostics Capture, Sanitized Medical Test Fixtures, Maccabi Calibration Workflow, Maccabi Data Roadmap (+13 more)

### Community 5 - "compilerOptions"
Cohesion: 0.08
Nodes (24): node_modules, src/**/*.ts, test, compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames (+16 more)

### Community 6 - "Israeli Health Scrapers Project Instructions"
Cohesion: 0.10
Nodes (22): BaseScraper Lifecycle, Scraper Contract Suite, Declarative Login State Machine, Encrypted Session Persistence, health-mcp Consumer, israeli-bank-scrapers, Maccabi Calibrated Scraper, Israeli Health Scrapers Project Instructions (+14 more)

### Community 7 - "playwright"
Cohesion: 0.12
Nodes (23): playwright, maccabiAppointmentBindingDefinition, maccabiAppointmentDetailBindingDefinition, maccabiForm17BindingDefinition, maccabiLoginBindingDefinition, maccabiMedicationBindingDefinition, maccabiVaccinationBindingDefinition, chromiumExecutablePath() (+15 more)

### Community 8 - "compilerOptions"
Cohesion: 0.12
Nodes (16): **/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit (+8 more)

### Community 11 - "Codebase Intelligence for israeli-health-scrapers (Repowise)"
Cohesion: 0.18
Nodes (9): Architecture, Code health, Codebase Intelligence for israeli-health-scrapers (Repowise), Commands, Entry points, Files that need care (bug-fix history first, then churn — check `get_risk` before editing), How to work in this repo, Key modules (+1 more)

### Community 12 - "maccabi-dom.test.ts"
Cohesion: 0.12
Nodes (24): HealthDocument, TestResult, captureDiagnostics(), elementExists(), waitUntil(), expandForm17Details(), expandVaccinationDetails(), loadAllForm17Rows() (+16 more)

### Community 13 - "cli.ts"
Cohesion: 0.17
Nodes (19): VIEWPORT, HealthFundId, HealthFundTypes, dataRoot(), diagnosticsDir(), ensureDir(), sessionPath(), clearSession() (+11 more)

### Community 14 - "maccabi.ts"
Cohesion: 0.07
Nodes (49): deriveExpiry(), formatOffset(), isBlank(), jerusalemOffsetMinutes(), normalizeText(), parseInteger(), parseIsraeliDate(), parseIsraeliDateTime() (+41 more)

### Community 15 - "Issue tracker: GitHub"
Cohesion: 0.29
Nodes (6): Conventions, Issue tracker: GitHub, Pull requests as a triage surface, Wayfinding operations, When a skill says "fetch the relevant ticket", When a skill says "publish to the issue tracker"

### Community 16 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 17 - "Israeli Health Scrapers"
Cohesion: 0.40
Nodes (4): Calibration, Funds, Israeli Health Scrapers, Runtime artifacts

### Community 18 - "Calibration by user-driven capture + agent reconstruction"
Cohesion: 0.40
Nodes (4): Calibration by user-driven capture + agent reconstruction, Consequences, Considered options, Reconstruction procedure

### Community 20 - "Changelog"
Cohesion: 0.12
Nodes (15): [0.2.0] - 2026-08-22, [0.2.1] - 2026-08-23, [0.3.0] - 2026-08-23, [0.4.0] - 2026-08-23, Added, Added, Added, Added (+7 more)

### Community 21 - "capture-button.ts"
Cohesion: 0.23
Nodes (11): pageWithButton(), BootstrapArgs, CaptureButtonResult, captureButtonScript(), injectCaptureButton(), CAPTURE_STATES, CAPTURE_TARGETS, isKnownTarget() (+3 more)

## Knowledge Gaps
- **147 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+142 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `playwright` connect `playwright` to `index.ts`, `capture.ts`, `package.json`, `base-scraper-with-browser.ts`, `maccabi-dom.test.ts`, `cli.ts`, `maccabi.ts`, `capture-button.ts`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Why does `keywords` connect `package.json` to `playwright`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _147 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05586741512964448 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `base-scraper-with-browser.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1265597147950089 - nodes in this community are weakly interconnected._
- **Should `Maccabi Valid Prescriptions Fixture` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._