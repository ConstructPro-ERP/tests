import { randomUUID } from "node:crypto";
import { apiBaseUrl, expectOk } from "./support/api";
import { test, expect, loginAdminUI, mutation, uiRecord, uniqueName, type LeadRecord, type UserRecord } from "./support/management";

test.describe("Leads", () => {
  test("frontend captures, searches, edits, adds a note and deletes a lead", async ({ page, request, adminHeaders, records }) => {
    const name = uniqueName("Lead");
    await loginAdminUI(page);
    const listResponse = mutation(page, "/leads", "GET");
    await page.goto("/dashboard/leads");
    await uiRecord(await listResponse);
    await page.getByRole("button", { name: "Capture Lead", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Customer name", { exact: false }).fill(name);
    await dialog.getByLabel("Email", { exact: true }).fill(`e2e-${randomUUID()}@example.com`);
    const createdResponse = mutation(page, "/leads", "POST");
    await dialog.getByRole("button", { name: "Capture Lead", exact: true }).click();
    const lead = records.track("leads", await uiRecord<LeadRecord>(await createdResponse));
    await expect(dialog).not.toBeVisible();
    await page.getByPlaceholder("Search leads...", { exact: true }).fill(name);
    const detailResponse = mutation(page, `/leads/${lead.id}`, "GET");
    await page.getByRole("button").filter({ has: page.getByText(name, { exact: true }) }).click();
    await uiRecord(await detailResponse);
    await page.getByRole("button", { name: "Edit lead", exact: true }).click();
    const updatedName = `${name} Updated`;
    await dialog.getByLabel("Customer name", { exact: false }).fill(updatedName);
    await dialog.getByLabel("Status", { exact: true }).selectOption("QUALIFIED");
    const editedResponse = mutation(page, `/leads/${lead.id}`, "PATCH");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await uiRecord(await editedResponse);
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel("Update lead status")).toHaveValue("QUALIFIED");

    const note = `Follow-up ${randomUUID()}`;
    await page.getByLabel("New note", { exact: true }).fill(note);
    const noteResponse = mutation(page, `/leads/${lead.id}/notes`, "POST");
    await page.getByRole("button", { name: "Create note", exact: true }).click();
    await uiRecord(await noteResponse);
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    const persisted = await expectOk<LeadRecord>(await request.get(`${apiBaseUrl()}/leads/${lead.id}`, { headers: adminHeaders }));
    expect(persisted).toMatchObject({ customerName: updatedName, status: "QUALIFIED" });
    expect(persisted.notes).toEqual(expect.arrayContaining([expect.objectContaining({ content: note })]));
    await page.reload();
    await page.getByPlaceholder("Search leads...", { exact: true }).fill(updatedName);
    await page.getByRole("button").filter({ has: page.getByText(updatedName, { exact: true }) }).click();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete lead", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete lead", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText("No leads found", { exact: true })).toBeVisible();
    expect((await request.get(`${apiBaseUrl()}/leads/${lead.id}`, { headers: adminHeaders })).status()).toBe(404);
  });

  test("persists assignment, status, notes and contact changes", async ({ request, adminHeaders, records }) => {
    const user = records.track("users", await expectOk<UserRecord>(await request.post(`${apiBaseUrl()}/users`, {
      headers: adminHeaders, data: { fullName: uniqueName("Assignee"), email: `e2e-${randomUUID()}@example.com` },
    })));
    const lead = records.track("leads", await expectOk<LeadRecord>(await request.post(`${apiBaseUrl()}/leads`, {
      headers: adminHeaders, data: { customerName: uniqueName("Lead") },
    })));
    const url = `${apiBaseUrl()}/leads/${lead.id}`;
    expect(lead.status).toBe("NEW");
    await expectOk(await request.patch(`${url}/assign`, { headers: adminHeaders, data: { assignedToId: user.id } }));
    await expectOk(await request.patch(`${url}/status`, { headers: adminHeaders, data: { status: "CONTACTED" } }));
    const note = await expectOk<{ id: string }>(await request.post(`${url}/notes`, { headers: adminHeaders, data: { content: "E2E follow-up" } }));
    const contact = await expectOk<{ id: string }>(await request.post(`${url}/contacts`, { headers: adminHeaders, data: { label: "Office", value: "+94771234567" } }));
    await expectOk(await request.patch(`${url}/contacts/${contact.id}`, { headers: adminHeaders, data: { label: "Mobile", value: "+94777654321" } }));
    const persisted = await expectOk<LeadRecord>(await request.get(url, { headers: adminHeaders }));
    expect(persisted).toMatchObject({ assignedToId: user.id, status: "CONTACTED" });
    expect(persisted.notes).toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id, content: "E2E follow-up" })]));
    expect(persisted.contacts).toEqual([expect.objectContaining({ id: contact.id, label: "Mobile", value: "+94777654321" })]);
    expect((await request.delete(`${url}/notes/${note.id}`, { headers: adminHeaders })).ok()).toBeTruthy();
    expect((await request.delete(`${url}/contacts/${contact.id}`, { headers: adminHeaders })).ok()).toBeTruthy();
    const after = await expectOk<LeadRecord>(await request.get(url, { headers: adminHeaders }));
    expect(after.notes).toEqual([]);
    expect(after.contacts).toEqual([]);
  });

  test("search, status filters and pagination return only matching leads", async ({ request, adminHeaders, records }) => {
    const prefix = uniqueName("Search");
    for (const [suffix, status] of [["A", "NEW"], ["B", "NEW"], ["C", "LOST"]]) {
      records.track("leads", await expectOk<LeadRecord>(await request.post(`${apiBaseUrl()}/leads`, { headers: adminHeaders, data: { customerName: `${prefix} ${suffix}`, status } })));
    }
    for (const page of [1, 2]) {
      const result = await expectOk<{ data: LeadRecord[]; meta: { total: number; page: number; totalPages: number } }>(
        await request.get(`${apiBaseUrl()}/leads`, { headers: adminHeaders, params: { search: prefix, status: "NEW", page, limit: 1, sortBy: "customerName", sortOrder: "asc" } }),
      );
      expect(result.meta).toMatchObject({ total: 2, page, totalPages: 2 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ customerName: `${prefix} ${page === 1 ? "A" : "B"}`, status: "NEW" });
    }
  });

  for (const [name, data] of [
    ["missing customer name", {}],
    ["invalid email", { customerName: "E2E Invalid", email: "invalid" }],
    ["invalid status", { customerName: "E2E Invalid", status: "INVALID" }],
  ] as const) {
    test(`rejects ${name}`, async ({ request, adminHeaders, records }) => {
      const response = await request.post(`${apiBaseUrl()}/leads`, { headers: adminHeaders, data });
      if (response.ok()) records.track("leads", await expectOk<LeadRecord>(response));
      expect(response.status()).toBe(400);
    });
  }
});
