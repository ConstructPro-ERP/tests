import {
  test,
  expect,
  url,
  uuid,
  unique,
  type Project,
  type Task,
  type Milestone,
} from "./fixture";

// These tests leave no persistent records and exercise rejection paths that
// are easy to miss when only successful CRUD calls are verified.
test.describe("Project management — validation and resource boundaries", () => {
  test("project filters, sorting, pagination and nonexistent identifiers are validated", async ({
    projectContext: c,
  }) => {
    const created = await c.createProject();
    const invalidProjectQueries: Record<string, string | number | boolean>[] = [
      { status: "INVALID" },
      { projectManagerId: "bad-uuid" },
      { page: 0 },
      { limit: 0 },
      { limit: 101 },
      { sortBy: "bad" },
      { sortOrder: "descending" },
    ];

    for (const params of invalidProjectQueries) {
      const response = await c.request.get(url("/projects"), {
        headers: c.headers,
        params,
      });

      expect(
        response.status(),
        `${JSON.stringify(params)}: ${await response.text()}`,
      ).toBe(400);
    }
    expect(
      (
        await c.request.get(url(`/projects/${uuid()}`), { headers: c.headers })
      ).status(),
    ).toBe(404);
    expect(
      (
        await c.request.get(url("/projects/not-a-uuid"), { headers: c.headers })
      ).status(),
    ).toBe(400);
    expect((await c.get<Project>(`/projects/${created.id}`)).status).toBe(
      "PLANNING",
    );
  });

  test("project update validates dates, budgets and prevents status edits through metadata", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    for (const data of [
      {
        startDate: "2030-10-01T00:00:00.000Z",
        endDate: "2029-10-01T00:00:00.000Z",
      },
      { budget: -1 },
      { projectName: 123 },
      { endDate: "not-a-date" },
    ]) {
      const response = await c.request.patch(url(`/projects/${project.id}`), {
        headers: c.headers,
        data,
      });
      expect(response.status(), await response.text()).toBe(400);
    }
    const initial = await c.get<Project>(`/projects/${project.id}`);
    const response = await c.request.patch(url(`/projects/${project.id}`), {
      headers: c.headers,
      data: { status: "COMPLETED" },
    });
    expect([200, 400]).toContain(response.status()); // whitelist strips unknown properties in some deployments.
    expect((await c.get<Project>(`/projects/${project.id}`)).status).toBe(
      initial.status,
    );
  });

  test("status routes reject impossible transitions without mutating planning project", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    for (const status of ["ON_HOLD", "COMPLETED", "SOMETHING_ELSE"]) {
      const response = await c.request.patch(
        url(`/projects/${project.id}/status`),
        { headers: c.headers, data: { status } },
      );
      expect(response.status(), await response.text()).toBe(400);
      expect((await c.get<Project>(`/projects/${project.id}`)).status).toBe(
        "PLANNING",
      );
    }
  });

  test("task due dates, malformed assignment, status and query validation", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const task = await c.createTask(project.id);
    for (const dueDate of [
      "2026-09-30T00:00:00.000Z",
      "2027-10-02T00:00:00.000Z",
    ]) {
      const response = await c.request.patch(url(`/tasks/${task.id}`), {
        headers: c.headers,
        data: { dueDate },
      });
      expect(response.status(), await response.text()).toBe(400);
    }
    for (const data of [
      { assignedToId: "invalid" },
      { assignedToId: uuid() },
      {},
    ]) {
      const response = await c.request.patch(url(`/tasks/${task.id}/assign`), {
        headers: c.headers,
        data,
      });
      expect(response.status(), await response.text()).toBe(400);
    }
    const blocked = await c.patch<Task>(`/tasks/${task.id}/status`, {
      status: "BLOCKED",
    });
    expect(blocked.status).toBe("BLOCKED");

    const restored = await c.patch<Task>(`/tasks/${task.id}/status`, {
      status: "TODO",
    });
    expect(restored.status).toBe("TODO");

    const invalidStatus = await c.request.patch(
      url(`/tasks/${task.id}/status`),
      {
        headers: c.headers,
        data: { status: "INVALID_STATUS" },
      },
    );
    expect(invalidStatus.status(), await invalidStatus.text()).toBe(400);
    const invalidTaskQueries: Record<string, string | number | boolean>[] = [
      { projectId: "bad" },
      { limit: 101 },
      { page: -1 },
      { search: "x".repeat(201) },
    ];

    for (const params of invalidTaskQueries) {
      const response = await c.request.get(url("/tasks"), {
        headers: c.headers,
        params,
      });

      expect(response.status(), await response.text()).toBe(400);
    }
    const saved = await c.get<Task>(`/tasks/${task.id}`);
    expect(saved).toMatchObject({
      id: task.id,
      status: "TODO",
      assignedToId: null,
    });
    expect(
      (
        await c.request.get(url(`/tasks/${uuid()}`), { headers: c.headers })
      ).status(),
    ).toBe(404);
  });

  test("task milestone can be changed only to one belonging to the same project", async ({
    projectContext: c,
  }) => {
    const first = await c.createProject();
    const second = await c.createProject();
    const local = await c.createMilestone(first.id);
    const foreign = await c.createMilestone(second.id);
    const task = await c.createTask(first.id);
    await c.patch<Task>(`/tasks/${task.id}`, { milestoneId: local.id });
    expect((await c.get<Task>(`/tasks/${task.id}`)).milestoneId).toBe(local.id);
    const denied = await c.request.patch(url(`/tasks/${task.id}`), {
      headers: c.headers,
      data: { milestoneId: foreign.id },
    });
    expect(denied.status(), await denied.text()).toBe(400);
    expect((await c.get<Task>(`/tasks/${task.id}`)).milestoneId).toBe(local.id);
  });

  test("milestone progress, completion timestamp and delayed flag stay consistent", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const milestone = await c.createMilestone(project.id, {
      dueDate: "2026-10-02T00:00:00.000Z",
    });
    const initial = await c.get<Milestone & { isDelayed: boolean }>(
      `/milestones/${milestone.id}`,
    );
    expect(initial.status).toBe("PENDING");
    expect(initial.isDelayed).toBe(true);
    await c.patch<Milestone>(`/milestones/${milestone.id}/progress`, {
      progressPercentage: 100,
    });
    const completed = await c.get<Milestone & { isDelayed: boolean }>(
      `/milestones/${milestone.id}`,
    );
    expect(completed).toMatchObject({
      status: "COMPLETED",
      progressPercentage: 100,
      isDelayed: false,
    });
    expect(completed.completedAt).toBeTruthy();
    await c.patch<Milestone>(`/milestones/${milestone.id}/progress`, {
      progressPercentage: 35,
    });
    const reopened = await c.get<Milestone & { isDelayed: boolean }>(
      `/milestones/${milestone.id}`,
    );
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.completedAt).toBeNull();
    expect(reopened.isDelayed).toBe(true);
  });

  test("milestone creation validates blank names and inconsistent completion states", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    for (const data of [
      { milestoneName: "   ", weight: 1 },
      {
        milestoneName: unique("Bad state"),
        weight: 1,
        progressPercentage: 30,
        status: "PENDING",
      },
      {
        milestoneName: unique("Bad progress"),
        weight: 1,
        progressPercentage: 101,
      },
      { milestoneName: unique("Bad weight"), weight: -1 },
    ]) {
      const response = await c.request.post(
        url(`/projects/${project.id}/milestones`),
        { headers: c.headers, data },
      );
      expect(response.status(), await response.text()).toBe(400);
    }
    expect(
      (
        await c.request.get(url(`/milestones/${uuid()}`), {
          headers: c.headers,
        })
      ).status(),
    ).toBe(404);
  });

  test("independent project resources cannot be retrieved through another project's scope", async ({
    projectContext: c,
  }) => {
    const first = await c.createProject();
    const second = await c.createProject();
    const task = await c.createTask(first.id);
    const expense = await c.createExpense(first.id);
    const tasks = await c.get<{ data: Task[] }>(`/projects/${second.id}/tasks`);
    expect(tasks.data.find((item) => item.id === task.id)).toBeUndefined();
    const expenses = await c.get<{ data: { id: string }[] }>(
      `/projects/${second.id}/expenses`,
    );
    expect(
      expenses.data.find((item) => item.id === expense.id),
    ).toBeUndefined();
  });
});
