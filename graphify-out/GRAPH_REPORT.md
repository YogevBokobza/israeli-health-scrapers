# Graph Report - .  (2026-07-28)

## Corpus Check
- Corpus is ~14,344 words - fits in a single context window. You may not need a graph.

## Summary
- 271 nodes · 603 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.93)
- Token cost: 228,528 input · 0 output

## Community Hubs (Navigation)
- Public API and Schemas
- Maccabi Data Parsing
- Package Metadata
- Browser Login Framework
- Fixtures and Calibration
- TypeScript Compiler Config
- Architecture and Contracts
- Login States and Errors
- Sessions and Diagnostics
- Security and Scope

## God Nodes (most connected - your core abstractions)
1. `BaseScraperWithBrowser` - 16 edges
2. `compilerOptions` - 16 edges
3. `ScraperCredentials` - 15 edges
4. `captureDiagnostics()` - 13 edges
5. `BaseScraper` - 12 edges
6. `ScraperLoginResult` - 11 edges
7. `Scraper` - 11 edges
8. `waitUntil()` - 10 edges
9. `MaccabiScraper` - 10 edges
10. `parseIsraeliDate()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Maccabi Calibrated Scraper` --shares_data_with--> `Maccabi Valid Prescriptions Fixture`  [INFERRED]
  AGENTS.md → test/fixtures/maccabi/medications.html
- `Selector Diagnostics Capture` --rationale_for--> `Maccabi Calibration Workflow`  [INFERRED]
  AGENTS.md → README.md
- `Maccabi Data Roadmap` --conceptually_related_to--> `Maccabi Future Appointments Fixture`  [INFERRED]
  README.md → test/fixtures/maccabi/appointments.html
- `Chromium DOM Parsing Coverage` --conceptually_related_to--> `Maccabi Appointment Detail Fixture`  [INFERRED]
  .github/workflows/ci.yml → test/fixtures/maccabi/appointment-detail.html
- `Chromium DOM Parsing Coverage` --conceptually_related_to--> `Maccabi Future Appointments Fixture`  [INFERRED]
  .github/workflows/ci.yml → test/fixtures/maccabi/appointments.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Maccabi DOM Fixture Coverage** — test_fixtures_maccabi_appointment_detail_appointment_detail_fixture, test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_testresults_test_results_timeline_fixture [INFERRED 0.95]
- **Future Appointment Parsing Shape** — test_fixtures_maccabi_appointments_future_appointments_fixture, test_fixtures_maccabi_appointments_timeline_appointment_row, test_fixtures_maccabi_appointments_required_start_filter, test_fixtures_maccabi_appointments_combined_specialty_visit_type, test_fixtures_maccabi_appointments_absent_list_location [EXTRACTED 1.00]
- **Standing Prescription Extraction Shape** — test_fixtures_maccabi_medications_valid_prescriptions_fixture, test_fixtures_maccabi_medications_prescription_card_structure, test_fixtures_maccabi_medications_standing_medication_filter, test_fixtures_maccabi_medications_invalid_prescription_row_filter [EXTRACTED 1.00]

## Communities (11 total, 1 thin omitted)

### Community 0 - "Public API and Schemas"
Cohesion: 0.10
Nodes (32): Appointment, appointmentSchema, FetchTarget, HealthAccount, healthAccountSchema, HealthFundTypes, isoDateSchema, LoginMethod (+24 more)

### Community 1 - "Maccabi Data Parsing"
Cohesion: 0.10
Nodes (36): playwright, deriveExpiry(), formatOffset(), isBlank(), jerusalemOffsetMinutes(), normalizeText(), parseInteger(), parseIsraeliDate() (+28 more)

### Community 2 - "Package Metadata"
Cohesion: 0.05
Nodes (36): dependencies, playwright, zod, description, devDependencies, @types/node, typescript, vitest (+28 more)

### Community 3 - "Browser Login Framework"
Cohesion: 0.20
Nodes (9): captureDiagnostics(), clickFirst(), elementExists(), fillFirst(), typeFirst(), waitUntil(), BaseScraperWithBrowser, LoginOptions (+1 more)

### Community 4 - "Fixtures and Calibration"
Cohesion: 0.10
Nodes (26): Chromium DOM Parsing Coverage, CI Workflow, Node.js 20 Runtime, Typecheck Test Build Quality Gates, Selector Diagnostics Capture, Sanitized Medical Test Fixtures, Maccabi Calibration Workflow, Maccabi Data Roadmap (+18 more)

### Community 5 - "TypeScript Compiler Config"
Cohesion: 0.08
Nodes (24): DOM, ES2022, node_modules, src/**/*.ts, test, compilerOptions, declaration, declarationMap (+16 more)

### Community 6 - "Architecture and Contracts"
Cohesion: 0.10
Nodes (22): BaseScraper Lifecycle, Scraper Contract Suite, Declarative Login State Machine, Encrypted Session Persistence, health-mcp Consumer, israeli-bank-scrapers, Maccabi Calibrated Scraper, Israeli Health Scrapers Project Instructions (+14 more)

### Community 7 - "Login States and Errors"
Cohesion: 0.16
Nodes (13): VIEWPORT, ScraperErrorTypes, conditionMatches(), LOGIN_RESULT_ERRORS, LoginCondition, LoginField, LoginResults, matchLoginResult() (+5 more)

### Community 8 - "Sessions and Diagnostics"
Cohesion: 0.31
Nodes (11): HealthFundId, dataRoot(), diagnosticsDir(), ensureDir(), sessionPath(), clearSession(), isExpired(), loadSession() (+3 more)

## Knowledge Gaps
- **77 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+72 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `playwright` connect `Maccabi Data Parsing` to `Public API and Schemas`, `Package Metadata`, `Browser Login Framework`, `Login States and Errors`, `Sessions and Diagnostics`?**
  _High betweenness centrality (0.170) - this node is a cross-community bridge._
- **Why does `keywords` connect `Package Metadata` to `Maccabi Data Parsing`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _77 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Public API and Schemas` be split into smaller, more focused modules?**
  _Cohesion score 0.09713487071977638 - nodes in this community are weakly interconnected._
- **Should `Maccabi Data Parsing` be split into smaller, more focused modules?**
  _Cohesion score 0.10104529616724739 - nodes in this community are weakly interconnected._
- **Should `Package Metadata` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `Fixtures and Calibration` be split into smaller, more focused modules?**
  _Cohesion score 0.09538461538461539 - nodes in this community are weakly interconnected._