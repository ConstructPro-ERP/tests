# ConstructPro ERP - Tests

[![CI](https://github.com/ConstructPro-ERP/tests/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/ConstructPro-ERP/tests/actions/workflows/ci.yml)

**Live application:** https://construct-pro-teal.vercel.app/  
**API documentation (Swagger):** https://construct-pro-api-gateway.vercel.app/api/docs

## Project Description

This repository contains the Integration and End-to-End (E2E) test suites for the **ConstructPro ERP** system. It ensures that the various modules (Sales, Project Management, Finance, Analytics) work seamlessly together.

**Broader Project:** [ConstructPro ERP Organization](https://github.com/ConstructPro-ERP)

## Integration coverage

The Playwright suite verifies the Sprint 7 cross-repository workflows against
the deployed frontend and API gateway:

- invoice payment -> persisted paid/outstanding amounts and status
- payment -> refreshed dashboard finance KPIs
- ERP project data -> AI risk prediction -> Analytics UI result
- anonymous and non-finance role restrictions

The finance test records a small real payment against disposable demo data. Use
a dedicated test invoice; repeated runs intentionally create unique payment
references and consume its outstanding balance.

## Prerequisites

- Node.js 22+
- Access to deployed frontend/API test environments and stable demo data
- Chromium (`npx playwright install chromium`)

## Installation & Run Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ConstructPro-ERP/tests.git
   cd tests
   ```
2. **Install dependencies and browser:**
   ```bash
   npm ci
   npx playwright install chromium
   ```
3. **Configure the environment:**
   ```bash
   cp .env.example .env
   ```
   Playwright loads `.env` locally. In CI, configure the same names in the
   repository secret store. The suite does not commit or print credentials.

4. **Run tests:**
   ```bash
   npm run test:e2e
   ```

The `Tests CI` GitHub Actions caller delegates to the reusable workflow in the
infrastructure repository. It runs contract/type validation on pull requests
and executes the state-changing deployed suite only when manually dispatched
against the protected `staging` environment. Configure URLs and record IDs as
environment variables, and account credentials as secrets.

To run only API/authorization checks without the browser UI assertion:

```bash
npx playwright test finance-dashboard authorization --grep-invert "frontend"
```

## User management, leads and clients

Run these suites independently of finance and AI demo records:

```bash
npm run test:e2e:management
```

Set `API_BASE_URL`, `FRONTEND_BASE_URL`, `E2E_ADMIN_EMAIL`, and
`E2E_ADMIN_PASSWORD`. The account must have the `ADMIN` role and the database
must contain a `SALES_MANAGER` role. Optionally set `E2E_ACCOUNTANT_EMAIL` and
`E2E_ACCOUNTANT_PASSWORD` to an `ACCOUNTANT` account for the role restrictions
test; that test explicitly skips when those credentials are absent.
For CI, the reusable infrastructure workflow must forward these new environment
variables into the Playwright job; `secrets: inherit` alone does not export them
as process environment variables.

If your existing `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` account is an admin,
leave **both** `E2E_ADMIN_*` variables blank to reuse it. Explicit admin
credentials take precedence; incomplete pairs fail with setup instructions.
A finance-only account cannot run the management tests.

If you see a credentials configuration error, create `.env` in this test
repository (PowerShell: `Copy-Item .env.example .env`) and replace the URL and
credential placeholders with real test-environment values. Do not overwrite an
existing `.env`. `.env.example` is not loaded automatically. Playwright loads
the `.env` next to its config even when launched from another directory, and
existing process/CI environment variables take precedence. Keep `.env` private.

| Suite | Coverage |
| --- | --- |
| `user-management.spec.ts` | Browser create/search/edit/deactivate/reactivate, role assignment, persisted details, password redaction, duplicate email and invalid input |
| `leads.spec.ts` | Browser capture/search/edit/note/delete, assignment, status, note/contact persistence and removal, search/filter/pagination, invalid input |
| `clients.spec.ts` | API create/list/read/update/delete, lead association, duplicate association, invalid input and missing records |
| `management-authorization.spec.ts` | Anonymous read/write rejection and optional accountant access restrictions |

Clients have no dedicated management page in the current frontend; client tests
exercise the deployed API gateway and backing service. Browser tests use real
login and application requests without mocking API responses.

Use a dedicated test environment. Each test creates uniquely named records and
the fixture attempts cleanup after failures as well as successful runs. Clients
and leads are deleted in reverse creation order; user deletion is a soft delete,
so inactive `E2E` users remain in the directory. Cleanup failures fail the test.
Interrupted processes or lost create responses may still leave test records.

To run only the new API cases:

```bash
npm run test:e2e:management -- --grep-invert frontend
```

To check types and test discovery without contacting a deployment:

```bash
npm run typecheck
npm run test:e2e:management -- --list
```

## Failure evidence

HTML reports, traces, screenshots, and videos are written to ignored local
directories (`playwright-report/` and `test-results/`). Attach those artifacts
and the reproduction command when opening a bug issue; never attach `.env` or
credentials.

## Deployed Application

N/A (Testing Repository)

## Commands and local configuration

| Command | Purpose |
| --- | --- |
| `npm test` / `npm run test:e2e` | Run all Playwright suites |
| `npm run test:e2e:headed` | Run with a visible browser |
| `npm run test:e2e:ui` | Open Playwright UI mode |
| `npm run test:e2e -- --list` | Discover all tests without running workflows |
| `npx playwright show-report` | Open the local HTML report |

For local development, set `FRONTEND_BASE_URL=http://localhost:3000` and
`API_BASE_URL=http://localhost:4000/api`. Use HTTP unless you configured local
TLS. Start the frontend, gateway, and required domain services separately;
Playwright does not start application servers.

Configure your own disposable accounts and records rather than relying on values
already present in an example file. Keep real credentials out of source control.
Finance requires `E2E_INVOICE_ID` and the finance account credentials; AI analytics
requires `E2E_PROJECT_ID`. `E2E_PAYMENT_AMOUNT` configures the payment amount.
The optional `E2E_RESTRICTED_USER_EMAIL` / `E2E_RESTRICTED_USER_PASSWORD` pair
supports finance and AI role checks. Management account requirements are above.

The configuration runs Chromium with a 60-second test timeout and a 15-second
assertion timeout. CI uses one worker and two retries; local runs have no automatic
retries. Allow enough disposable data for repeated state-changing tests.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `e2e/` | Browser and API workflow specifications |
| `e2e/support/` | API helpers, contracts, credentials, and cleanup fixtures |
| `playwright.config.ts` | Environment loading, browser, timeouts, and evidence |
| `.github/workflows/ci.yml` | Caller for the shared infrastructure workflow |

Frontend unit/component tests live in `frontend`; backend unit, route, and database
tests live in `backend`. This repository tests their integration against running
applications.
