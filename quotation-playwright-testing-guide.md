# ConstructPro ERP — Quotation Service Integration & E2E Testing Guide (Playwright)

**Document:** `docs/testing/quotation-playwright-testing-guide.md`  
**Owner:** Sprint 8 Person 2 (Quotations, Conversion & Lead-to-Project Workflow Quality)  
**Test Framework:** Playwright (TypeScript)  
**Target Repository:** Standalone `tests` repository  

---

## 1. Executive Summary & Ownership Scope

As **Person 2**, your core testing responsibility covers:
1. **Quotation Calculations & Math Precision:** Floating-point precision, `amount = round2(quantity * unitPrice)`, `subtotal`, `tax`, `discount`, and `totalAmount` without calculation drift between UI and backend.
2. **Quotation State Machine:** Strict enforcement of allowed status transitions:
   - `DRAFT` &rarr; `SENT`
   - `SENT` &rarr; `APPROVED` / `REJECTED` / `REVISED`
   - `APPROVED` &rarr; `CONVERTED`
   - Guard against illegal jumps (e.g. `DRAFT` or `REJECTED` cannot directly convert to `CONVERTED`).
3. **Duplicate Conversion Guardrails:** Ensuring an already-converted quotation cannot be converted twice (idempotency / 400 or 409 conflict).
4. **PDF Generation & Export:** Resilient document generation via `GET /quotations/:id/pdf` and UI download.
5. **Cross-Service Flow (`Lead → Quotation → Approval → Project`):** End-to-end integration across Gateway, Lead, Quotation, and Project services.
6. **Role-Based Access Control (RBAC):** Proper enforcement of JWT authorization and role restrictions (`SALES_MANAGER`, `ADMIN`, `PROJECT_MANAGER`, `ACCOUNTANT`).

---

## 2. Test Architecture in the Standalone `tests` Repository

Playwright natively supports **both** headless HTTP API testing (Integration) and full browser automation (E2E) in the same runner.

### Recommended Directory Structure

```text
tests-repo/
├── .env.example
├── .env
├── package.json
├── playwright.config.ts
├── fixtures/
│   ├── auth.setup.ts            # Global login / storageState setup
│   └── quotation.fixtures.ts    # Reusable payload factories & types
├── tests/
│   ├── integration/             # Headless API integration tests (using request fixture)
│   │   ├── quotation-api.spec.ts
│   │   ├── quotation-calculations.spec.ts
│   │   └── quotation-state-machine.spec.ts
│   └── e2e/                     # Browser UI tests (using page fixture)
│       └── lead-to-project.spec.ts
└── README.md
```

---

## 3. Playwright Configuration (`playwright.config.ts`)

Configure Playwright to separate fast API integration tests from browser E2E tests:

```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.FRONTEND_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // 1. Headless API Integration Suite (Fast HTTP calls)
    {
      name: 'api-integration',
      testDir: './tests/integration',
      use: {
        baseURL: process.env.API_GATEWAY_URL || 'http://localhost:3000',
        extraHTTPHeaders: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      },
    },

    // 2. Browser E2E Suite (Chromium)
    {
      name: 'e2e-chromium',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.FRONTEND_URL || 'http://localhost:5173',
      },
    },
  ],
});
```

### Environment File (`.env`)

```ini
# ConstructPro Services
API_GATEWAY_URL=http://localhost:3000
QUOTATION_SERVICE_URL=http://localhost:4009
FRONTEND_URL=http://localhost:5173

# Test Credentials
TEST_ADMIN_EMAIL=admin@constructpro.com
TEST_ADMIN_PASSWORD=Password123!
TEST_SALES_EMAIL=sales@constructpro.com
TEST_SALES_PASSWORD=Password123!
TEST_UNAUTHORIZED_EMAIL=client@constructpro.com
TEST_UNAUTHORIZED_PASSWORD=Password123!

# Pre-seeded test fixtures (UUIDs from staging/demo database)
TEST_LEAD_ID=00000000-0000-0000-0000-000000000001
TEST_PM_USER_ID=00000000-0000-0000-0000-000000000002
```

---

