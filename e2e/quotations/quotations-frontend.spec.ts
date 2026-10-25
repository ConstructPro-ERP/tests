import { test, expect, type Route } from "@playwright/test";
import { apiBaseUrl } from "../support/api";
import { mockLeads, mockInitialQuotations } from "./quotation.fixtures";

const apiOrigin = new URL(apiBaseUrl()).origin;
const quotationsPath = new URL(`${apiBaseUrl()}/quotations`).pathname;
const leadsPath = new URL(`${apiBaseUrl()}/leads`).pathname;

function matches(url: URL, pathname: string): boolean {
  return url.origin === apiOrigin && url.pathname === pathname;
}

async function fulfillJson(
  route: Route,
  data: unknown,
  status = 200,
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  },
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": new URL(process.env.FRONTEND_BASE_URL!)
        .origin,
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify({
      success: status < 400,
      data,
      ...(meta ? { meta } : {}),
    }),
  });
}

test.describe("Quotations Dashboard — Frontend Integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(
      (url) => matches(url, quotationsPath),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }

        const requestUrl = new URL(route.request().url());
        const status = requestUrl.searchParams.get("status");
        const search = (
          requestUrl.searchParams.get("search") ?? ""
        ).toLowerCase();

        const items = mockInitialQuotations.filter((quotation) => {
          const statusMatches = !status || quotation.status === status;

          const searchMatches =
            !search ||
            `${quotation.lead?.customerName ?? ""} ${quotation.notes ?? ""}`
              .toLowerCase()
              .includes(search);

          return statusMatches && searchMatches;
        });

        const pageNumber = Number(requestUrl.searchParams.get("page") ?? "1");
        const pageSize = Number(requestUrl.searchParams.get("limit") ?? "10");

        const pageItems = items.slice(
          (pageNumber - 1) * pageSize,
          pageNumber * pageSize,
        );

        await fulfillJson(route, pageItems, 200, {
          total: items.length,
          page: pageNumber,
          limit: pageSize,
          totalPages: Math.ceil(items.length / pageSize),
        });
      },
    );

    await page.route(
      (url) =>
        url.origin === apiOrigin &&
        (url.pathname === leadsPath ||
          url.pathname.startsWith(`${leadsPath}/`)),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }

        const pathname = new URL(route.request().url()).pathname;

        if (pathname === leadsPath) {
          await fulfillJson(route, {
            data: mockLeads,
            meta: {
              total: mockLeads.length,
              page: 1,
              limit: 100,
              totalPages: 1,
            },
          });
          return;
        }

        const leadId = decodeURIComponent(
          pathname.slice(`${leadsPath}/`.length),
        );

        const lead = mockLeads.find((record) => record.id === leadId);

        await fulfillJson(route, lead ?? null, lead ? 200 : 404);
      },
    );

    await page.goto("/dashboard/quotations");

    await expect(page.locator("#create-quotation-panel")).toBeVisible();
  });

  test("FE-01: validates an empty quotation", async ({ page }) => {
    await page.getByRole("button", { name: "Generate Quotation" }).click();

    await expect(page.getByText("Lead ID is required.")).toBeVisible();

    await expect(page.locator("#quotation-items-error")).toBeVisible();

    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "Please correct the highlighted quotation form errors.",
    );
  });

  test("FE-02: updates totals when items are added and removed", async ({
    page,
  }) => {
    const panel = page.locator("#create-quotation-panel");

    await page.getByLabel("Item 1 name").fill("Excavation Work");
    await page.getByLabel("Item 1 quantity").fill("2");
    await page.getByLabel("Item 1 unit price").fill("5000");

    await expect(panel).toContainText(/10,000\.00/);

    await page.getByRole("button", { name: "Add item to quotation" }).click();

    await page.getByLabel("Item 2 name").fill("Reinforced Concrete");
    await page.getByLabel("Item 2 quantity").fill("3");
    await page.getByLabel("Item 2 unit price").fill("2500");

    await expect(panel).toContainText(/17,500\.00/);

    await page.getByRole("button", { name: "Remove item 1" }).click();

    await expect(panel).toContainText(/7,500\.00/);

    await expect(page.getByLabel("Item 2 name")).toHaveCount(0);
  });

  test("FE-03: creates a quotation", async ({ page }) => {
    const created = {
      ...mockInitialQuotations[0],
      id: "quo-mock-003",
      quotationNumber: "QUO-2026-003",
      leadId: "lead-101",
      status: "PENDING_APPROVAL" as const,
      notes: "Urgent quote for garden space",
      totalAmount: 15000,
      items: [
        {
          id: "item-new-001",
          quotationId: "quo-mock-003",
          itemName: "Landscaping",
          quantity: 1,
          unitPrice: 15000,
          amount: 15000,
        },
      ],
    };

    await page.route(
      (url) => matches(url, quotationsPath),
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        await fulfillJson(route, created, 201);
      },
    );

    await page.route(
      (url) => matches(url, `${quotationsPath}/quo-mock-003`),
      async (route) => {
        await fulfillJson(route, created);
      },
    );

    await page
      .getByRole("button", {
        name: /Choose a lead for this quotation/i,
      })
      .click();

    await page.getByRole("button", { name: /Skyline Heights/i }).click();

    await page.getByLabel("Item 1 name").fill("Landscaping");
    await page.getByLabel("Item 1 quantity").fill("1");
    await page.getByLabel("Item 1 unit price").fill("15000");

    await page
      .getByLabel("Optional notes for this quotation")
      .fill("Urgent quote for garden space");

    const postRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        matches(new URL(request.url()), quotationsPath),
    );

    await page.getByRole("button", { name: "Generate Quotation" }).click();

    const payload = (await postRequest).postDataJSON();

    expect(payload).toMatchObject({
      leadId: "lead-101",
      items: [
        {
          itemName: "Landscaping",
          quantity: 1,
          unitPrice: 15000,
        },
      ],
    });

    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "Quotation generated successfully",
    );
  });

  test("FE-04: filters quotations by status and search", async ({ page }) => {
    const pendingCard = page
      .locator("article")
      .filter({ hasText: "quo-mock-001" });

    await expect(pendingCard).toBeVisible();

    await page.getByRole("button", { name: "Pending Approval" }).click();

    await expect(pendingCard).toBeVisible();

    await expect(
      page.locator("article").filter({
        hasText: "quo-mock-002",
      }),
    ).toHaveCount(0);

    await page
      .getByRole("textbox", { name: "Search quotations" })
      .fill("Initial construction");

    await expect(pendingCard).toBeVisible();
  });

  test("FE-05: edits quotation line items", async ({ page }) => {
    await page.route(
      (url) => matches(url, `${quotationsPath}/quo-mock-001`),
      async (route) => {
        if (route.request().method() !== "PUT") {
          await route.fallback();
          return;
        }

        const updated = {
          ...mockInitialQuotations[0],
          totalAmount: 2200000,
          items: [
            {
              ...mockInitialQuotations[0].items[0],
              quantity: 2,
              amount: 700000,
            },
            mockInitialQuotations[0].items[1],
          ],
        };

        await fulfillJson(route, updated);
      },
    );

    const card = page.locator("article").filter({ hasText: "quo-mock-001" });

    await expect(card).toBeVisible();

    await card
      .getByRole("button", {
        name: "Edit quotation quo-mock-001",
      })
      .click();

    const modal = page.getByRole("dialog", {
      name: "Edit Quotation",
    });

    await expect(modal).toBeVisible();

    await modal.getByRole("spinbutton", { name: "Item 1 quantity" }).fill("2");

    const updateRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        matches(new URL(request.url()), `${quotationsPath}/quo-mock-001`),
    );

    await modal.getByRole("button", { name: "Save Quotation" }).click();

    const payload = (await updateRequest).postDataJSON();

    expect(payload.items[0].quantity).toBe(2);

    await expect(modal).not.toBeVisible();

    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "updated successfully",
    );
  });

  test("FE-06: requires a rejection reason", async ({ page }) => {
    await page.route(
      (url) => matches(url, `${quotationsPath}/quo-mock-001/reject`),
      async (route) => {
        await fulfillJson(route, {
          ...mockInitialQuotations[0],
          status: "REJECTED",
        });
      },
    );

    const card = page.locator("article").filter({ hasText: "quo-mock-001" });

    await card
      .getByRole("button", {
        name: "Reject quotation quo-mock-001",
      })
      .click();

    const modal = page.getByRole("dialog", {
      name: "Reject Quotation",
    });

    const confirm = modal.getByRole("button", {
      name: "Reject Quotation",
    });

    await expect(confirm).toBeDisabled();

    await modal
      .locator("#rejection-reason-input")
      .fill("Client requested a revised scope.");

    await expect(confirm).toBeEnabled();

    await confirm.click();

    await expect(modal).not.toBeVisible();

    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "has been rejected",
    );
  });

  test("FE-07: shows a conflict error on approval", async ({ page }) => {
    await page.route(
      (url) => matches(url, `${quotationsPath}/quo-mock-001/direct-approve`),
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": new URL(
              process.env.FRONTEND_BASE_URL!,
            ).origin,
            "Access-Control-Allow-Credentials": "true",
          },
          body: JSON.stringify({
            success: false,
            code: "INVALID_STATUS_TRANSITION",
            message:
              "This quotation cannot transition to the requested status.",
          }),
        });
      },
    );

    const card = page.locator("article").filter({ hasText: "quo-mock-001" });

    await card
      .getByRole("button", {
        name: "Approve quotation quo-mock-001",
      })
      .click();

    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "This quotation cannot transition to the requested status.",
    );
  });

  test("FE-08: requests a quotation PDF", async ({ page }) => {
    const pdfPath = `${quotationsPath}/quo-mock-001/pdf`;

    await page.route(
      (url) => matches(url, pdfPath),
      async (route) => {
        await fulfillJson(route, {
          pdfUrl: "https://example.com/quotation.pdf",
        });
      },
    );

    const card = page.locator("article").filter({ hasText: "quo-mock-001" });

    const pdfResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        matches(new URL(response.url()), pdfPath),
    );

    await card
      .getByRole("button", {
        name: "Download or view PDF for quotation quo-mock-001",
      })
      .click();

    expect((await pdfResponse).status()).toBe(200);

    await expect(
      page
        .locator('[aria-live="polite"]')
        .filter({ hasText: /Failed to generate quotation PDF/i }),
    ).toHaveCount(0);
  });
});
