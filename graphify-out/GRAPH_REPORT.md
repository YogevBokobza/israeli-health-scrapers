# Graph Report - israeli-health-scrapers  (2026-08-22)

## Corpus Check
- 52 files · ~27,216 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 438 nodes · 975 edges · 19 communities (17 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `be06098a`
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
- flow-view.ts
- compilerOptions
- AES-256-GCM Session Storage
- Codebase Intelligence for israeli-health-scrapers (Repowise)
- maccabi.ts
- cli.ts
- Issue tracker: GitHub
- Domain Docs
- Israeli Health Scrapers
- Calibration by user-driven capture + agent reconstruction
- triage-labels.md

## God Nodes (most connected - your core abstractions)
1. `playwright` - 17 edges
2. `compilerOptions` - 16 edges
3. `HealthFundId` - 15 edges
4. `ScraperCredentials` - 15 edges
5. `captureDiagnostics()` - 15 edges
6. `BaseScraperWithBrowser` - 15 edges
7. `MaccabiScraper` - 14 edges
8. `elementExists()` - 13 edges
9. `waitUntil()` - 13 edges
10. `BaseScraper` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Maccabi Calibrated Scraper` --shares_data_with--> `Maccabi Valid Prescriptions Fixture`  [INFERRED]
  AGENTS.md → test/fixtures/maccabi/medications.html
- `Selector Diagnostics Capture` --rationale_for--> `Maccabi Calibration Workflow`  [INFERRED]
  AGENTS.md → README.md
- `Maccabi Data Roadmap` --conceptually_related_to--> `Maccabi Future Appointments Fixture`  [INFERRED]
  README.md → test/fixtures/maccabi/appointments.html
- `CaptureRequest` --references--> `HealthFundId`  [EXTRACTED]
  tools/calibrate/capture.ts → src/definitions.ts
- `captureSnapshot()` --calls--> `capturesDir()`  [EXTRACTED]
  tools/calibrate/capture.ts → src/helpers/paths.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Maccabi DOM Fixture Coverage** — test_fixtures_maccabi_appointment_detail_appointment_detail_fixture, test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_testresults_test_results_timeline_fixture [INFERRED 0.95]
- **Future Appointment Parsing Shape** — test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_appointments_timeline_appointment_row, test_fixtures_maccabi_appointments_required_start_filter, test_fixtures_maccabi_appointments_combined_specialty_visit_type, test_fixtures_maccabi_appointments_absent_list_location [EXTRACTED 1.00]
- **Standing Prescription Extraction Shape** — test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_medications_prescription_card_structure, test_fixtures_maccabi_medications_standing_medication_filter, test_fixtures_maccabi_medications_invalid_prescription_row_filter [EXTRACTED 1.00]

## Communities (19 total, 2 thin omitted)

### Community 0 - "index.ts"
Cohesion: 0.07
Nodes (44): appointmentSchema, FetchTarget, form17RequestSchema, HealthAccount, healthAccountSchema, HealthFundTypes, isoDateSchema, LoginMethod (+36 more)

### Community 1 - "capture.ts"
Cohesion: 0.11
Nodes (29): playwright, FETCH_TARGETS, chromiumExecutablePath(), launchTestBrowser(), pageWithButton(), BootstrapArgs, CaptureButtonResult, captureButtonScript() (+21 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (40): dependencies, playwright, zod, description, devDependencies, tsx, @types/node, typescript (+32 more)

### Community 3 - "base-scraper-with-browser.ts"
Cohesion: 0.14
Nodes (18): clickFirst(), elementExists(), fillFirst(), typeFirst(), waitUntil(), BaseScraperWithBrowser, conditionMatches(), LOGIN_RESULT_ERRORS (+10 more)

### Community 4 - "Maccabi Valid Prescriptions Fixture"
Cohesion: 0.10
Nodes (26): Chromium DOM Parsing Coverage, CI Workflow, Node.js 20 Runtime, Typecheck Test Build Quality Gates, Selector Diagnostics Capture, Sanitized Medical Test Fixtures, Maccabi Calibration Workflow, Maccabi Data Roadmap (+18 more)

### Community 5 - "compilerOptions"
Cohesion: 0.08
Nodes (24): node_modules, src/**/*.ts, test, compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames (+16 more)

### Community 6 - "Israeli Health Scrapers Project Instructions"
Cohesion: 0.10
Nodes (22): BaseScraper Lifecycle, Scraper Contract Suite, Declarative Login State Machine, Encrypted Session Persistence, health-mcp Consumer, israeli-bank-scrapers, Maccabi Calibrated Scraper, Israeli Health Scrapers Project Instructions (+14 more)

### Community 7 - "flow-view.ts"
Cohesion: 0.23
Nodes (15): BindingDefinition, BindingResolution, ResolvedBinding, resolveSnapshotBindings(), TargetBindingDefinition, buildFlowView(), escapeHtml(), FlowStep (+7 more)

### Community 8 - "compilerOptions"
Cohesion: 0.12
Nodes (16): **/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit (+8 more)

### Community 11 - "Codebase Intelligence for israeli-health-scrapers (Repowise)"
Cohesion: 0.18
Nodes (9): Architecture, Code health, Codebase Intelligence for israeli-health-scrapers (Repowise), Commands, Entry points, Files that need care (bug-fix history first, then churn — check `get_risk` before editing), How to work in this repo, Key modules (+1 more)

### Community 12 - "maccabi.ts"
Cohesion: 0.06
Nodes (59): Appointment, Form17Request, Medication, TestResult, Vaccination, deriveExpiry(), formatOffset(), isBlank() (+51 more)

### Community 13 - "cli.ts"
Cohesion: 0.15
Nodes (20): VIEWPORT, HealthFundId, captureDiagnostics(), capturesDir(), dataRoot(), diagnosticsDir(), ensureDir(), sessionPath() (+12 more)

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

## Knowledge Gaps
- **134 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+129 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `playwright` connect `capture.ts` to `index.ts`, `package.json`, `base-scraper-with-browser.ts`, `flow-view.ts`, `maccabi.ts`, `cli.ts`?**
  _High betweenness centrality (0.149) - this node is a cross-community bridge._
- **Why does `keywords` connect `package.json` to `capture.ts`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _134 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06846635367762129 - nodes in this community are weakly interconnected._
- **Should `capture.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1141025641025641 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `base-scraper-with-browser.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14204545454545456 - nodes in this community are weakly interconnected._