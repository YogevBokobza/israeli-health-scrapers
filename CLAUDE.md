# israeli-health-scrapers

## Test fixtures and PII

This repo is public. Never put real account data — real drug/medication names, real
doctor names, real ID numbers, real dates from an actual account — into test
fixtures, test files, commit messages, or PR descriptions, even when a fixture is
built by capturing the *shape* of a real logged-in session for calibration.

Always invent placeholder data with the same structural shape (same field types,
same edge cases like a two-digit year or a missing name) instead. If a fixture was
captured against a real account during live calibration, replace every real value
before it's committed — not just before it's pushed.
