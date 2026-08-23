# Changelog

All notable changes to this project will be documented in this file.

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
