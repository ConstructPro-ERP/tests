import { randomUUID } from "node:crypto";
import { apiBaseUrl, expectOk } from "./support/api";
import {
  test,
  expect,
  uniqueName,
  type ClientRecord,
  type LeadRecord,
} from "./support/management";

test.describe("Clients", () => {
  test("creates, lists, updates and deletes a standalone client", async ({
    request,
    adminHeaders,
    records,
  }) => {
    const client = records.track(
      "clients",
      await expectOk<ClientRecord>(
        await request.post(`${apiBaseUrl()}/clients`, {
          headers: adminHeaders,
          data: { fullName: uniqueName("Client") },
        }),
      ),
    );
    expect(client.leadId).toBeNull();
    const clients = await expectOk<ClientRecord[]>(
      await request.get(`${apiBaseUrl()}/clients`, { headers: adminHeaders }),
    );
    expect(clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: client.id, fullName: client.fullName }),
      ]),
    );
    const url = `${apiBaseUrl()}/clients/${client.id}`;
    const fullName = `${client.fullName} Updated`;
    await expectOk(
      await request.patch(url, { headers: adminHeaders, data: { fullName } }),
    );
    expect(
      await expectOk(await request.get(url, { headers: adminHeaders })),
    ).toMatchObject({ id: client.id, fullName });
    expect(
      (await request.delete(url, { headers: adminHeaders })).ok(),
    ).toBeTruthy();
    expect((await request.get(url, { headers: adminHeaders })).status()).toBe(
      404,
    );
    const remaining = await expectOk<ClientRecord[]>(
      await request.get(`${apiBaseUrl()}/clients`, { headers: adminHeaders }),
    );
    expect(remaining.some((item) => item.id === client.id)).toBe(false);
  });

  test("links a client to a lead and rejects a second client for the same lead", async ({
    request,
    adminHeaders,
    records,
  }) => {
    const lead = records.track(
      "leads",
      await expectOk<LeadRecord>(
        await request.post(`${apiBaseUrl()}/leads`, {
          headers: adminHeaders,
          data: { customerName: uniqueName("Client Lead") },
        }),
      ),
    );
    const data = { fullName: lead.customerName, leadId: lead.id };
    const client = records.track(
      "clients",
      await expectOk<ClientRecord>(
        await request.post(`${apiBaseUrl()}/clients`, {
          headers: adminHeaders,
          data,
        }),
      ),
    );
    expect(client).toMatchObject(data);
    const persistedLead = await expectOk<LeadRecord>(
      await request.get(`${apiBaseUrl()}/leads/${lead.id}`, {
        headers: adminHeaders,
      }),
    );
    expect(persistedLead.customer).toMatchObject({
      id: client.id,
      fullName: client.fullName,
    });
    const duplicate = await request.post(`${apiBaseUrl()}/clients`, {
      headers: adminHeaders,
      data,
    });
    if (duplicate.ok())
      records.track("clients", await expectOk<ClientRecord>(duplicate));
    expect(duplicate.status()).toBe(409);
    expect(
      await expectOk(
        await request.get(`${apiBaseUrl()}/clients/${client.id}`, {
          headers: adminHeaders,
        }),
      ),
    ).toMatchObject({
      leadId: lead.id,
      lead: { id: lead.id, customerName: lead.customerName },
    });
  });

  for (const [name, data] of [
    ["missing name", {}],
    ["empty name", { fullName: "" }],
    ["invalid lead ID", { fullName: "E2E Invalid", leadId: "invalid" }],
  ] as const) {
    test(`rejects ${name}`, async ({ request, adminHeaders, records }) => {
      const response = await request.post(`${apiBaseUrl()}/clients`, {
        headers: adminHeaders,
        data,
      });
      if (response.ok())
        records.track("clients", await expectOk<ClientRecord>(response));
      expect(response.status()).toBe(400);
    });
  }

  test("returns 404 for a missing client", async ({
    request,
    adminHeaders,
  }) => {
    const url = `${apiBaseUrl()}/clients/${randomUUID()}`;
    expect((await request.get(url, { headers: adminHeaders })).status()).toBe(
      404,
    );
    expect(
      (
        await request.patch(url, {
          headers: adminHeaders,
          data: { fullName: "E2E Missing" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await request.delete(url, { headers: adminHeaders })).status(),
    ).toBe(404);
  });
});
