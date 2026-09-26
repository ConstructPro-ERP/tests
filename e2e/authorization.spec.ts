import { expect, test } from "@playwright/test";
import { apiBaseUrl, bearer, login, requiredEnv } from "./support/api";

test.describe("Finance and AI role restrictions", () => {
  test("anonymous requests cannot access finance or AI workflows", async ({ request }) => {
    const invoiceId = requiredEnv("E2E_INVOICE_ID");
    const projectId = requiredEnv("E2E_PROJECT_ID");

    const finance = await request.get(`${apiBaseUrl()}/invoices/${invoiceId}`);
    const ai = await request.get(`${apiBaseUrl()}/ai-forecasting/projects/${projectId}/risk`);

    expect(finance.status()).toBe(401);
    expect(ai.status()).toBe(401);
  });

  test("a configured non-finance role receives 403", async ({ request }) => {
    test.skip(
      !process.env.E2E_RESTRICTED_USER_EMAIL || !process.env.E2E_RESTRICTED_USER_PASSWORD,
      "Set restricted-user credentials to verify role-based 403 responses.",
    );
    const token = await login(
      request,
      process.env.E2E_RESTRICTED_USER_EMAIL!,
      process.env.E2E_RESTRICTED_USER_PASSWORD!,
    );
    const headers = bearer(token);
    const invoiceId = requiredEnv("E2E_INVOICE_ID");
    const projectId = requiredEnv("E2E_PROJECT_ID");

    const finance = await request.get(`${apiBaseUrl()}/invoices/${invoiceId}`, { headers });
    const ai = await request.get(`${apiBaseUrl()}/ai-forecasting/projects/${projectId}/risk`, { headers });

    expect(finance.status()).toBe(403);
    expect(ai.status()).toBe(403);
  });
});
