# ConstructPro ERP - Tests

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

The `E2E` GitHub Actions workflow runs contract/type validation on pull
requests and executes the state-changing deployed suite only when manually
dispatched against the protected `staging` environment. Configure URLs and
record IDs as environment variables, and account credentials as secrets.

To run only API/authorization checks without the browser UI assertion:

```bash
npx playwright test finance-dashboard authorization --grep-invert "frontend"
```

## Failure evidence

HTML reports, traces, screenshots, and videos are written to ignored local
directories (`playwright-report/` and `test-results/`). Attach those artifacts
and the reproduction command when opening a bug issue; never attach `.env` or
credentials.

## Deployed Application

N/A (Testing Repository)
