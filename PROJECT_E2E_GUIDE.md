# ConstructPro Project Management E2E Tests — DDP-100

**Target:** `ConstructPro-ERP/tests` (`develop` base), feature branch `feature/100-project-management-e2e-tests`.

**Reviewed:** 25 October 2026 against the `develop` trees of `backend`, `frontend`, `tests`, `infra`, and `documents`, the current NestJS Gateway/API and DTOs, frontend Project Management components, and SDS project/document management flows. The purpose of this deliverable is executable tests only; **CI changes are out of scope**.

**Verification status:** Source-level API/DTO/UI audit, TypeScript syntax parsing and `git apply` dry run. **Not live-executed** against a deployed frontend/API, and **not typechecked with the repository's installed dependencies** in this environment. Do not describe tests as passing until you execute them and inspect Playwright reports.

## Applying the patch

Use a local `ConstructPro-ERP/tests` clone. Create the branch from `develop` **before** applying the patch. This patch adds files under `e2e/projects/` and the guide; it does not modify your existing support helpers or CI files.

**PowerShell (Windows):**

```powershell
git switch develop
git pull origin develop
git switch -c feature/100-project-management-e2e-tests
# Save the downloaded patch somewhere outside this repository first.
git apply --check "D:\Downloads\constructpro-project-e2e-v2.patch"
git apply "D:\Downloads\constructpro-project-e2e-v2.patch"
npm ci
npm run typecheck
npx playwright install chromium
npx playwright test e2e/projects --list
```

**Bash (Linux/macOS):**

```bash
git switch develop
git pull origin develop
git switch -c feature/100-project-management-e2e-tests
git apply --check ~/Downloads/constructpro-project-e2e-v2.patch
git apply ~/Downloads/constructpro-project-e2e-v2.patch
npm ci
npm run typecheck
npx playwright install chromium
npx playwright test e2e/projects --list
```

If you're **already on the correct branch**, do not recreate it; start from `git apply --check`. If you previously applied v1, **do not apply v2 on top of it**. Restore/remove the v1-added test files or create a clean branch from `develop` before applying v2. Do not delete other locally authored files.

## Local environment

Copy `tests/.env.example` to `tests/.env` and replace the placeholders with **working staging credentials** and URLs. The suite requires a dedicated disposable staging database. Do not run its state-changing tests against production or shared demonstration data. Never commit `.env`.

