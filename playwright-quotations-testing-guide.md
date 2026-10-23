# Playwright Testing Guide: Quotations Section (ConstructPro ERP)

This comprehensive guide details how to implement **Integration Tests** and **End-to-End (E2E) Tests** using **Playwright** for the **Quotations** module in ConstructPro ERP.

---

## 1. Overview & Architecture

The Quotations module (`/dashboard/quotations`) manages the full lifecycle of project quotations:
- **Creation**: Lead selection, dynamic line items (name, quantity, unit price), notes, and real-time total computation.
- **Workflow & Statuses**: `DRAFT` $\to$ `PENDING_APPROVAL` $\to$ `APPROVED` $\to$ `CONVERTED` (or `REJECTED` $\to$ `REVISED`).
- **Role-based Actions**: `ADMIN`, `MANAGER`, and `SALES_MANAGER` can approve, reject, or convert quotations.
- **Modals**: Edit line items, reject with mandatory reason, and convert to project.
- **Document Export**: Cloudinary/PDF generation and download.

---

## 2. Integration Tests vs. E2E Tests in Playwright

| Dimension | Integration Tests | End-to-End (E2E) Tests |
| :--- | :--- | :--- |
| **Primary Goal** | Test component-API contracts and UI behavior in isolation, or test API endpoints directly. | Test complete end-to-end user workflows against a real running stack. |
| **Backend Dependency** | **Mocked / Controlled** via `page.route()` or dedicated mock server (or standalone API via `request`). | **Real running backend** + real database seed state. |
| **Speed & Determinism** | ⚡ High execution speed, 100% deterministic, no database pollution. | 🐢 Slower, subject to environmental stability and network latency. |
| **Ideal Coverage** | Validation errors, status transitions, edge cases (400, 404, 409, 500), empty/unavailable states, calculations. | Golden paths: Lead $\to$ Quotation $\to$ Approval $\to$ Project Conversion $\to$ PDF Export. |

---

## 3. Recommended Structure for the `tests` Repository

In your dedicated `tests` repository, organize your test suites as follows:

```text
tests/
├── playwright.config.ts
├── package.json
├── fixtures/
│   ├── auth.setup.ts               # Logs in once and writes storageState.json
│   └── quotationData.ts            # Reusable mock schemas and DTOs
├── integration/
│   └── quotations/
│       ├── quotations-ui.spec.ts   # UI + Mocked API integration tests (page.route)
│       └── quotations-api.spec.ts  # Direct backend REST API tests (request fixture)
└── e2e/
    └── quotations/
        └── quotations-lifecycle.spec.ts # Full browser journey with real backend
```

---

## 4. Playwright Configuration (`playwright.config.ts`)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Setup project for shared authentication state
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'integration',
      testDir: './integration',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e',
      testDir: './e2e',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'storageState.json',
      },
    },
  ],
});
```

---

## 5. Global Authentication Setup (`fixtures/auth.setup.ts`)

Avoid repeated UI logins across your E2E tests by capturing browser state:

```typescript
import { test as setup, expect } from '@playwright/test';

const authFile = 'storageState.json';

setup('authenticate as sales manager', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('sales.manager@constructpro.com');
  await page.getByLabel(/password/i).fill('Password123!');
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await page.waitForURL('**/dashboard**');
  await expect(page.locator('body')).not.toContainText(/invalid credentials/i);

  // Save signed-in storage state (cookies, localStorage, session)
  await page.context().storageState({ path: authFile });
});
```

---

## 6. Frontend Integration Tests (`integration/quotations/quotations-ui.spec.ts`)

These tests mock backend network requests using `page.route()`, validating:
1. Client-side form validation.
2. Dynamic addition and removal of line items.
3. Live total amount recalculation matching backend floating-point precision (`round2`).
4. Status transitions, tab filters, and API error messaging (409 Conflict, 500 Internal Error).

```typescript
import { test, expect } from '@playwright/test';

