# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- End-to-end tests for client and lead management, and a helper for separate
  admin credentials (#5).
- Frontend and backend quotation integration tests (#3, #4).
- Integration tests for invoice payments, finance-to-dashboard KPI refresh and
  ERP-data-to-AI prediction flows.
- User management and E2E instructions in the README (#8).

### Changed

- Test validation (typecheck and Playwright discovery) runs on every push, and
  the integration tests run through the shared workflows in `infra`.
- Lead search and status selection, and admin header validation, in the E2E
  tests.

### Removed

- The client portal spec (`e2e/client-portal.spec.ts`) and its workflow inputs.
