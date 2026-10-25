import {
  test,
  expect,
  type Project,
  type PageResult,
  unique,
  url,
  uuid,
} from "./fixture";

test.describe("Projects — gateway and persistence", () => {
  test("create, retrieve, update and delete an unused planning project", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    expect(project).toMatchObject({
      status: "PLANNING",
      projectManagerId: c.adminId,
    });
    const renamed = unique("Renamed project");
    await c.patch<Project>(`/projects/${project.id}`, {
      projectName: renamed,
      location: "Kandy",
      budget: 155000,
    });
    const saved = await c.get<Project>(`/projects/${project.id}`);
    expect(saved).toMatchObject({
      id: project.id,
      projectName: renamed,
      location: "Kandy",
    });
    expect(Number(saved.budget)).toBe(155000);
    expect(
      (
        await c.request.delete(url(`/projects/${project.id}`), {
          headers: c.headers,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await c.request.get(url(`/projects/${project.id}`), {
          headers: c.headers,
        })
      ).status(),
    ).toBe(404);
  });

  test("search, status, manager filters and pagination return only matches", async ({
    projectContext: c,
  }) => {
    const prefix = unique("Project list");
    await c.createProject({ projectName: `${prefix} B` });
    await c.createProject({ projectName: `${prefix} A` });
    for (const [page, suffix] of [
      [1, "A"],
      [2, "B"],
    ] as const) {
      const result = await c.get<PageResult<Project>>("/projects", {
        search: prefix,
        status: "PLANNING",
        projectManagerId: c.adminId,
        page,
        limit: 1,
        sortBy: "projectName",
        sortOrder: "asc",
      });
      expect(result.meta).toMatchObject({ total: 2, page, totalPages: 2 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].projectName).toBe(`${prefix} ${suffix}`);
    }
  });

  test("validates project creation, manager IDs, dates and status transitions", async ({
    projectContext: c,
  }) => {
    for (const data of [
      { projectName: "Missing manager", startDate: "2026-10-01T00:00:00.000Z" },
      {
        projectName: "Invalid manager",
        startDate: "2026-10-01T00:00:00.000Z",
        projectManagerId: uuid(),
      },
      {
        projectName: "Invalid date",
        startDate: "not-a-date",
        projectManagerId: c.adminId,
      },
      {
        projectName: "Invalid range",
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2026-01-01T00:00:00.000Z",
        projectManagerId: c.adminId,
      },
    ]) {
      const response = await c.request.post(url("/projects"), {
        headers: c.headers,
        data,
      });
      expect(response.status(), await response.text()).toBe(400);
    }
    const project = await c.createProject();
    for (const [path, data] of [
      [`/projects/${project.id}/status`, { status: "COMPLETED" }],
      [`/projects/${project.id}/status`, { status: "UNKNOWN" }],
      [`/projects/${project.id}/manager`, { projectManagerId: uuid() }],
    ] as const) {
      const response = await c.request.patch(url(path), {
        headers: c.headers,
        data,
      });
      expect(response.status(), await response.text()).toBe(400);
    }
    expect((await c.get<Project>(`/projects/${project.id}`)).status).toBe(
      "PLANNING",
    );
  });

  test("project with dependent milestone cannot be permanently deleted", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    await c.createMilestone(project.id);
    const response = await c.request.delete(url(`/projects/${project.id}`), {
      headers: c.headers,
    });
    expect(response.status()).toBe(409);
    expect((await c.get<Project>(`/projects/${project.id}`)).id).toBe(
      project.id,
    );
  });

  test("unapproved standalone project cannot become ACTIVE", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const result = await c.request.patch(
      url(`/projects/${project.id}/status`),
      {
        headers: c.headers,
        data: { status: "ACTIVE" },
      },
    );
    expect(result.status()).toBe(400);
    expect((await c.get<Project>(`/projects/${project.id}`)).status).toBe(
      "PLANNING",
    );
  });

  test("assigns another active project manager when a disposable manager ID is provided", async ({
    projectContext: c,
  }) => {
    const alternate = process.env.E2E_ALTERNATE_PROJECT_MANAGER_ID?.trim();
    test.skip(
      !alternate,
      "Set E2E_ALTERNATE_PROJECT_MANAGER_ID to an active ADMIN or PROJECT_MANAGER user.",
    );
    const project = await c.createProject();
    await c.patch<Project>(`/projects/${project.id}/manager`, {
      projectManagerId: alternate,
    });
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).projectManagerId,
    ).toBe(alternate);
    // Restore original assignment before fixture cleanup.
    await c.patch<Project>(`/projects/${project.id}/manager`, {
      projectManagerId: c.adminId,
    });
  });
});