test.describe('Quotations Dashboard - Frontend Integration (Mocked Network)', () => {
  const mockQuotations = [
    {
      id: 'quo-mock-001',
      leadId: 'lead-101',
      quotationDate: '2026-10-11',
      status: 'PENDING_APPROVAL',
      totalAmount: 1850000,
      notes: 'Initial construction survey and foundation',
      pdfUrl: null,
      projectId: null,
      lead: { id: 'lead-101', customerName: 'Skyline Heights' },
      items: [
        {
          id: 'item-1',
          itemName: 'Site survey & soil testing',
          quantity: 1,
          unitPrice: 350000,
          amount: 350000,
        },
        {
          id: 'item-2',
          itemName: 'Foundation works',
          quantity: 1,
          unitPrice: 1500000,
          amount: 1500000,
        },
      ],
    },
  ];

  test.beforeEach(async ({ page }) => {
    // Mock GET /quotations endpoint
    await page.route('**/quotations*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: mockQuotations,
            total: 1,
            page: 1,
            limit: 5,
            totalPages: 1,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock GET /leads dropdown list
    await page.route('**/leads*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'lead-101', customerName: 'Skyline Heights', companyName: 'Skyline Corp' },
          { id: 'lead-102', customerName: 'Lotus Villa', companyName: 'Lotus Estates' },
        ]),
      });
    });

    await page.goto('/dashboard/quotations');
  });

  test('enforces client-side validation on empty submission', async ({ page }) => {
    // Attempt to submit empty form
    await page.getByRole('button', { name: 'Generate Quotation' }).click();

    // Verify field validation error messages
    await expect(page.getByText('Lead ID is required.')).toBeVisible();
    await expect(page.getByText(/item name is required/i)).toBeVisible();
  });

  test('dynamically adds line items and updates live total computation', async ({ page }) => {
    const itemNameInput = page.getByPlaceholder('Item name').first();
    const qtyInput = page.getByPlaceholder('Qty').first();
    const unitPriceInput = page.getByPlaceholder('Unit price').first();

    await itemNameInput.fill('Excavation Work');
    await qtyInput.fill('2');
    await unitPriceInput.fill('5000');

    // Total should display formatted $10,000.00
    await expect(page.locator('#create-quotation-panel')).toContainText('$10,000.00');

    // Add a second line item
    await page.getByRole('button', { name: 'Add item to quotation' }).click();

    const secondItemName = page.getByPlaceholder('Item name').nth(1);
    const secondQty = page.getByPlaceholder('Qty').nth(1);
    const secondPrice = page.getByPlaceholder('Unit price').nth(1);

    await secondItemName.fill('Reinforced Concrete');
    await secondQty.fill('3');
    await secondPrice.fill('2500');

    // New total: 10,000 + 7,500 = $17,500.00
    await expect(page.locator('#create-quotation-panel')).toContainText('$17,500.00');

    // Remove first line item
    await page.getByRole('button', { name: 'Remove item 1' }).click();

    // Total after removal: $7,500.00
    await expect(page.locator('#create-quotation-panel')).toContainText('$7,500.00');
  });

  test('successfully submits quotation and displays feedback banner', async ({ page }) => {
    // Mock POST /quotations response
    await page.route('**/quotations', async (route) => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'quo-mock-002',
            leadId: payload.leadId,
            quotationDate: '2026-10-11',
            status: 'PENDING_APPROVAL',
            totalAmount: 15000,
            notes: payload.notes || null,
            pdfUrl: null,
            projectId: null,
            items: [
              {
                id: 'item-new',
                itemName: payload.items[0].itemName,
                quantity: payload.items[0].quantity,
                unitPrice: payload.items[0].unitPrice,
                amount: payload.items[0].quantity * payload.items[0].unitPrice,
              },
            ],
          }),
        });
      }
    });

    // Fill form
    await page.getByRole('button', { name: /select a lead/i }).click();
    await page.getByRole('option', { name: /skyline heights/i }).click();

    await page.getByPlaceholder('Item name').first().fill('Landscaping');
    await page.getByPlaceholder('Qty').first().fill('1');
    await page.getByPlaceholder('Unit price').first().fill('15000');
    await page.locator('#create-quotation-notes').fill('Urgent quote for garden space');

    await page.getByRole('button', { name: 'Generate Quotation' }).click();

    // Assert success notification
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      /quotation created successfully/i
    );
  });

  test('displays appropriate error banner on API 409 transition conflict', async ({ page }) => {
    await page.route('**/quotations/quo-mock-001/approve', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 409,
          code: 'INVALID_STATUS_TRANSITION',
          message: 'This quotation cannot transition to the requested status.',
        }),
      });
    });

    // Trigger approve button on existing card
    await page.getByRole('button', { name: 'Approve Quotation' }).first().click();

    // Verify error banner
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      'This quotation cannot transition to the requested status.'
    );
  });
});
```

---

## 7. Backend API Contract Tests (`integration/quotations/quotations-api.spec.ts`)

These tests call backend endpoints directly using Playwright's `request` fixture:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Quotations Backend API Contract Tests', () => {
  let token: string;
  let testQuotationId: string;

  test.beforeAll(async ({ request }) => {
    const authRes = await request.post('/auth/login', {
      data: { email: 'sales.manager@constructpro.com', password: 'Password123!' },
    });
    const authData = await authRes.json();
    token = authData.token || authData.accessToken;
  });

  test('POST /quotations creates quotation with accurate line item total', async ({ request }) => {
    const response = await request.post('/quotations', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        leadId: 'lead-test-001',
        notes: 'API integration test note',
        items: [
          { itemName: 'Concrete Foundation', quantity: 3, unitPrice: 1250.5 },
          { itemName: 'Steel Rebar', quantity: 10, unitPrice: 350 },
        ],
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    testQuotationId = body.id;

    expect(body).toHaveProperty('id');
    expect(body.status).toBe('PENDING_APPROVAL');
    // 3 * 1250.50 = 3751.50; 10 * 350 = 3500; Total = 7251.50
    expect(body.totalAmount).toBe(7251.5);
  });

  test('GET /quotations retrieves filtered list by status', async ({ request }) => {
    const response = await request.get('/quotations?status=PENDING_APPROVAL&limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBeTruthy();
    expect(body.items.every((q: { status: string }) => q.status === 'PENDING_APPROVAL')).toBeTruthy();
  });

  test('PATCH /quotations/:id/reject rejects quotation when reason is supplied', async ({ request }) => {
    const response = await request.patch(`/quotations/${testQuotationId}/reject`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { reason: 'Client requested revised scope of work' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('REJECTED');
  });

  test('PATCH /quotations/:id/revise moves rejected quotation back to DRAFT', async ({ request }) => {
    const response = await request.patch(`/quotations/${testQuotationId}/revise`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('DRAFT');
  });
});
```

