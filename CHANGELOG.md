# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-08-23

### Added
- Added a `testResultDetails` fetch target for Maccabi: per-entry laboratory values (analyte, value, unit, reference range, in/out-of-range status) and result documents (imaging reports, bone density reports, etc.), fetched one request per timeline entry. Bounded by the new `testResultDetailsSince` scraper option so a caller can skip re-fetching history already collected.
- Added `TestResultValue` (one measured analyte) and `HealthDocument` (a result carried as a file, base64-encoded — this library owns no storage) to the shared model, plus `TestResultKind` (`lab` / `document` / `imaging` / `other`) and a shared `deriveReferenceStatus` helper so "was this abnormal" means the same thing at every fund.
- `TestResult` grows `resultedOn`, `category`, `kind`, `isPartial`, `institute`, `documentAvailable`, and the optional `values`/`document` populated only by `testResultDetails`.

### Changed
- **Breaking:** Maccabi test results are now read through the page's own JSON API instead of the DOM — the rendered timeline carries no stable id and no document-authorization pair, both of which exist only in the API response. `testResultRowToTestResult`/`scrapeTestResultRows`/`loadAllTestResultRows` are removed; `testEntryToTestResult` replaces them.
- **Breaking:** A test result's `id` is now the fund's own `type::request_id`, replacing a hash of name/date/doctor. The old hash collapsed two same-day batches for the same referrer into one row; the new id does not.

### Fixed
- Bearer tokens are now redacted from request-failure error messages (`requestFailure` in `src/scrapers/errors.ts`) — a network blip during an API call no longer risks writing a live token into an error message a caller might log.
- A successfully completed scrape no longer dumps the logged-in page's HTML to `data/diagnostics/`; `terminate` is now told the real outcome instead of a hardcoded `false`.

[0.4.0]: https://github.com/YogevBokobza/israeli-health-scrapers/compare/v0.3.0...v0.4.0

## [0.3.0] - 2026-08-23

### Added
- Added `isStanding` to the `Medication` model, flagging whether a prescription is a standing one (תרופה קבועה) rather than a one-off.

### Changed
- Maccabi `fetchMedications` now returns **every** valid prescription on the ValidPrescriptions page — both standing and one-off — instead of silently dropping the one-off rows. `prescriptionRowToMedication` sets `isStanding` from the row's standing-medication badge and only drops rows that have no drug name. Filtering to standing prescriptions is now the caller's choice.

[0.3.0]: https://github.com/YogevBokobza/israeli-health-scrapers/compare/v0.2.1...v0.3.0

## [0.2.1] - 2026-08-23

### Fixed
- Fixed Maccabi SMS/two-factor login getting stuck on the interim "how do you want to verify" screen when authenticating through `triggerTwoFactorAuth` — it now runs the same `afterSubmit` step as the one-shot `login()` path.

[0.2.1]: https://github.com/YogevBokobza/israeli-health-scrapers/compare/v0.2.0...v0.2.1

## [0.2.0] - 2026-08-22

### Added
- Added Maccabi Form 17 commitment requests through the `form17` fetch target, including request status, dates, provider, appointment, document, and follow-up information.
- Added the exported `Form17Request` type, `form17RequestSchema`, and runtime `FETCH_TARGETS` list.
- Added a calibration CLI for capturing authenticated fund pages and a flow view for verifying current selectors and parsed results against private snapshots.

### Changed
- Improved Maccabi calibration support for lazy-loaded timelines, expandable rows, persistent capture controls, and fund-specific starting pages.

[0.2.0]: https://github.com/YogevBokobza/israeli-health-scrapers/compare/v0.1.0...v0.2.0
