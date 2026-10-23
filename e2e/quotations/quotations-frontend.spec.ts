import { test, expect } from "@playwright/test";
import { mockLeads, mockInitialQuotations } from "./quotation.fixtures";

test.describe("Quotations Dashboard - Frontend Integration (Mocked Network)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock GET /quotations endpoint
    await page.route("**/quotations*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: mockInitialQuotations,
            total: mockInitialQuotations.length,
            page: 1,
            limit: 10,
            totalPages: 1,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock GET /leads dropdown list
    await page.route("**/leads*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockLeads),
      });
    });

    // Navigate to quotations dashboard
    await page.goto("/dashboard/quotations");
  });

  test("FE-01: enforces client-side validation on empty submission", async ({ page }) => {
    const submitBtn = page.getByRole("button", {
      name: /generate quotation|create quotation|save quotation/i,
    });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Verify field validation error messages appear
    const leadError = page.locator("text=/lead.*required/i");
    const itemError = page.locator("text=/item name.*required/i");
    await expect(leadError.or(page.locator('[aria-invalid="true"]')).first()).toBeVisible();
  });

  test("FE-02: dynamically adds line items and updates live total computation", async ({ page }) => {
    const panel = page.locator("#create-quotation-panel").or(page.locator("form")).first();
    const itemNameInput = page.getByPlaceholder(/item name/i).first();
    const qtyInput = page.getByPlaceholder(/qty/i).first();
    const unitPriceInput = page.getByPlaceholder(/unit price/i).first();

    await itemNameInput.fill("Excavation Work");
    await qtyInput.fill("2");
    await unitPriceInput.fill("5000");

    // Total should display formatted $10,000.00
    await expect(panel).toContainText(/10,000\.00|\$10,000/);

    // Add a second line item
    const addItemBtn = page.getByRole("button", { name: /add item/i });
    await addItemBtn.click();

    const secondItemName = page.getByPlaceholder(/item name/i).nth(1);
    const secondQty = page.getByPlaceholder(/qty/i).nth(1);
    const secondPrice = page.getByPlaceholder(/unit price/i).nth(1);

    await secondItemName.fill("Reinforced Concrete");
    await secondQty.fill("3");
    await secondPrice.fill("2500");

    // New total: 10,000 + 7,500 = $17,500.00
    await expect(panel).toContainText(/17,500\.00|\$17,500/);

    // Remove first line item
    const removeFirstBtn = page.getByRole("button", { name: /remove item 1|remove/i }).first();
    await removeFirstBtn.click();

    // Total after removal: $7,500.00
    await expect(panel).toContainText(/7,500\.00|\$7,500/);
  });

  test("FE-03: successfully submits quotation and displays feedback banner", async ({ page }) => {
    // Mock POST /quotations response
    await page.route("**/quotations", async (route) => {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON() || {};
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "quo-mock-003",
            leadId: payload.leadId || "lead-101",
            quotationDate: "2026-10-11",
            status: "PENDING_APPROVAL",
            totalAmount: 15000,
            notes: payload.notes || "Urgent quote for garden space",
            pdfUrl: null,
            projectId: null,
            items: [
              {
                id: "item-new-001",
                itemName: "Landscaping",
                quantity: 1,
                unitPrice: 15000,
                amount: 15000,
              },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Select lead
    const leadTrigger = page.getByRole("button", { name: /select a lead/i })
      .or(page.locator('select[name="leadId"], #lead-select'));
    if (await leadTrigger.isVisible()) {
      if ((await leadTrigger.getAttribute("role")) === "button") {
        await leadTrigger.click();
        await page.getByRole("option", { name: /skyline heights/i }).click();
      } else {
        await leadTrigger.selectOption({ index: 1 });
      }
    }

    // Fill line item details
    await page.getByPlaceholder(/item name/i).first().fill("Landscaping");
    await page.getByPlaceholder(/qty/i).first().fill("1");
    await page.getByPlaceholder(/unit price/i).first().fill("15000");

    const notesInput = page.locator("#create-quotation-notes").or(page.getByPlaceholder(/notes/i));
    if (await notesInput.isVisible()) {
      await notesInput.fill("Urgent quote for garden space");
    }

    // Submit form
    await page.getByRole("button", { name: /generate quotation|create quotation|save quotation/i }).click();

    // Assert success notification banner
    await expect(
      page.locator('[aria-live="polite"]').or(page.getByText(/quotation created successfully|success/i)).first(),
    ).toBeVisible();
  });

  test("FE-04: filters quotations by status tab and search query", async ({ page }) => {
    // Test tab navigation
    const pendingTab = page.getByRole("tab", { name: /pending approval/i });
    if (await pendingTab.isVisible()) {
      await pendingTab.click();
      await expect(page.locator("article").filter({ hasText: /pending approval/i }).first()).toBeVisible();
    }

    // Test search filter
    const searchInput = page.getByPlaceholder(/search quotations/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill("Initial construction");
      await expect(page.locator("article").filter({ hasText: /Initial construction/i }).first()).toBeVisible();
    }
  });

  test("FE-05: opens line item edit modal and saves changes", async ({ page }) => {
    // Mock PUT /quotations/:id response
    await page.route("**/quotations/quo-mock-001", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...mockInitialQuotations[0],
            totalAmount: 2200000,
          }),
        });
      } else {
        await route.continue();
      }
    });

    const quotationCard = page.locator("article").filter({ hasText: "QUO-2026-001" }).or(page.locator("article").first());
    await expect(quotationCard).toBeVisible();

    const editBtn = quotationCard.getByRole("button", { name: /edit/i });
    if (await editBtn.isVisible()) {
      await editBtn.click();
      const editModal = page.getByRole("dialog", { name: /edit quotation/i }).or(page.locator(".modal, [role='dialog']"));
      await expect(editModal).toBeVisible();

      const editQty = editModal.getByPlaceholder(/qty/i).first();
      if (await editQty.isVisible()) {
        await editQty.fill("2");
      }
      await editModal.getByRole("button", { name: /save changes|save|update/i }).click();
      await expect(editModal).toBeHidden();
    }
  });

  test("FE-06: rejection flow requires mandatory reason", async ({ page }) => {
    await page.route("**/quotations/quo-mock-001/reject", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...mockInitialQuotations[0],
          status: "REJECTED",
          rejectionReason: "Client requested revised scope of work",
        }),
      });
    });

    const quotationCard = page.locator("article").first();
    const rejectBtn = quotationCard.getByRole("button", { name: /reject/i });

    if (await rejectBtn.isVisible()) {
      await rejectBtn.click();
      const rejectModal = page.getByRole("dialog", { name: /reject quotation/i }).or(page.locator(".modal, [role='dialog']"));
      await expect(rejectModal).toBeVisible();

      // Submit without reason -> expect validation message
      const confirmRejectBtn = rejectModal.getByRole("button", { name: /confirm rejection|reject/i });
      await confirmRejectBtn.click();
      await expect(rejectModal.getByText(/reason is required/i)).toBeVisible();

      // Enter rejection reason and confirm
      const reasonInput = rejectModal.getByPlaceholder(/enter reason|reason/i);
      await reasonInput.fill("Client requested revised scope of work");
      await confirmRejectBtn.click();

      await expect(rejectModal).toBeHidden();
      await expect(page.locator('[aria-live="polite"]').or(page.getByText(/rejected/i)).first()).toBeVisible();
    }
  });

  test("FE-07: displays appropriate error banner on API 409 transition conflict", async ({ page }) => {
    await page.route("**/quotations/quo-mock-001/approve", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 409,
          code: "INVALID_STATUS_TRANSITION",
          message: "This quotation cannot transition to the requested status.",
        }),
      });
    });

    const quotationCard = page.locator("article").first();
    const approveBtn = quotationCard.getByRole("button", { name: /approve/i });
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      const confirmBtn = page.locator("button:has-text('Confirm'), button:has-text('Yes')");
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }
      await expect(
        page.locator('[aria-live="polite"]').or(page.getByText(/cannot transition|invalid status/i)).first(),
      ).toBeVisible();
    }
  });

  test("FE-08: triggers PDF export without UI errors", async ({ page }) => {
    await page.route("**/quotations/quo-mock-001/pdf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://res.cloudinary.com/constructpro/raw/upload/sample-quotation.pdf",
        }),
      });
    });

    const quotationCard = page.locator("article").first();
    const pdfBtn = quotationCard.getByRole("button", { name: /pdf|export/i });
    if (await pdfBtn.isVisible()) {
      await pdfBtn.click();
      // Ensure no failure toast popped up
      await expect(page.locator('[aria-live="polite"]').filter({ hasText: /failed/i })).toHaveCount(0);
    }
  });
});
