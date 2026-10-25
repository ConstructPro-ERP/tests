import { test, expect } from "@playwright/test";
import { apiBaseUrl, bearer, login, requiredEnv } from "./support/api";

test.describe("User, lead and client authorization", () => {
  for (const resource of ["users", "leads", "clients"]) {
    test(`anonymous requests cannot list or create ${resource}`, async ({
      request,
    }) => {
      expect((await request.get(`${apiBaseUrl()}/${resource}`)).status()).toBe(
        401,
      );
      expect(
        (
          await request.post(`${apiBaseUrl()}/${resource}`, { data: {} })
        ).status(),
      ).toBe(401);
    });
  }

  test("an accountant cannot list users or leads, or create clients", async ({
    request,
  }) => {
    test.skip(
      !process.env.E2E_ACCOUNTANT_EMAIL || !process.env.E2E_ACCOUNTANT_PASSWORD,
      "Set E2E_ACCOUNTANT_EMAIL and E2E_ACCOUNTANT_PASSWORD for ACCOUNTANT role checks.",
    );
    const headers = bearer(
      await login(
        request,
        requiredEnv("E2E_ACCOUNTANT_EMAIL"),
        requiredEnv("E2E_ACCOUNTANT_PASSWORD"),
      ),
    );
    expect(
      (await request.get(`${apiBaseUrl()}/users`, { headers })).status(),
    ).toBe(403);
    expect(
      (await request.get(`${apiBaseUrl()}/leads`, { headers })).status(),
    ).toBe(403);
    // An invalid payload cannot create a record even if the role guard regresses.
    expect(
      (
        await request.post(`${apiBaseUrl()}/clients`, { headers, data: {} })
      ).status(),
    ).toBe(403);
    expect(
      (await request.get(`${apiBaseUrl()}/clients`, { headers })).ok(),
    ).toBeTruthy();
  });
});
