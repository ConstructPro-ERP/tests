import {
  test,
  expect,
  bearer,
  expectOk,
  login,
  type Project,
  url,
} from "./fixture";

const protectedPaths = [
  "/projects",
  "/tasks",
  "/milestones/00000000-0000-4000-8000-000000000001",
  "/expenses/00000000-0000-4000-8000-000000000001",
  "/document-categories",
] as const;

test.describe("Project resources — gateway authentication", () => {
  for (const path of protectedPaths) {
    test(`GET ${path} requires authentication`, async ({ request }) => {
      expect((await request.get(url(path))).status()).toBe(401);
    });
  }
  test("anonymous create requests are rejected before validation", async ({
    request,
  }) => {
    for (const path of ["/projects", "/tasks", "/document-categories"]) {
      const response = await request.post(url(path), { data: {} });
      expect(response.status()).toBe(401);
    }
  });
});

test.describe("Project resources — role authorization", () => {
  test("ACCOUNTANT has read access but cannot create projects, milestones or tasks", async ({
    request,
    projectContext: c,
  }) => {
    test.skip(
      !process.env.E2E_ACCOUNTANT_EMAIL || !process.env.E2E_ACCOUNTANT_PASSWORD,
      "Set E2E_ACCOUNTANT_EMAIL and E2E_ACCOUNTANT_PASSWORD."
    );
    const accountant = bearer(
      await login(
        request,
        process.env.E2E_ACCOUNTANT_EMAIL!,
        process.env.E2E_ACCOUNTANT_PASSWORD!
      )
    );
    expect(
      (await request.get(url("/projects"), { headers: accountant })).status()
    ).toBe(200);
    const project = await c.createProject();
    for (const path of [
      "/projects",
      `/projects/${project.id}/milestones`,
      "/tasks",
    ]) {
      const response = await request.post(url(path), {
        headers: accountant,
        data: {},
      });
      expect(response.status(), await response.text()).toBe(403);
    }
    const deniedEdit = await request.patch(url(`/projects/${project.id}`), {
      headers: accountant,
      data: { projectName: "Forbidden" },
    });
    expect(deniedEdit.status()).toBe(403);
    const expense = await expectOk<{ id: string }>(
      await request.post(url(`/projects/${project.id}/expenses`), {
        headers: accountant,
        data: { amount: "1.01", expenseDate: "2026-10-15T00:00:00.000Z" },
      })
    );
    try {
      // Accountant can create and edit, but cannot delete an expense.
      expect(
        (
          await request.patch(url(`/expenses/${expense.id}`), {
            headers: accountant,
            data: { amount: "2.01" },
          })
        ).ok()
      ).toBeTruthy();
      expect(
        (
          await request.delete(url(`/expenses/${expense.id}`), {
            headers: accountant,
          })
        ).status()
      ).toBe(403);
    } finally {
      // Cleanup with Admin, as the Accountant is not allowed to delete.
      expect(
        (
          await request.delete(url(`/expenses/${expense.id}`), {
            headers: c.headers,
          })
        ).ok()
      ).toBeTruthy();
    }
  });

  test("PROJECT_MANAGER is unable to create standalone projects or expense records", async ({
    request,
    projectContext: c,
  }) => {
    test.skip(
      !process.env.E2E_PROJECT_MANAGER_EMAIL ||
        !process.env.E2E_PROJECT_MANAGER_PASSWORD,
      "Set E2E_PROJECT_MANAGER_EMAIL and E2E_PROJECT_MANAGER_PASSWORD."
    );
    const manager = bearer(
      await login(
        request,
        process.env.E2E_PROJECT_MANAGER_EMAIL!,
        process.env.E2E_PROJECT_MANAGER_PASSWORD!
      )
    );
    const project = await c.createProject();
    expect(
      (
        await request.post(url("/projects"), { headers: manager, data: {} })
      ).status()
    ).toBe(403);
    expect(
      (
        await request.post(url(`/projects/${project.id}/expenses`), {
          headers: manager,
          data: {},
        })
      ).status()
    ).toBe(403);
    // Project managers cannot modify projects they have not been assigned to.
    expect(
      (
        await request.patch(url(`/projects/${project.id}`), {
          headers: manager,
          data: { projectName: "Forbidden" },
        })
      ).status()
    ).toBe(403);
    expect(
      (
        await request.get(url(`/projects/${project.id}`), { headers: manager })
      ).status()
    ).toBe(403);
    for (const foreignPath of [
      `/projects/${project.id}/tasks`,
      `/projects/${project.id}/milestones`,
      `/projects/${project.id}/expenses`,
      `/projects/${project.id}/expenses/summary`,
      `/projects/${project.id}/documents`,
    ]) {
      expect(
        (await request.get(url(foreignPath), { headers: manager })).status()
      ).toBe(403);
    }
    const projects = await expectOk<{ data: Project[] }>(
      await request.get(url("/projects"), { headers: manager })
    );
    expect(projects.data.some((item) => item.id === project.id)).toBe(false);
  });

  test("ACCOUNTANT cannot mutate document categories", async ({ request }) => {
    test.skip(
      !process.env.E2E_ACCOUNTANT_EMAIL || !process.env.E2E_ACCOUNTANT_PASSWORD,
      "Set E2E_ACCOUNTANT_EMAIL and E2E_ACCOUNTANT_PASSWORD."
    );
    const accountant = bearer(
      await login(
        request,
        process.env.E2E_ACCOUNTANT_EMAIL!,
        process.env.E2E_ACCOUNTANT_PASSWORD!
      )
    );
    expect(
      (
        await request.get(url("/document-categories"), { headers: accountant })
      ).ok()
    ).toBeTruthy();
    expect(
      (
        await request.post(url("/document-categories"), {
          headers: accountant,
          data: {},
        })
      ).status()
    ).toBe(403);
    const seeded = process.env.E2E_DOCUMENT_PROJECT_ID?.trim();
    if (seeded) {
      expect(
        (
          await request.post(
            url(`/projects/${seeded}/documents/upload-authorizations`),
            {
              headers: accountant,
              data: {},
            }
          )
        ).status()
      ).toBe(403);
    }
  });
});
