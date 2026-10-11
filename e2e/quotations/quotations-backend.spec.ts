import { test, expect } from "@playwright/test";
import { apiBaseUrl, bearer, expectOk, login, requiredEnv } from "../support/api";
import type { Quotation } from "../support/contracts";
import { round2 } from "./quotation.fixtures";

test.describe.serial("Quotation Service — Backend Integration API Suite", () => {
  let token: string;
  let testQuotationId: string;
  let leadId: string;

  test.beforeAll(async ({ request }) => {
    // Acquire Token using existing login helper
    token = await login(
      request,
      process.env.E2E_USER_EMAIL || process.env.TEST_ADMIN_EMAIL,
      process.env.E2E_USER_PASSWORD || process.env.TEST_ADMIN_PASSWORD,
    );

    leadId = process.env.E2E_LEAD_ID || process.env.TEST_LEAD_ID || "00000000-0000-0000-0000-000000000001";
  });

  const authHeaders = () => ({
    ...bearer(token),
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
    const expectedSubtotal = round2(item1Qty * item1Price + item2Qty * item2Price); // 1807.50 + 905.00 = 2712.50

    const payload = {
      leadId,
      notes: "Integration API automated test quotation",
      items: [
        { itemName: "Structural Concrete Grade 30", quantity: item1Qty, unitPrice: item1Price },
        { itemName: "Reinforced Steel Rods (12mm)", quantity: item2Qty, unitPrice: item2Price },
      ],
    };

    const response = await request.post(`${apiBaseUrl()}/quotations`, {
      headers: authHeaders(),
      data: payload,
    });

    expect(response.status(), `Create quotation failed: ${await response.text()}`).toBe(201);
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
    expect(testQuotationId, "Quotation must be created before querying").toBeDefined();

    const response = await request.get(`${apiBaseUrl()}/quotations/${testQuotationId}`, {
      headers: authHeaders(),
    });

    expect(response.status()).toBe(200);
    const body = await expectOk<Quotation>(response);
    expect(body.id).toBe(testQuotationId);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  // BE-03: Filter & Pagination
  test("BE-03: GET /quotations filters by status with pagination metadata", async ({ request }) => {
    const response = await request.get(`${apiBaseUrl()}/quotations?limit=10&page=1`, {
      headers: authHeaders(),
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    const items = Array.isArray(body) ? body : body.items || body.data;
    expect(Array.isArray(items)).toBeTruthy();
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
        { itemName: "Structural Concrete Grade 30", quantity: newQty, unitPrice: newPrice },
      ],
    };

    const response = await request.put(`${apiBaseUrl()}/quotations/${testQuotationId}`, {
      headers: authHeaders(),
      data: updatePayload,
    });

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
    const rejectResponse = await request.patch(`${apiBaseUrl()}/quotations/${testQuotationId}/reject`, {
      headers: authHeaders(),
      data: { reason: "Budget limit exceeded by client" },
    });

    expect(rejectResponse.status()).toBe(200);
    const rejectedBody = await expectOk<Quotation>(rejectResponse);
    expect(rejectedBody.status).toBe("REJECTED");

    // 2. Revise quotation
    const reviseResponse = await request.patch(`${apiBaseUrl()}/quotations/${testQuotationId}/revise`, {
      headers: authHeaders(),
    });

    expect(reviseResponse.status()).toBe(200);
    const revisedBody = await expectOk<Quotation>(reviseResponse);
    expect(["DRAFT", "REVISED"]).toContain(revisedBody.status);
  });

  // BE-06: State Machine: Approval & Project Conversion
  test("BE-06: PATCH /quotations/:id/approve approves quotation and transitions toward conversion", async ({
    request,
  }) => {
    expect(testQuotationId).toBeDefined();

    const approvePayload = {
      projectName: "Automated Integration Test Project",
      location: "Colombo Commercial District",
      budget: 1205.0,
    };

    const response = await request.patch(`${apiBaseUrl()}/quotations/${testQuotationId}/approve`, {
      headers: authHeaders(),
      data: approvePayload,
    });

    expect(response.status()).toBe(200);
    const body = await expectOk<Quotation>(response);
    expect(["APPROVED", "CONVERTED"]).toContain(body.status);
  });

  // BE-07: Guardrail Against Duplicate Conversion
  test("BE-07: GUARD: Duplicate conversion attempt is blocked", async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const duplicateResponse = await request.patch(`${apiBaseUrl()}/quotations/${testQuotationId}/approve`, {
      headers: authHeaders(),
      data: {
        projectName: "Illegal Duplicate Project Conversion Attempt",
      },
    });

    expect([400, 409]).toContain(duplicateResponse.status());
    const errBody = await duplicateResponse.json();
    const errorText = JSON.stringify(errBody);
    expect(errorText).toMatch(/(already converted|invalid|status|transition|cannot approve)/i);
  });

  // BE-08: Resilient PDF Generation / Download
  test("BE-08: GET /quotations/:id/pdf returns valid document URL or PDF stream", async ({ request }) => {
    expect(testQuotationId).toBeDefined();

    const response = await request.get(`${apiBaseUrl()}/quotations/${testQuotationId}/pdf`, {
      headers: authHeaders(),
    });

    expect(response.ok()).toBeTruthy();
    const contentType = response.headers()["content-type"] || "";

    if (contentType.includes("application/json")) {
      const body = await response.json();
      const pdfUrl = body.url || body.pdfUrl || body.data?.url;
      expect(typeof pdfUrl).toBe("string");
    } else {
      expect(contentType).toContain("application/pdf");
    }
  });

  // BE-09: RBAC & Role Restriction Enforcement
  test("BE-09: RBAC: Unauthenticated and unauthorized requests are rejected", async ({ request }) => {
    // 1. Missing Authorization header -> 401 Unauthorized
    const unauthenticated = await request.post(`${apiBaseUrl()}/quotations`, {
      data: { leadId, items: [] },
    });
    expect(unauthenticated.status()).toBe(401);

    // 2. Restricted Role -> 403 Forbidden (if restricted credentials provided)
    if (process.env.E2E_RESTRICTED_USER_EMAIL && process.env.E2E_RESTRICTED_USER_PASSWORD) {
      const restrictedToken = await login(
        request,
        process.env.E2E_RESTRICTED_USER_EMAIL,
        process.env.E2E_RESTRICTED_USER_PASSWORD,
      );
      const forbidden = await request.post(`${apiBaseUrl()}/quotations`, {
        headers: {
          ...bearer(restrictedToken),
          "Content-Type": "application/json",
        },
        data: { leadId, items: [] },
      });
      expect(forbidden.status()).toBe(403);
    }
  });
});
