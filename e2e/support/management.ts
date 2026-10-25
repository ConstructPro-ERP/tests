import { randomUUID } from "node:crypto";
import {
  test as base,
  expect,
  type Page,
  type Response,
} from "@playwright/test";
import { apiBaseUrl, bearer, expectOk, requiredEnv } from "./api";
import { savedHeaders } from "./auth-state";

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
  adminHeaders: async ({}, use) => {
    await use(savedHeaders("root", "admin"));
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
  requiredEnv("FRONTEND_BASE_URL");

  // The context already has its directory's Admin storageState.
  await page.goto("/modules");
  await expect(page).toHaveURL(/\/modules(?:[/?#]|$)/);

  const token = await page.evaluate(() =>
    localStorage.getItem("construct_pro_access_token"),
  );

  expect(token).toBeTruthy();

  const profile = await expectOk<{ role: string }>(
    await page.request.get(`${apiBaseUrl()}/auth/me`, {
      headers: bearer(token!),
    }),
  );

  expect(profile.role).toBe("ADMIN");
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
