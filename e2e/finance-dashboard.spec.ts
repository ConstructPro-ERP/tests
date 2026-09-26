import { expect, test } from "@playwright/test";
import { apiBaseUrl, bearer, expectOk, login, requiredEnv } from "./support/api";
import type { DashboardSummary, Invoice, PaymentResult } from "./support/contracts";

test.describe.serial("Finance to dashboard workflow", () => {
  test("recording a payment keeps invoice balances and dashboard KPIs consistent", async ({
    request,
  }) => {
    const token = await login(request);
    const headers = bearer(token);
    const invoiceId = requiredEnv("E2E_INVOICE_ID");

    const beforeInvoice = await expectOk<Invoice>(
      await request.get(`${apiBaseUrl()}/invoices/${invoiceId}`, { headers }),
    );
    const beforeDashboard = await expectOk<DashboardSummary>(
      await request.get(`${apiBaseUrl()}/analytics/dashboard/summary`, { headers }),
    );

    expect(["ISSUED", "OVERDUE", "PARTIALLY_PAID"]).toContain(beforeInvoice.status);
    const configuredAmount = Number(process.env.E2E_PAYMENT_AMOUNT ?? "1");
    expect(configuredAmount).toBeGreaterThan(0);
    expect(beforeInvoice.outstandingAmount).toBeGreaterThanOrEqual(configuredAmount);

    const referenceNumber = `E2E-${Date.now()}`;
    const paymentResult = await expectOk<PaymentResult>(
      await request.post(`${apiBaseUrl()}/payments`, {
        headers,
        data: {
          invoiceId,
          referenceNumber,
          paymentDate: new Date().toISOString(),
          amount: configuredAmount,
          paymentMethod: "BANK_TRANSFER",
          notes: "Automated integration verification",
        },
      }),
    );

    expect(paymentResult.payment).toMatchObject({
      invoiceId,
      referenceNumber,
      amount: configuredAmount,
    });
    expect(paymentResult.invoice.paidAmount).toBeCloseTo(
      beforeInvoice.paidAmount + configuredAmount,
      2,
    );
    expect(paymentResult.invoice.outstandingAmount).toBeCloseTo(
      beforeInvoice.outstandingAmount - configuredAmount,
      2,
    );
    expect(paymentResult.invoice.status).toBe(
      paymentResult.invoice.outstandingAmount === 0 ? "PAID" : "PARTIALLY_PAID",
    );

    const persistedInvoice = await expectOk<Invoice>(
      await request.get(`${apiBaseUrl()}/invoices/${invoiceId}`, { headers }),
    );
    expect(persistedInvoice).toMatchObject(paymentResult.invoice);

    await expect
      .poll(
        async () => {
          const current = await expectOk<DashboardSummary>(
            await request.get(`${apiBaseUrl()}/analytics/dashboard/summary`, { headers }),
          );
          return {
            paidAmount: current.revenue.paidAmount,
            outstandingBalance: current.revenue.outstandingBalance,
          };
        },
        { message: "dashboard KPIs did not reflect the recorded payment", timeout: 20_000 },
      )
      .toEqual({
        paidAmount: beforeDashboard.revenue.paidAmount + configuredAmount,
        outstandingBalance:
          beforeDashboard.revenue.outstandingBalance - configuredAmount,
      });
  });

  test("the updated invoice is visible on the frontend finance page", async ({ page }) => {
    const invoiceId = requiredEnv("E2E_INVOICE_ID");
    await page.goto("/login");
    await page.getByLabel("Email").fill(requiredEnv("E2E_USER_EMAIL"));
    await page.getByLabel("Password").fill(requiredEnv("E2E_USER_PASSWORD"));
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/modules/);

    const invoiceResponse = await page.request.get(`${apiBaseUrl()}/invoices/${invoiceId}`, {
      headers: bearer(await login(page.request)),
    });
    const invoice = await expectOk<Invoice>(invoiceResponse);

    await page.goto("/dashboard/finance");
    await expect(page.getByText(invoice.invoiceNumber ?? "Draft invoice", { exact: true }).first()).toBeVisible();
  });
});