---

## 8. Full End-to-End (E2E) Test (`e2e/quotations/quotations-lifecycle.spec.ts`)

This runs against the live frontend + backend in a real browser session:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Quotation Complete Lifecycle E2E', () => {
  test('creates, filters, edits, approves, and views PDF for a quotation', async ({ page }) => {
    const uniqueNote = `E2E Quotation Test Run ${Date.now()}`;

    // 1. Navigate to Quotations section
    await page.goto('/dashboard/quotations');
    await expect(page.getByRole('heading', { name: 'Generate Quotation' })).toBeVisible();

    // 2. Select Lead from dropdown
    await page.getByRole('button', { name: /select a lead/i }).click();
    await page.getByRole('option').first().click();

    // 3. Fill Line Items
    await page.getByPlaceholder('Item name').first().fill('Initial Site Survey');
    await page.getByPlaceholder('Qty').first().fill('2');
    await page.getByPlaceholder('Unit price').first().fill('4500');

    // 4. Fill Notes
    await page.locator('#create-quotation-notes').fill(uniqueNote);

    // 5. Submit Form
    await page.getByRole('button', { name: 'Generate Quotation' }).click();

    // 6. Assert Success Notification
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      /quotation created successfully/i
    );

    // 7. Search for newly created quotation
    const searchInput = page.getByPlaceholder('Search quotations...');
    await searchInput.fill(uniqueNote);

    // Locate the specific article card
    const quotationCard = page.locator('article').filter({ hasText: uniqueNote }).first();
    await expect(quotationCard).toBeVisible();
    await expect(quotationCard.getByText('Pending Approval')).toBeVisible();

    // 8. Open Edit Modal and update quotation
    await quotationCard.getByRole('button', { name: /edit/i }).click();
    const editModal = page.getByRole('dialog', { name: /edit quotation/i });
    await expect(editModal).toBeVisible();

    // Update quantity in modal
    const editQtyInput = editModal.getByPlaceholder('Qty').first();
    await editQtyInput.fill('3');
    await editModal.getByRole('button', { name: /save changes/i }).click();

    await expect(editModal).toBeHidden();
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      /quotation updated successfully/i
    );

    // 9. Approve the quotation
    await quotationCard.getByRole('button', { name: /approve/i }).click();
    await expect(quotationCard.getByText('Approved')).toBeVisible();

    // 10. Trigger View / Download PDF
    const [downloadEvent] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      quotationCard.getByRole('button', { name: /pdf/i }).click(),
    ]);

    // If PDF opens in new tab or downloads, verify operation succeeded without error
    await expect(page.locator('[aria-live="polite"]')).not.toContainText(/failed/i);
  });

  test('rejection flow requires reason and supports revision', async ({ page }) => {
    await page.goto('/dashboard/quotations');

    // Switch to Pending Approval tab
    await page.getByRole('tab', { name: 'Pending Approval' }).click();

    const pendingCard = page.locator('article').filter({ hasText: 'Pending Approval' }).first();
    if (await pendingCard.isVisible()) {
      // Click Reject
      await pendingCard.getByRole('button', { name: /reject/i }).click();

      const rejectModal = page.getByRole('dialog', { name: /reject quotation/i });
      await expect(rejectModal).toBeVisible();

      // Submit without reason -> expect validation
      await rejectModal.getByRole('button', { name: /confirm rejection/i }).click();
      await expect(rejectModal.getByText(/reason is required/i)).toBeVisible();

      // Enter reason and confirm
      await rejectModal.getByPlaceholder(/enter reason for rejection/i).fill('Price exceeds initial client budget.');
      await rejectModal.getByRole('button', { name: /confirm rejection/i }).click();

      await expect(rejectModal).toBeHidden();
      await expect(page.locator('[aria-live="polite"]')).toContainText(/quotation rejected/i);
    }
  });
});
```

---

## 9. DOM Locator & Selector Quick Reference

Below is the mapping between the UI elements and recommended Playwright locators:

| UI Component | Element | Recommended Playwright Locator |
| :--- | :--- | :--- |
| **Form Panel** | Outer Container | `page.locator('#create-quotation-panel')` |
| **Lead Selector** | Trigger Button | `page.getByRole('button', { name: /select a lead/i })` |
| **Lead Selector** | Options | `page.getByRole('option')` |
| **Item Name** | Input | `page.getByPlaceholder('Item name')` (use `.nth(index)` or `.first()`) |
| **Quantity** | Input | `page.getByPlaceholder('Qty')` |
| **Unit Price** | Input | `page.getByPlaceholder('Unit price')` |
| **Add Line Item** | Button | `page.getByRole('button', { name: 'Add item to quotation' })` |
| **Remove Item** | Button | `page.getByRole('button', { name: /remove item \d+/i })` |
| **Notes** | Textarea | `page.locator('#create-quotation-notes')` |
| **Submit Form** | Button | `page.getByRole('button', { name: 'Generate Quotation' })` |
| **Notification** | Toast / Banner | `page.locator('[aria-live="polite"]')` |
| **Search Input** | Input | `page.getByPlaceholder('Search quotations...')` |
| **Filter Tabs** | Tab | `page.getByRole('tab', { name: 'Draft' })` (or 'Approved', 'Rejected') |
| **Quotation Card**| Card Container | `page.locator('article')` |
| **Edit Button** | Card Action | `quotationCard.getByRole('button', { name: /edit/i })` |
| **Approve Button**| Card Action | `quotationCard.getByRole('button', { name: /approve/i })` |
| **Reject Button** | Card Action | `quotationCard.getByRole('button', { name: /reject/i })` |
| **PDF Button** | Card Action | `quotationCard.getByRole('button', { name: /pdf/i })` |
| **Revise Button** | Card Action | `quotationCard.getByRole('button', { name: /revise/i })` |

---

## 10. Running & Debugging the Tests

Add these scripts to your `tests/package.json`:

```json
{
  "scripts": {
    "test:integration": "playwright test --project=integration",
    "test:e2e": "playwright test --project=e2e",
    "test:all": "playwright test",
    "test:ui": "playwright test --ui",
    "test:debug": "playwright test --debug",
    "test:report": "playwright show-report"
  }
}
```

### Useful CLI Commands

- **Run only Integration Tests**:
  ```bash
  npx playwright test --project=integration
  ```
- **Run in Interactive UI Mode** (Visual timeline, inspect DOM, network logs):
  ```bash
  npx playwright test --ui
  ```
- **Debug a specific test file**:
  ```bash
  npx playwright test e2e/quotations/quotations-lifecycle.spec.ts --debug
  ```
- **Inspect element selectors with Playwright Inspector**:
  ```bash
  npx playwright codegen http://localhost:3000/dashboard/quotations
  ```
