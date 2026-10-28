# ConstructPro ERP - Tests

[![CI](https://github.com/ConstructPro-ERP/tests/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/ConstructPro-ERP/tests/actions/workflows/ci.yml) [![E2E test evidence](https://img.shields.io/badge/E2E-test%20register-blue)](https://github.com/ConstructPro-ERP/documents/blob/develop/testing/test-register.pdf)

**Live application:** https://construct-pro-teal.vercel.app/  
**API documentation (Swagger):** https://construct-pro-api-gateway.vercel.app/api/docs  
**Project organization:** https://github.com/ConstructPro-ERP  
**Project board:** https://github.com/orgs/ConstructPro-ERP/projects/2

## Project Description

This repository contains **Playwright integration and end-to-end (E2E) tests** for ConstructPro ERP, a cloud-based construction business management platform developed for **Ishara Homes Pvt. Ltd.** The tests exercise the Next.js frontend and the 14 NestJS backend applications (one API Gateway and 13 domain services) together against running applications; they are separate from the backend Jest tests and the frontend unit/component tests.

The application covers lead management, quotations, project management, milestones, tasks, expenses, documents, invoices and payments, analytics, AI risk prediction, Google Calendar connections, role-based access and client portal views.

**Broader project:** [ConstructPro ERP GitHub organization](https://github.com/ConstructPro-ERP)

## Demonstration Accounts

Open the **live application landing page** above, explore the site, and sign in using the relevant account.

| Role               | Email                       | Password             |
| ------------------ | --------------------------- | -------------------- |
| Administrator      | `admin.demo@example.com`    | `DemoAdministrator`  |
| Sales Manager      | `sales.demo@example.com`    | `DemoSalesManager`   |
| Project Manager    | `projects.demo@example.com` | `DemoProjectManager` |
| Accountant         | `accounts.demo@example.com` | `DemoAccountant`     |
| Client Portal User | `client.demo@example.com`   | `DemoClient`         |

These are demonstration credentials for academic evaluation. **Playwright test accounts are configured separately** through `E2E_*` environment variables; do not confuse the provided demonstration accounts with the writable test fixtures required by the test suite.

## Integration and End-to-End Coverage

The test suite includes both API checks and browser-based scenarios. It covers:

| Area                             | Test scope                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Authentication and authorization | Session setup, anonymous request rejection and role-specific access                                              |
| User management                  | User creation, search, updates, activation/deactivation and role assignment                                      |
| Leads and clients                | Lead status, notes, contacts, assignment, searching and client CRUD APIs                                         |
| Quotations                       | API lifecycle (BE-01–BE-09), form behavior and browser workflows (FE-01–FE-08)                                   |
| Projects                         | Project CRUD, assignment, status changes, project boundaries and lifecycle rules                                 |
| Milestones and tasks             | CRUD, progress, task assignment, and linked project resources                                                    |
| Project expenses                 | Financial validation, persistence and authorization                                                              |
| Project documents                | Metadata, upload/download, filtering, categories and authorization                                               |
| Calendar integration             | Connection status and optional calendar-event write operations                                                   |
| Finance and analytics            | Payment-to-invoice balance consistency, dashboard KPIs and AI predictions                                        |
| Client portal                    | Client-scoped project and document access through the backend tests; portal UI tested in the frontend repository |

The project-specific suites live under `e2e/projects/`, quotation suites under `e2e/quotations/`, and remaining management, finance, AI and authorization suites under `e2e/`.

### Recorded Test Results

The **Final Development Report, Section 5.4** records a local Playwright execution on **25 October 2026**:

| Outcome   |   Tests |
| --------- | ------: |
| Passed    |      83 |
| Failed    |       7 |
| Skipped   |      16 |
| Not run   |       1 |
| **Total** | **107** |

This is the recorded local execution result, **not** a claim that 107 tests passed or that the deployed Vercel environment completed the same run. The report identifies failures involving the AI Analytics interface, finance/AI access checks, the payment-to-dashboard flow, and three quotation UI cases. Read the [test register](https://github.com/ConstructPro-ERP/documents/blob/develop/testing/test-register.pdf) and the final report for execution details.

Backend Jest results and frontend unit/component results are reported by their own repositories, not as Playwright results here.

## Prerequisites

- Node.js 22+ (CI uses Node.js 24)
- npm and Git
- Playwright Chromium browser: `npx playwright install chromium`
- A running frontend, API gateway and applicable backend domain services
- Dedicated, disposable test accounts and records for state-changing tests

## Installation and Run Instructions

1. **Clone the repository:**

   ```bash
   git clone https://github.com/ConstructPro-ERP/tests.git
   cd tests
   ```

2. **Install dependencies and Chromium:**

   ```bash
   npm ci
   npx playwright install chromium
   ```

3. **Create an environment configuration:**

   **Windows PowerShell:**

   ```powershell
   Copy-Item .env.example .env
   ```

   **Linux Bash:**

   ```bash
   cp .env.example .env
   ```

   Playwright loads `.env` locally. Existing process or GitHub Actions environment variables take precedence.

4. **Set the application URLs and test credentials:**

   ```env
   FRONTEND_BASE_URL=http://localhost:3000
   API_BASE_URL=http://localhost:4000/api

   E2E_USER_EMAIL=your-test-admin@example.com
   E2E_USER_PASSWORD=your-test-password
   E2E_ADMIN_EMAIL=
   E2E_ADMIN_PASSWORD=
   E2E_ACCOUNTANT_EMAIL=
   E2E_ACCOUNTANT_PASSWORD=
   E2E_PROJECT_MANAGER_EMAIL=
   E2E_PROJECT_MANAGER_PASSWORD=
   E2E_QUOTATION_RESTRICTED_USER_EMAIL=
   E2E_QUOTATION_RESTRICTED_USER_PASSWORD=
   ```

   The checked-in `.env.example` contains further record IDs, optional role accounts and write toggles. Configure `E2E_INVOICE_ID`, `E2E_PROJECT_ID` and `E2E_LEAD_ID` where required by the selected cases. The actual account roles must match the suite's expectations.

5. **Run the complete Playwright suite:**

   ```bash
   npm run test:e2e
   ```

The frontend and backend must already be running. Playwright does not start ConstructPro application servers.

## Commands and Local Configuration

| Command                            | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `npm test` / `npm run test:e2e`    | Run all configured Playwright projects                   |
| `npm run test:e2e:management`      | User, leads, clients and management authorization suites |
| `npm run test:quotations`          | All quotation cases                                      |
| `npm run test:quotations:backend`  | Quotation API cases                                      |
| `npm run test:quotations:frontend` | Quotation browser cases                                  |
| `npm run test:e2e:headed`          | Run with visible browser                                 |
| `npm run test:e2e:ui`              | Open Playwright UI                                       |
| `npm run test:e2e -- --list`       | List tests without executing them                        |
| `npm run typecheck`                | TypeScript validation                                    |
| `npm run format:check`             | Markdown/TypeScript formatting check                     |
| `npx playwright show-report`       | View the local HTML report                               |

To check types and test discovery without connecting to a deployment:

```bash
npm run typecheck
npm run test:e2e -- --list
```

**Test discovery is not a successful test execution.** An HTML report from `--list` does not replace results from a completed run.

### Project and Quotation Test Configuration

The Playwright configuration uses three authentication-setup projects (`auth-root`, `auth-projects` and `auth-quotations`) and their dependent test projects (`root`, `projects`, `quotations`). Authentication states are stored in `playwright/.auth/`.

`E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` may be left **both blank** to use `E2E_USER_*`, provided that account has administrator permissions. Accountants, project managers and restricted quotation users require corresponding credentials for role-specific coverage.

Optional persistent writes are controlled by the values in `.env.example`, including `E2E_ALLOW_PERSISTENT_LIFECYCLE_WRITES`, `E2E_ENABLE_QUOTATION_PDF` and `E2E_ENABLE_CALENDAR_WRITES`. Some tests intentionally skip when their required configuration is absent.

### Test Execution and Artifacts

Playwright uses Chromium, a 60-second test timeout and a 15-second assertion timeout. CI uses one worker and two retries; local runs do not automatically retry.

HTML reports, traces, screenshots and videos are created under `playwright-report/` and `test-results/`. These directories and authentication state files are ignored by Git. Attach relevant failure artifacts and reproduction commands to defect issues.

Some suites modify persistent records, including invoices, payments, quotations, projects and documents. Use a suitable isolated testing environment. A finance test may record a payment and reduce a disposable invoice's outstanding balance; repeated executions need appropriate fixtures.

## Deployed Application

This repository has no separately deployed website. It tests the **ConstructPro ERP application**, accessible from the landing page linked at the top, together with the API gateway.

For local integration, use `FRONTEND_BASE_URL=http://localhost:3000` and `API_BASE_URL=http://localhost:4000/api`. For deployed validation, set these to the intended running environment; do not assume that a local passing result verifies the Vercel deployment.

## CI/CD

The [Tests CI workflow](.github/workflows/ci.yml) delegates validation to `ConstructPro-ERP/infra/.github/workflows/tests-ci.yml@v1`.

Normal push and pull-request validation installs dependencies, audits them, runs TypeScript checks and **lists** the Playwright tests. Running the full state-changing browser suite against the configured `staging` environment requires manual workflow dispatch. The reusable workflow must forward any additional role-specific environment variables required by the selected tests.

The CI workflow can upload Playwright failure evidence. See the [infrastructure documentation](https://github.com/ConstructPro-ERP/infra/blob/develop/README.md) for reusable workflow inputs and staging configuration.

## Repository Layout

| Path                       | Responsibility                                                  |
| -------------------------- | --------------------------------------------------------------- |
| `e2e/`                     | Browser and API workflow specifications                         |
| `e2e/projects/`            | Project, milestone, task, expense, document and calendar cases  |
| `e2e/quotations/`          | Quotation API and browser cases                                 |
| `e2e/support/`             | API helpers, shared contracts, authentication state and cleanup |
| `playwright.config.ts`     | Playwright projects, timeouts, retries and reports              |
| `.env.example`             | Supported environment values and write flags                    |
| `.github/workflows/ci.yml` | Shared infrastructure CI caller                                 |
| `PROJECT_E2E_GUIDE.md`     | Further project E2E setup and execution guidance                |

Frontend unit/component tests live in `frontend`, and backend unit/integration tests live in `backend`.

## Related Repositories

| Repository                                                  | Purpose                                            |
| ----------------------------------------------------------- | -------------------------------------------------- |
| [Frontend](https://github.com/ConstructPro-ERP/frontend)    | Next.js frontend and unit/component tests          |
| [Backend](https://github.com/ConstructPro-ERP/backend)      | NestJS API gateway, services and Prisma data layer |
| [Tests](https://github.com/ConstructPro-ERP/tests)          | Playwright API and browser E2E suites              |
| [Infrastructure](https://github.com/ConstructPro-ERP/infra) | Shared CI workflows and performance tooling        |
| [Documents](https://github.com/ConstructPro-ERP/documents)  | SRS, SDS, test register and supporting evidence    |

## Project Evidence

- [Software Requirements Specification](https://github.com/ConstructPro-ERP/documents/blob/develop/srs/srs-final.pdf)
- [Software Design Specification](https://github.com/ConstructPro-ERP/documents/blob/develop/sds/sds-final.pdf)
- [Test case register](https://github.com/ConstructPro-ERP/documents/blob/develop/testing/test-register.pdf)
- [Sprint 8 coverage report](https://github.com/ConstructPro-ERP/documents/blob/develop/testing/coverage-sprint8.pdf)
- [Performance test results](https://github.com/ConstructPro-ERP/documents/blob/develop/testing/performance-report.pdf)

## Academic Project

Developed as part of **SENG 34213 – System Development Project**, Bachelor of Science (Hons.) in Software Engineering, University of Kelaniya.