| Variable                                                    | Required?                                   | Meaning                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL`                                              | Required                                    | Deployed Gateway URL. Existing helper adds `/api` if missing.                                                                                  |
| `FRONTEND_BASE_URL`                                         | Required for browser tests                  | Deployed Next.js frontend URL. Browser tests skip without it.                                                                                  |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`                     | Required unless fallback is ADMIN           | Existing active ADMIN account. Both empty allows ADMIN credentials from `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.                              |
| `E2E_ACCOUNTANT_EMAIL`, `E2E_ACCOUNTANT_PASSWORD`           | Optional                                    | Active ACCOUNTANT user; enables Accountant API/UI cases.                                                                                       |
| `E2E_PROJECT_MANAGER_EMAIL`, `E2E_PROJECT_MANAGER_PASSWORD` | Optional                                    | Active PROJECT_MANAGER; enables assigned/foreign-project API and browser cases.                                                                |
| `E2E_ALTERNATE_PROJECT_MANAGER_ID`                          | Optional                                    | Valid active Admin/PM UUID for assignment case.                                                                                                |
| `E2E_DOCUMENT_PROJECT_ID`                                   | Optional                                    | **Dedicated mutable staging project**, not a fixture-created one, because document metadata is soft-deleted.                                   |
| `E2E_DOCUMENT_CATEGORY_ID`                                  | Optional                                    | Existing active document category UUID.                                                                                                        |
| `E2E_ENABLE_DOCUMENT_UPLOADS=true`                          | Optional, explicit opt-in                   | Runs real multipart storage tests, browser document upload, and deletion.                                                                      |
| `E2E_ENABLE_DIRECT_DOCUMENT_UPLOADS=true`                   | Optional, explicit opt-in                   | Also performs a signed **4 MiB+** raw-file upload through Cloudinary. Requires previous upload flag.                                           |
| `E2E_ENABLE_CALENDAR_WRITES=true`                           | Optional, explicit opt-in                   | Creates/updates/deletes an event on the ADMIN user's connected **test** Google Calendar.                                                       |
| `E2E_LEAD_ID`                                               | Optional, required for lifecycle conversion | Existing disposable valid lead ID accepted by quotation creation. Not the example placeholder UUID.                                            |
| `E2E_ALLOW_PERSISTENT_LIFECYCLE_WRITES=true`                | Optional, explicit opt-in                   | Enables irreversible quotation conversion, completed/cancelled project and closed-project tests; **requires a staging DB that you can reset**. |

When a role or external integration has not been configured, the related test is intentionally **skipped**. Review the skipped count before claiming complete execution.

## Recommended execution sequence

From the `tests` repo root:

```bash
npm run typecheck
npx playwright test e2e/projects --list
npx playwright test e2e/projects/projects.spec.ts --workers=1
npx playwright test e2e/projects/project-boundaries.spec.ts --workers=1
npx playwright test e2e/projects/milestones.spec.ts --workers=1
npx playwright test e2e/projects/tasks.spec.ts --workers=1
npx playwright test e2e/projects/expenses.spec.ts --workers=1
npx playwright test e2e/projects/authorization.spec.ts e2e/projects/project-manager.spec.ts --workers=1
npx playwright test e2e/projects/projects-ui.spec.ts --workers=1
npx playwright test e2e/projects/documents.spec.ts --workers=1
npx playwright test e2e/projects/project-calendar.spec.ts --workers=1
npx playwright test e2e/projects/project-concurrency.spec.ts --workers=1
npx playwright test e2e/projects/workflows.spec.ts --workers=1
```

Run **everything** with:

```bash
npx playwright test e2e/projects --workers=1 --timeout=120000
```

For the Cloudinary upload, Google Calendar write, and quotation lifecycle cases, set their explicit opt-in environment flags and re-run only those files. On PowerShell, to enable an optional flag in the current terminal session:

```powershell
$env:E2E_ENABLE_DOCUMENT_UPLOADS = "true"
npx playwright test e2e/projects/documents.spec.ts --workers=1 --timeout=180000
```

On Bash:

```bash
E2E_ENABLE_DOCUMENT_UPLOADS=true npx playwright test e2e/projects/documents.spec.ts --workers=1 --timeout=180000
```

Inspect the HTML report with `npx playwright show-report`. A non-zero exit code means the tests failed. Take a copy of the first failed assertion, API response body, screenshot, and trace for analysis; do not loosen assertions merely to make failures disappear.

## Coverage map

| Feature                     | Files                                                                             | Exercised scenarios                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project CRUD and pagination | `projects.spec.ts`, `project-boundaries.spec.ts`                                  | Create, list, search, status/manager filters, sorting, update, delete, invalid IDs, date ranges, budgets, invalid status transitions, dependency deletion.                                             |
| Project lifecycle           | `project-lifecycle.spec.ts` **opt-in**                                            | Quotation conversion, duplicate conversion prevention, ACTIVE→ON_HOLD→ACTIVE→COMPLETED, milestone completion requirement, PLANNING→CANCELLED, terminal state checks.                                   |
| Tasks                       | `tasks.spec.ts`, `project-boundaries.spec.ts`                                     | CRUD, assignment/unassignment, status, global and project filters, search, pagination, assignees, due-date limits, invalid milestone/project relationships.                                            |
| Milestones                  | `milestones.spec.ts`, `project-boundaries.spec.ts`, `project-concurrency.spec.ts` | CRUD, weight and progress validation, derived state/completed timestamp/delay, weighted project progress, task-linked deletion block, concurrent writes.                                               |
| Expenses                    | `expenses.spec.ts`, `project-concurrency.spec.ts`                                 | CRUD, amounts/precision, creator attribution, category/date filters, pagination, summary, nullable fields, invalid amounts, concurrent totals.                                                         |
| Documents                   | `documents.spec.ts`, `projects-ui.spec.ts` **storage opt-in for real files**      | Category operations, invalid content/signatures, file-size limits, metadata rules, actual multipart/direct Cloudinary uploads, search, update, download authorization, deletion, browser upload cycle. |
| Security                    | `authorization.spec.ts`, `project-manager.spec.ts`, `projects-ui.spec.ts`         | Anonymous 401, role 403, Accountant rights, Project Manager assigned/unassigned project isolation, read-only vs writable UI controls.                                                                  |
| Browser workflows           | `projects-ui.spec.ts`                                                             | Dashboard/details/tab navigation, project creation/edit/validation, milestone creation/progress/delete, task create/edit/delete, expense create/edit/delete, documents and calendar UI.                |
| Calendar                    | `project-calendar.spec.ts` **write opt-in**                                       | Connection status and a real project-scoped Google event create/list/update/delete round-trip.                                                                                                         |
| Cross-module                | `workflows.spec.ts`, `project-lifecycle.spec.ts`                                  | Milestone weight aggregation, task completion independence, project/quotation/task/expense associations and closure rules.                                                                             |

## Remaining coverage limitations

This is a broad executable suite, but **do not call it 100% coverage** without executing every relevant scenario and checking the result against an exhaustive SRS use-case register. Specific limitations:

- Quotations are not deletable via the published API; the **opt-in lifecycle tests create persistent staging records**. Reset that database after those runs. Do not enable these tests on production.
- File types cover major opaque and strict-validation paths, but not a valid stored file for **every** extension. The backend unit/integration tests cover more file-parser permutations; add real sample fixtures if full binary-format E2E evidence is required.
- Client Portal document ownership and access cases are in the separately planned `DDP-98` client-portal E2E issue, not duplicated here.
- Google OAuth account connection/disconnection and a full interactive event editing journey are not covered; the event API CRUD test needs an already connected test calendar.
- External provider outages, high load, simulated interrupted transfers and accessibility auditing require separate harnesses or fixtures.
- Project/Task/Milestone/Expense role permutations require actual staging accounts; unconfigured role tests skip.
- Actual test pass/fail/skip outcomes cannot be known before executing the suite against the target deployment.

**Isolation rule:** Regular API/UI tests use unique fixture-created projects and a teardown sweep that removes tasks, expenses and milestones before deleting those projects. Document storage tests use an explicit dedicated project since deleted document history can prohibit project deletion. Persistent quotation lifecycle tests are separated and must never run without explicit opt-in.
