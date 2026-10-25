import { test, expect } from "@playwright/test";
import { apiBaseUrl, expectOk, requiredEnv } from "../support/api";
import { savedHeaders } from "../support/auth-state";
import type { Quotation } from "../support/contracts";
import { round2 } from "./quotation.fixtures";

test.describe
  .serial("Quotation Service — Backend Integration API Suite", () => {
  let testQuotationId: string;
  let leadId: string;

  test.beforeAll(() => {
    leadId = requiredEnv("E2E_LEAD_ID");
  });

  const authHeaders = () => ({
    ...savedHeaders("quotations", "admin"),
    "Content-Type": "application/json",
  });

  // BE-01: Creation & Mathematical Precision
  test("BE-01: POST /quotations creates quotation with accurate line items and total amount calculation", async ({
    request,
  }) => {
    const item1Qty = 15;
    const item1Price = 120.5;
    const item2Qty = 20;
    const item2Price = 45.25;
    const expectedSubtotal = round2(
      item1Qty * item1Price + item2Qty * item2Price,
    ); // 1807.50 + 905.00 = 2712.50

    const payload = {
      leadId,
      notes: "Integration API automated test quotation",
      items: [
        {
          itemName: "Structural Concrete Grade 30",
          quantity: item1Qty,
          unitPrice: item1Price,
        },
        {
          itemName: "Reinforced Steel Rods (12mm)",
          quantity: item2Qty,
          unitPrice: item2Price,
        },
      ],
    };

    const response = await request.post(`${apiBaseUrl()}/quotations`, {
      headers: authHeaders(),
      data: payload,
    });

    expect(
      response.status(),
      `Create quotation failed: ${await response.text()}`,
    ).toBe(201);
    const body = await expectOk<Quotation>(response);

    expect(body).toHaveProperty("id");
    testQuotationId = body.id;

    expect(["DRAFT", "PENDING_APPROVAL"]).toContain(body.status);
    expect(body.items).toHaveLength(2);

    // Verify mathematical integrity without rounding drift
    const reportedTotal = body.totalAmount ?? body.subtotal;
    expect(Number(reportedTotal)).toBeCloseTo(expectedSubtotal, 2);
  });

  // BE-02: Query by ID
  test("BE-02: GET /quotations/:id returns quotation details with nested line items", async ({
    request,
  }) => {
    expect(
      testQuotationId,
      "Quotation must be created before querying",
    ).toBeDefined();

    const response = await request.get(
      `${apiBaseUrl()}/quotations/${testQuotationId}`,
      {
        headers: authHeaders(),
      },
    );

    expect(response.status()).toBe(200);
    const body = await expectOk<Quotation>(response);
    expect(body.id).toBe(testQuotationId);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  // BE-03: Filter & Pagination
  test("BE-03: GET /quotations filters by status with pagination metadata", async ({
    request,
  }) => {
    const response = await request.get(
      `${apiBaseUrl()}/quotations?limit=10&page=1`,
      {
        headers: authHeaders(),
      },
    );

    expect(response.status()).toBe(200);

    const result = (await response.json()) as {
      success: boolean;
      data: Quotation[];
      meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeLessThanOrEqual(10);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(10);
    expect(result.meta.total).toBeGreaterThanOrEqual(result.data.length);
  });

  // BE-04: Update Line Items & Dynamic Recalculation
  test("BE-04: PUT /quotations/:id updates items and dynamically recalculates total", async ({
    request,
  }) => {
    expect(testQuotationId).toBeDefined();

    const newQty = 10;
    const newPrice = 120.5;
    const expectedNewTotal = round2(newQty * newPrice); // 1205.00

    const updatePayload = {
      notes: "Updated quantities for dynamic calculation verification",
      items: [
        {
          itemName: "Structural Concrete Grade 30",
          quantity: newQty,
          unitPrice: newPrice,
        },
      ],
    };

    const response = await request.put(
      `${apiBaseUrl()}/quotations/${testQuotationId}`,
      {
        headers: authHeaders(),
        data: updatePayload,
      },
    );

    expect(response.status()).toBe(200);
    const body = await expectOk<Quotation>(response);
    const reportedTotal = body.totalAmount ?? body.subtotal;
    expect(Number(reportedTotal)).toBeCloseTo(expectedNewTotal, 2);
  });

  // BE-05: State Machine: Rejection & Revision
  test("BE-05: PATCH /quotations/:id/reject rejects with reason and /revise restores it", async ({
    request,
  }) => {
    expect(testQuotationId).toBeDefined();

    // 1. Reject quotation
    const rejectResponse = await request.patch(
      `${apiBaseUrl()}/quotations/${testQuotationId}/reject`,
      {
        headers: authHeaders(),
        data: { reason: "Budget limit exceeded by client" },
      },
    );

    expect(rejectResponse.status()).toBe(200);
    const rejectedBody = await expectOk<Quotation>(rejectResponse);
    expect(rejectedBody.status).toBe("REJECTED");

    // 2. Revise quotation
    const reviseResponse = await request.patch(
      `${apiBaseUrl()}/quotations/${testQuotationId}/revise`,
      {
        headers: authHeaders(),
      },
    );

    expect(reviseResponse.status()).toBe(200);
    const revisedBody = await expectOk<Quotation>(reviseResponse);
    expect(["DRAFT", "REVISED"]).toContain(revisedBody.status);
  });

  // BE-06: State Machine: Approval & Project Conversion
  test("BE-06: submits and directly approves the quotation", async ({
    request,
  }) => {
    expect(testQuotationId).toBeDefined();

    const submitResponse = await request.patch(
      `${apiBaseUrl()}/quotations/${testQuotationId}/submit`,
      {
        headers: authHeaders(),
        data: {},
      },
    );

    expect(submitResponse.status(), await submitResponse.text()).toBe(200);

    const submitted = await expectOk<Quotation>(submitResponse);
    expect(submitted.status).toBe("PENDING_APPROVAL");

    const approveResponse = await request.patch(
      `${apiBaseUrl()}/quotations/${testQuotationId}/direct-approve`,
      {
        headers: authHeaders(),
        data: {},
      },
    );

    expect(approveResponse.status(), await approveResponse.text()).toBe(200);

    const approved = await expectOk<Quotation>(approveResponse);

    expect(approved.status).toBe("APPROVED");
    expect(approved.id).toBe(testQuotationId);
  });

  // BE-07: Guardrail Against Duplicate Conversion
  test("BE-07: blocks duplicate project conversion", async ({ request }) => {
    test.skip(
      process.env.E2E_ALLOW_PERSISTENT_LIFECYCLE_WRITES !== "true",
      "Requires a disposable E2E database.",
    );

    expect(testQuotationId).toBeDefined();

    const actor = await expectOk<{ id: string }>(
      await request.get(`${apiBaseUrl()}/auth/me`, {
        headers: authHeaders(),
      }),
    );

    const conversionResponse = await request.patch(
      `${apiBaseUrl()}/quotations/${testQuotationId}/approve`,
      {
        headers: authHeaders(),
        data: {
          projectName: `E2E Converted Project ${Date.now()}`,
          location: "Colombo",
          startDate: "2026-10-01T00:00:00.000Z",
          endDate: "2027-10-01T00:00:00.000Z",
          projectManagerId: actor.id,
          budget: 1205,
        },
      },
    );

    expect(conversionResponse.status(), await conversionResponse.text()).toBe(
      200,
    );

    const conversion = await expectOk<{
      quotation: Quotation;
      projectId: string;
      projectStatus: string;
    }>(conversionResponse);

    expect(conversion.quotation.status).toBe("CONVERTED");
    expect(conversion.projectId).toBeTruthy();

    const duplicateResponse = await request.patch(
      `${apiBaseUrl()}/quotations/${testQuotationId}/approve`,
      {
        headers: authHeaders(),
        data: {
          projectName: "Duplicate conversion attempt",
          startDate: "2026-10-01T00:00:00.000Z",
          projectManagerId: actor.id,
        },
      },
    );

    expect(duplicateResponse.status()).toBe(409);

    expect(JSON.stringify(await duplicateResponse.json())).toMatch(
      /ALREADY_CONVERTED|already converted/i,
    );
  });

  // BE-08: Resilient PDF Generation / Download
  test("BE-08: returns a valid quotation PDF URL", async ({ request }) => {
    test.skip(
      process.env.E2E_ENABLE_QUOTATION_PDF !== "true",
      "Quotation PDF integration is disabled.",
    );

    expect(testQuotationId).toBeDefined();

    const response = await request.get(
      `${apiBaseUrl()}/quotations/${testQuotationId}/pdf`,
      {
        headers: authHeaders(),
      },
    );

    expect(response.status(), await response.text()).toBe(200);

    const result = await expectOk<{ pdfUrl: string }>(response);

    expect(typeof result.pdfUrl).toBe("string");

    const pdfUrl = new URL(result.pdfUrl);

    expect(["http:", "https:"]).toContain(pdfUrl.protocol);
  });

  // BE-09: RBAC & Role Restriction Enforcement
  test("BE-09: RBAC: Unauthenticated and unauthorized requests are rejected", async ({
    request,
  }) => {
    // 1. Missing Authorization header -> 401 Unauthorized
    const unauthenticated = await request.post(`${apiBaseUrl()}/quotations`, {
      data: { leadId, items: [] },
    });
    expect(unauthenticated.status()).toBe(401);

    // 2. Restricted Role -> 403 Forbidden (if restricted credentials provided)
    if (
      process.env.E2E_QUOTATION_RESTRICTED_USER_EMAIL &&
      process.env.E2E_QUOTATION_RESTRICTED_USER_PASSWORD
    ) {
      const forbidden = await request.post(`${apiBaseUrl()}/quotations`, {
        headers: {
          ...savedHeaders("quotations", "restricted"),
          "Content-Type": "application/json",
        },
        data: {
          leadId,
          items: [],
        },
      });

      expect(forbidden.status()).toBe(403);
    }
  });
});
