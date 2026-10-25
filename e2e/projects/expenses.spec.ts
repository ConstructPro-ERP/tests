import { test, expect, type Expense, type PageResult, url } from "./fixture";

test.describe("Project expenses — precision, audit trail and summaries", () => {
  test("create, update and retrieve expenses without modifying recordedBy", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const expense = await c.createExpense(project.id, {
      amount: "12500.75",
      category: "MATERIAL",
      description: "Steel rods",
    });
    expect(expense).toMatchObject({
      projectId: project.id,
      category: "MATERIAL",
      recordedById: c.adminId,
    });
    expect(Number(expense.amount)).toBeCloseTo(12500.75, 2);
    expect(expense.recordedBy).toMatchObject({ id: c.adminId });
    const updated = await c.patch<Expense>(`/expenses/${expense.id}`, {
      amount: "15000.50",
      category: "LABOUR",
      description: "Crew allocation",
    });
    expect(Number(updated.amount)).toBeCloseTo(15000.5, 2);
    const saved = await c.get<Expense>(`/expenses/${expense.id}`);
    expect(saved).toMatchObject({
      id: expense.id,
      category: "LABOUR",
      description: "Crew allocation",
      recordedById: c.adminId,
    });
    expect(saved.recordedBy).toMatchObject({ id: c.adminId });
    // An untrusted creator override must never transfer ownership. Either
    // reject the extra field or strip it, but preserve the original actor.
    const spoof = await c.request.patch(url(`/expenses/${expense.id}`), {
      headers: c.headers,
      data: { amount: "15000.50", recordedById: "not-an-actor" },
    });
    expect([200, 400]).toContain(spoof.status());
    expect((await c.get<Expense>(`/expenses/${expense.id}`)).recordedById).toBe(
      c.adminId
    );
  });

  test("category/date filtering, pagination and totals reflect decimal amounts", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    await c.createExpense(project.id, {
      amount: "0.10",
      category: "MATERIAL",
      expenseDate: "2026-10-11T00:00:00.000Z",
    });
    await c.createExpense(project.id, {
      amount: "0.20",
      category: "MATERIAL",
      expenseDate: "2026-10-12T00:00:00.000Z",
    });
    await c.createExpense(project.id, {
      amount: "3.00",
      category: "LABOUR",
      expenseDate: "2026-09-20T00:00:00.000Z",
    });
    const response = await c.get<PageResult<Expense>>(
      `/projects/${project.id}/expenses`,
      {
        category: "MATERIAL",
        fromDate: "2026-10-01",
        toDate: "2026-10-31",
        page: 1,
        limit: 1,
        sortBy: "amount",
        sortOrder: "asc",
      }
    );
    expect(response.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect(response.data).toHaveLength(1);
    expect(Number(response.data[0].amount)).toBeCloseTo(0.1, 2);
    const summary = await c.get<{
      total: string;
      byCategory: Array<{ category: string | null; amount: string }>;
    }>(`/projects/${project.id}/expenses/summary`);
    expect(summary.total).toBe("3.30");
    expect(summary.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "MATERIAL", amount: "0.30" }),
        expect.objectContaining({ category: "LABOUR", amount: "3.00" }),
      ])
    );
  });

  test("nullable optional metadata persists; Admin can delete an expense", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const expense = await c.createExpense(project.id, {
      category: null,
      description: null,
    });
    expect(await c.get<Expense>(`/expenses/${expense.id}`)).toMatchObject({
      category: null,
      description: null,
    });
    const response = await c.request.delete(url(`/expenses/${expense.id}`), {
      headers: c.headers,
    });
    expect(response.ok()).toBeTruthy();
    expect(
      (
        await c.request.get(url(`/expenses/${expense.id}`), {
          headers: c.headers,
        })
      ).status()
    ).toBe(404);
  });

  test("amount, date, category and pagination validation reject bad values", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    for (const amount of ["0", "-1", "1.234", "10000000000", 10]) {
      const response = await c.request.post(
        url(`/projects/${project.id}/expenses`),
        {
          headers: c.headers,
          data: { amount, expenseDate: "2026-10-10T00:00:00.000Z" },
        }
      );
      expect(response.status(), await response.text()).toBe(400);
    }
    const expense = await c.createExpense(project.id);
    for (const data of [
      { expenseDate: "tomorrow" },
      { category: " ", description: "Valid" },
      { category: "C".repeat(101) },
      { description: "D".repeat(1001) },
    ]) {
      const response = await c.request.patch(url(`/expenses/${expense.id}`), {
        headers: c.headers,
        data,
      });
      expect(response.status(), await response.text()).toBe(400);
    }
    const invalidQuery = await c.request.get(
      url(`/projects/${project.id}/expenses`),
      { headers: c.headers, params: { limit: 101 } }
    );
    expect(invalidQuery.status()).toBe(400);
    const invalidRange = await c.request.get(
      url(`/projects/${project.id}/expenses`),
      {
        headers: c.headers,
        params: { fromDate: "2026-11-01", toDate: "2026-10-01" },
      }
    );
    expect(invalidRange.status()).toBe(400);
  });
});
