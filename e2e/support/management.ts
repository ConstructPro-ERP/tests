import { randomUUID } from "node:crypto";
import {
  test as base,
  expect,
  type Page,
  type Response,
} from "@playwright/test";
import { apiBaseUrl, bearer, expectOk, login, requiredEnv } from "./api";
import { adminCredentials } from "./admin-credentials";

export interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  roleId: string | null;
}
export interface LeadRecord {
  id: string;
  customerName: string;
  email: string | null;
  status: string;
  assignedToId: string | null;
  notes: { id: string; content: string }[];
  contacts: { id: string; label: string; value: string }[];
  customer: { id: string; fullName: string } | null;
}
export interface ClientRecord {
  id: string;
  fullName: string;
  leadId: string | null;
}
type Resource = "users" | "leads" | "clients";

export function uniqueName(prefix: string): string {
  return `E2E ${prefix} ${randomUUID()}`;
}

export const test = base.extend<{
  adminHeaders: ReturnType<typeof bearer>;
  records: {
    track: <T extends { id: string }>(resource: Resource, record: T) => T;
  };
}>({
  adminHeaders: async ({ request }, use) => {
    const { email, password } = adminCredentials();
    const token = await login(request, email, password);
    const headers = bearer(token);
    // Check the server's current role before mutations or browser navigation.
    // A successful login alone does not grant management permissions.
    const profile = await expectOk<{ role?: string | null; roles?: string[] }>(
      await request.get(`${apiBaseUrl()}/auth/me`, { headers }),
    );
    const roles = [profile.role, ...(profile.roles ?? [])]
      .filter((role): role is string => typeof role === "string")
      .map((role) =>
        role
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_"),
      );
    expect(
      roles,
      `Management E2E requires an ADMIN account; the configured account has role(s): ${roles.join(", ") || "unassigned"}. ` +
        "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD in tests/.env to an existing ADMIN account. " +
        "When both are blank, E2E_USER_EMAIL and E2E_USER_PASSWORD are used instead.",
    ).toContain("ADMIN");
    await use(headers);
  },
  records: async ({ request, adminHeaders }, use) => {
    const created: { resource: Resource; id: string }[] = [];
    await use({
      track(resource, record) {
        expect(
          record.id,
          `created ${resource} record must have an ID`,
        ).toBeTruthy();
        created.push({ resource, id: record.id });
        return record;
      },
    });
    // Reverse creation order removes clients before their leads. Always attempt
    // every cleanup, even if an earlier deletion fails.
    const errors: string[] = [];
    for (const { resource, id } of created.reverse()) {
      const url = `${apiBaseUrl()}/${resource}/${id}`;
      try {
        if (resource === "users") {
          const user = await expectOk<UserRecord>(
            await request.get(url, { headers: adminHeaders }),
          );
          if (user.status === "INACTIVE") continue;
        }
        const response = await request.delete(url, { headers: adminHeaders });
        if (!response.ok() && response.status() !== 404) {
          errors.push(`${resource}/${id}: HTTP ${response.status()}`);
        }
      } catch (error) {
        errors.push(`${resource}/${id}: ${String(error)}`);
      }
    }
    expect(errors, "Test record cleanup failed").toEqual([]);
  },
});

export async function loginAdminUI(page: Page) {
  const { email, password } = adminCredentials();
  requiredEnv("FRONTEND_BASE_URL");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/modules(?:[/?#]|$)/);
}

// Register before clicking so fast responses cannot be missed. Match the method
// and exact API path, excluding unrelated list/detail requests.
export function mutation(page: Page, path: string, method: string) {
  const pathname = new URL(`${apiBaseUrl()}${path}`).pathname;
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === pathname &&
      response.request().method() === method,
  );
}

export async function uiRecord<T>(response: Response): Promise<T> {
  expect(
    response.ok(),
    `UI request failed: HTTP ${response.status()}`,
  ).toBeTruthy();
  const json = await response.json();
  return (json.data ?? json) as T;
}

export { expect };