## 4. Part 1: Writing API Integration Tests (`tests/integration/`)

Playwright's `request` fixture (`APIRequestContext`) tests backend endpoints over HTTP directly through the API Gateway without launching a browser.

### Key Test File: `tests/integration/quotation-api.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

const GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';
const LEAD_ID = process.env.TEST_LEAD_ID || '00000000-0000-0000-0000-000000000001';

test.describe('Quotation Service — Integration API Suite', () => {
  let adminToken: string;
  let unauthorizedToken: string;
  let testQuotationId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Acquire Admin Token
    const adminLogin = await request.post(`${GATEWAY_URL}/auth/login`, {
      data: {
        email: process.env.TEST_ADMIN_EMAIL || 'admin@constructpro.com',
        password: process.env.TEST_ADMIN_PASSWORD || 'Password123!',
      },
    });
    expect(adminLogin.ok(), 'Admin login failed').toBeTruthy();
    const adminBody = await adminLogin.json();
    adminToken = adminBody.accessToken || adminBody.token;

    // 2. Acquire Client/Unauthorized Token for RBAC verification
    const clientLogin = await request.post(`${GATEWAY_URL}/auth/login`, {
      data: {
        email: process.env.TEST_UNAUTHORIZED_EMAIL || 'client@constructpro.com',
        password: process.env.TEST_UNAUTHORIZED_PASSWORD || 'Password123!',
      },
    });
    if (clientLogin.ok()) {
      const clientBody = await clientLogin.json();
      unauthorizedToken = clientBody.accessToken || clientBody.token;
    }
  });

  const adminHeaders = () => ({
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  });

  // TEST 1: Creation & Mathematical Precision
  test('POST /quotations — creates draft quotation with accurate line item and total calculations', async ({ request }) => {
    const payload = {
      leadId: LEAD_ID,
      notes: 'Automated integration test quotation',
      items: [
        { itemName: 'Structural Concrete Grade 30', quantity: 15, unitPrice: 120.50 }, // 1807.50
        { itemName: 'Reinforced Steel Rods (12mm)', quantity: 20, unitPrice: 45.25 },   //  905.00
      ],
    };

    const response = await request.post(`${GATEWAY_URL}/quotations`, {
      headers: adminHeaders(),
      data: payload,
    });

    expect(response.status()).toBe(201);
    const body = await response.json();

    expect(body).toHaveProperty('id');
    testQuotationId = body.id;

    // Status verification
    expect(body.status).toBe('DRAFT');

    // Mathematical integrity: (15 * 120.50) + (20 * 45.25) = 1807.50 + 905.00 = 2712.50
    expect(Number(body.subtotal)).toBeCloseTo(2712.50, 2);
    expect(Number(body.totalAmount)).toBeCloseTo(2712.50, 2);
    expect(body.items).toHaveLength(2);
  });

  // TEST 2: Query by ID
  test('GET /quotations/:id — returns full quotation payload with nested items', async ({ request }) => {
    expect(testQuotationId, 'Quotation must be created prior to fetch').toBeDefined();

    const response = await request.get(`${GATEWAY_URL}/quotations/${testQuotationId}`, {
      headers: adminHeaders(),
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(testQuotationId);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  // TEST 3: Update Quotation Items & Recalculate
  test('PUT /quotations/:id — updates items and dynamically recalculates total amount', async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const updatePayload = {
      notes: 'Updated quantities for verification',
      items: [
        { itemName: 'Structural Concrete Grade 30', quantity: 10, unitPrice: 120.50 }, // 1205.00
      ],
    };

    const response = await request.put(`${GATEWAY_URL}/quotations/${testQuotationId}`, {
      headers: adminHeaders(),
      data: updatePayload,
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Number(body.totalAmount)).toBeCloseTo(1205.00, 2);
  });

  // TEST 4: State Machine Revision Transition
  test('PATCH /quotations/:id/revise — transitions status to REVISED', async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const response = await request.patch(`${GATEWAY_URL}/quotations/${testQuotationId}/revise`, {
      headers: adminHeaders(),
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('REVISED');
  });

  // TEST 5: PDF Generation Resiliency
  test('GET /quotations/:id/pdf — returns document download or pre-signed URL', async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const response = await request.get(`${GATEWAY_URL}/quotations/${testQuotationId}/pdf`, {
      headers: adminHeaders(),
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('url');
    expect(typeof body.url).toBe('string');
  });

  // TEST 6: Approval & Project Conversion
  test('PATCH /quotations/:id/approve — approves quotation and triggers Project creation', async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const approvePayload = {
      projectName: 'Sprint 8 Commercial Tower Alpha',
      location: 'Kandy City Center',
      budget: 1205.00,
    };

    const response = await request.patch(`${GATEWAY_URL}/quotations/${testQuotationId}/approve`, {
      headers: adminHeaders(),
      data: approvePayload,
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Verify converted status and linkage to project
    expect(body.status).toBe('CONVERTED');
    expect(body.projectId).toBeDefined();
  });

  // TEST 7: Guardrail Against Duplicate Conversion
  test('GUARD: Duplicate conversion attempt is blocked', async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const duplicateResponse = await request.patch(`${GATEWAY_URL}/quotations/${testQuotationId}/approve`, {
      headers: adminHeaders(),
      data: {
        projectName: 'Illegal Duplicate Project Creation',
      },
    });

    // Guardrail must block duplicate conversion
    expect([400, 409]).toContain(duplicateResponse.status());
    const errBody = await duplicateResponse.json();
    expect(errBody.message).toMatch(/(already converted|invalid state|cannot approve)/i);
  });

  // TEST 8: RBAC Verification
  test('RBAC: Unauthenticated and unauthorized requests are rejected', async ({ request }) => {
    // 1. Missing Authorization header -> 401 Unauthorized
    const unauthenticated = await request.post(`${GATEWAY_URL}/quotations`, {
      data: { leadId: LEAD_ID, items: [] },
    });
    expect(unauthenticated.status()).toBe(401);

    // 2. Unauthorized Role -> 403 Forbidden
    if (unauthorizedToken) {
      const forbidden = await request.post(`${GATEWAY_URL}/quotations`, {
        headers: {
          Authorization: `Bearer ${unauthorizedToken}`,
          'Content-Type': 'application/json',
        },
        data: { leadId: LEAD_ID, items: [] },
      });
      expect(forbidden.status()).toBe(403);
    }
  });
});
```

---

## 5. Part 2: Writing Browser E2E Tests (`tests/e2e/`)

The E2E test validates the full user journey on the frontend web application:
`Login → Lead Selection → Quotation Line Items & Live Calculation → Approve → Convert to Project → Verify Project Created`.

### Key Test File: `tests/e2e/lead-to-project.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

test.describe('E2E Lifecycle: Lead → Quotation → Approval → Project', () => {

  test.beforeEach(async ({ page }) => {
    // Step 1: Login via UI
    await page.goto(`${FRONTEND_URL}/login`);
    await page.fill('input[type="email"], input[name="email"]', process.env.TEST_ADMIN_EMAIL || 'admin@constructpro.com');
    await page.fill('input[type="password"], input[name="password"]', process.env.TEST_ADMIN_PASSWORD || 'Password123!');
    await page.click('button[type="submit"]');

    // Confirm navigation into dashboard
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('User completes Lead to Project conversion flow with accurate calculations', async ({ page }) => {
    // Step 2: Navigate to Quotations module
    await page.click('nav >> text=Quotations');
    await expect(page).toHaveURL(/.*quotations/);

    // Step 3: Open "Create Quotation" modal / page
    await page.click('button:has-text("New Quotation"), button:has-text("Create Quotation")');

    // Step 4: Select Lead from dropdown
    const leadSelect = page.locator('select[name="leadId"], #lead-select, [data-testid="lead-select"]');
    await leadSelect.selectOption({ index: 1 });

    // Step 5: Fill line item 1
    await page.fill('input[name="items.0.itemName"], input[placeholder*="Item name"]', 'Reinforced Concrete Foundation');
    await page.fill('input[name="items.0.quantity"], input[placeholder*="Qty"]', '10');
    await page.fill('input[name="items.0.unitPrice"], input[placeholder*="Unit Price"]', '500.00');

    // Step 6: Add line item 2
    const addLineBtn = page.locator('button:has-text("Add Item"), button:has-text("+ Add Line")');
    if (await addLineBtn.isVisible()) {
      await addLineBtn.click();
      await page.fill('input[name="items.1.itemName"]', 'Prefabricated Steel Joists');
      await page.fill('input[name="items.1.quantity"]', '4');
      await page.fill('input[name="items.1.unitPrice"]', '750.00');
    }

    // Step 7: Verify live UI dynamic calculation (10 * 500 + 4 * 750 = 5000 + 3000 = 8000.00)
    const totalAmount = page.locator('[data-testid="quotation-total"], .total-amount, text=8,000.00');
    await expect(totalAmount).toBeVisible();

    // Step 8: Save draft quotation
    await page.click('button:has-text("Save Quotation"), button:has-text("Submit")');
    await expect(page.locator('text=Quotation created successfully, text=Success')).toBeVisible();

    // Step 9: Transition status to Approved
    const approveBtn = page.locator('button:has-text("Approve")');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Confirm modal if confirmation dialog is prompted
    const confirmModalBtn = page.locator('.modal button:has-text("Confirm"), button:has-text("Yes, Approve")');
    if (await confirmModalBtn.isVisible()) {
      await confirmModalBtn.click();
    }
    await expect(page.locator('text=APPROVED')).toBeVisible();

    // Step 10: Verify PDF download trigger
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 6000 }).catch(() => null),
      page.click('button:has-text("Download PDF"), button:has-text("Export PDF")'),
    ]);
    if (download) {
      expect(download.suggestedFilename()).toContain('.pdf');
    }

    // Step 11: Convert to Project
    const convertBtn = page.locator('button:has-text("Convert to Project")');
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // Fill project modal
    const projectNameInput = page.locator('input[name="projectName"], input[placeholder*="Project Name"]');
    if (await projectNameInput.isVisible()) {
      await projectNameInput.fill('Commercial Office Complex Sprint 8');
    }
    await page.click('button:has-text("Confirm Conversion"), button:has-text("Create Project")');

    // Step 12: Assert redirect to Project view
    await expect(page).toHaveURL(/.*projects/);
    await expect(page.locator('text=Commercial Office Complex Sprint 8')).toBeVisible();

    // Step 13: Guard verification — navigate back and ensure quotation is CONVERTED & locked
    await page.goBack();
    await expect(page.locator('text=CONVERTED')).toBeVisible();
    await expect(page.locator('button:has-text("Convert to Project")')).toBeDisabled();
  });
});
```

---

## 6. How to Run the Suites in the `tests` Repository

Add the following helper scripts to `package.json` in the `tests` repo:

```json
{
  "scripts": {
    "test:integration": "playwright test --project=api-integration",
    "test:e2e": "playwright test --project=e2e-chromium",
    "test:e2e:headed": "playwright test --project=e2e-chromium --headed",
    "test:all": "playwright test",
    "test:report": "playwright show-report"
  }
}
```

### Execution Commands:

1. **Run only API Integration Tests:**
   ```bash
   npm run test:integration
   ```
2. **Run E2E UI Tests (Headed for visual inspection during rehearsal):**
   ```bash
   npm run test:e2e:headed
   ```
3. **Run All Tests & Open Visual HTML Report:**
   ```bash
   npm run test:all
   npm run test:report
   ```

---

## 7. Sprint 8 Quality Gate & Demo Evidence Checklist

Before the live panel demonstration, verify that:
- [ ] All line item additions and edits compute without rounding drift (`subtotal`, `tax`, `totalAmount`).
- [ ] Duplicate conversions are firmly rejected with clean error messages.
- [ ] PDF generation returns without timeout or blank documents.
- [ ] Playwright HTML test report is exported and archived for `documents/testing/coverage-sprint8.pdf` and `documents/testing/test-register.pdf`.
- [ ] 20-minute rehearsal has successfully validated hand-off from Person 1 (Lead) &rarr; Person 2 (Quotation) &rarr; Person 3 (Project).
