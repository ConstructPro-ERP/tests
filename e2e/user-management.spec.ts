import { randomUUID } from "node:crypto";
import { apiBaseUrl, expectOk } from "./support/api";
import { test, expect, loginAdminUI, mutation, uiRecord, uniqueName, type UserRecord } from "./support/management";

test.describe("User management", () => {
  test("frontend creates, searches, edits, deactivates and reactivates a user", async ({ page, request, adminHeaders, records }) => {
    const suffix = randomUUID();
    const email = `e2e-${suffix}@example.com`;
    await loginAdminUI(page);
    await page.goto("/dashboard/users");
    await page.getByRole("button", { name: "Add User", exact: true }).click();
    const editor = page.getByRole("region", { name: "Add User", exact: true });
    await editor.getByLabel("First Name", { exact: true }).fill("E2E");
    await editor.getByLabel("Last Name", { exact: true }).fill(suffix);
    await editor.getByLabel("Email Address", { exact: true }).fill(email);
    const createdResponse = mutation(page, "/users", "POST");
    await editor.getByRole("button", { name: "Create User", exact: true }).click();
    const user = records.track("users", await uiRecord<UserRecord>(await createdResponse));
    expect(user).toMatchObject({ email, fullName: `E2E ${suffix}`, status: "ACTIVE" });

    await page.getByLabel("Search users", { exact: true }).fill(email);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toHaveCount(1);
    // The name and the action cell both expose Edit buttons; scope the action cell.
    await row.getByRole("cell").last().getByRole("button", { name: `Edit ${user.fullName}`, exact: true }).click();
    const edit = page.getByRole("region", { name: `Edit User — ${user.fullName}`, exact: true });
    await edit.getByLabel("First Name", { exact: true }).fill("Updated");
    const updatedResponse = mutation(page, `/users/${user.id}`, "PATCH");
    await edit.getByRole("button", { name: "Save Changes", exact: true }).click();
    await uiRecord(await updatedResponse);
    await expect(row).toContainText(`Updated ${suffix}`);

    for (const [action, status] of [["Deactivate", "INACTIVE"], ["Activate", "ACTIVE"]] as const) {
      await row.getByRole("button", { name: `${action} Updated ${suffix}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `${action} user?`, exact: true });
      await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(row.getByRole("cell", { name: status === "ACTIVE" ? "Active" : "Inactive", exact: true })).toBeVisible();
      expect(await expectOk<UserRecord>(await request.get(`${apiBaseUrl()}/users/${user.id}`, { headers: adminHeaders })))
        .toMatchObject({ fullName: `Updated ${suffix}`, status });
    }
    await page.reload();
    await page.getByLabel("Search users", { exact: true }).fill(email);
    await expect(row).toContainText(`Updated ${suffix}`);
  });

  test("assigns a role and never exposes passwords in user responses", async ({ request, adminHeaders, records }) => {
    const roles = await expectOk<{ id: string; roleName: string }[]>(await request.get(`${apiBaseUrl()}/auth/roles`, { headers: adminHeaders }));
    const role = roles.find(item => item.roleName === "SALES_MANAGER");
    expect(role, "Seed the SALES_MANAGER role before running this suite").toBeDefined();
    const user = records.track("users", await expectOk<UserRecord>(await request.post(`${apiBaseUrl()}/users`, {
      headers: adminHeaders, data: { fullName: uniqueName("User"), email: `e2e-${randomUUID()}@example.com`, password: `E2e!${randomUUID()}` },
    })));
    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("passwordHash");
    expect(user.roleId).toBeNull();
    await expectOk(await request.patch(`${apiBaseUrl()}/users/${user.id}`, { headers: adminHeaders, data: { roleId: role!.id } }));
    const persisted = await expectOk<UserRecord>(await request.get(`${apiBaseUrl()}/users/${user.id}`, { headers: adminHeaders }));
    expect(persisted.roleId).toBe(role!.id);
    expect(persisted).not.toHaveProperty("password");
    const directory = await expectOk<UserRecord[]>(await request.get(`${apiBaseUrl()}/users`, { headers: adminHeaders }));
    expect(directory.find(item => item.id === user.id)).toMatchObject({ roleId: role!.id });
    for (const item of directory) {
      expect(item).not.toHaveProperty("password");
      expect(item).not.toHaveProperty("passwordHash");
    }
  });

  test("rejects duplicate email without changing the original account", async ({ request, adminHeaders, records }) => {
    const data = { fullName: uniqueName("Original"), email: `e2e-${randomUUID()}@example.com` };
    const user = records.track("users", await expectOk<UserRecord>(await request.post(`${apiBaseUrl()}/users`, { headers: adminHeaders, data })));
    const duplicate = await request.post(`${apiBaseUrl()}/users`, { headers: adminHeaders, data: { ...data, fullName: "Duplicate" } });
    if (duplicate.ok()) records.track("users", await expectOk<UserRecord>(duplicate));
    expect(duplicate.status()).toBe(400);
    expect(await expectOk(await request.get(`${apiBaseUrl()}/users/${user.id}`, { headers: adminHeaders }))).toMatchObject(data);
  });

  for (const [name, data] of [
    ["missing name", { email: `e2e-${randomUUID()}@example.com` }],
    ["invalid email", { fullName: "E2E Invalid", email: "invalid" }],
    ["short password", { fullName: "E2E Invalid", email: `e2e-${randomUUID()}@example.com`, password: "123" }],
  ] as const) {
    test(`rejects ${name}`, async ({ request, adminHeaders, records }) => {
      const response = await request.post(`${apiBaseUrl()}/users`, { headers: adminHeaders, data });
      if (response.ok()) records.track("users", await expectOk<UserRecord>(response));
      expect(response.status()).toBe(400);
    });
  }
});
