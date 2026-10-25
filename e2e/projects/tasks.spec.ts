import {
  test,
  expect,
  type Task,
  type Milestone,
  type PageResult,
  unique,
  url,
  uuid,
} from "./fixture";

test.describe("Tasks — project and milestone resources", () => {
  test("create, read, edit, reassign, update status and delete", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const milestone = await c.createMilestone(project.id);
    const task = await c.createTask(project.id, {
      milestoneId: milestone.id,
      assignedToId: c.adminId,
    });
    expect(task).toMatchObject({
      projectId: project.id,
      milestoneId: milestone.id,
      assignedToId: c.adminId,
      status: "TODO",
    });
    const newName = unique("Renamed task");
    await c.patch<Task>(`/tasks/${task.id}`, {
      taskName: newName,
      description: "Revised",
      dueDate: "2026-12-20T00:00:00.000Z",
    });
    expect((await c.get<Task>(`/tasks/${task.id}`)).taskName).toBe(newName);
    await c.patch<Task>(`/tasks/${task.id}/status`, { status: "IN_PROGRESS" });
    expect((await c.get<Task>(`/tasks/${task.id}`)).status).toBe("IN_PROGRESS");
    await c.patch<Task>(`/tasks/${task.id}/assign`, { assignedToId: null });
    expect((await c.get<Task>(`/tasks/${task.id}`)).assignedToId).toBeNull();
    await c.patch<Task>(`/tasks/${task.id}/status`, { status: "COMPLETED" });
    // Task completion must NOT automatically change milestone progress.
    expect(
      (await c.get<Milestone>(`/milestones/${milestone.id}`)).progressPercentage
    ).toBe(0);
    expect(
      (
        await c.request.delete(url(`/tasks/${task.id}`), { headers: c.headers })
      ).ok()
    ).toBeTruthy();
    expect(
      (
        await c.request.get(url(`/tasks/${task.id}`), { headers: c.headers })
      ).status()
    ).toBe(404);
  });

  test("global/project task listings use status, milestone, assignee, search and paging", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const milestone = await c.createMilestone(project.id);
    const prefix = unique("Filter task");
    await c.createTask(project.id, {
      taskName: `${prefix} A`,
      milestoneId: milestone.id,
      assignedToId: c.adminId,
    });
    await c.createTask(project.id, {
      taskName: `${prefix} B`,
      milestoneId: milestone.id,
      assignedToId: c.adminId,
    });
    await c.createTask(project.id, {
      taskName: unique("Different task"),
      status: "IN_PROGRESS",
    });
    for (const [page, suffix] of [
      [1, "A"],
      [2, "B"],
    ] as const) {
      const filter = {
        projectId: project.id,
        milestoneId: milestone.id,
        assignedToId: c.adminId,
        status: "TODO",
        search: prefix,
        page,
        limit: 1,
        sortBy: "taskName",
        sortOrder: "asc",
      };
      const global = await c.get<PageResult<Task>>("/tasks", filter);
      const scoped = await c.get<PageResult<Task>>(
        `/projects/${project.id}/tasks`,
        filter
      );
      for (const result of [global, scoped]) {
        expect(result.meta).toMatchObject({ total: 2, page, totalPages: 2 });
        expect(result.data[0].taskName).toBe(`${prefix} ${suffix}`);
      }
    }
    const assignees = await c.get<PageResult<{ id: string; fullName: string }>>(
      `/projects/${project.id}/task-assignees`,
      { page: 1, limit: 100 }
    );
    expect(assignees.data.some((user) => user.id === c.adminId)).toBeTruthy();
  });

  test("invalid task payloads and foreign milestone relationships are rejected", async ({
    projectContext: c,
  }) => {
    const first = await c.createProject();
    const second = await c.createProject();
    const foreignMilestone = await c.createMilestone(second.id);
    for (const payload of [
      { projectId: first.id, taskName: " " },
      {
        projectId: first.id,
        taskName: "Invalid status",
        status: "NOT_A_STATUS",
      },
      {
        projectId: first.id,
        taskName: "Foreign milestone",
        milestoneId: foreignMilestone.id,
      },
      {
        projectId: first.id,
        taskName: "Unknown assignee",
        assignedToId: uuid(),
      },
    ]) {
      const response = await c.request.post(url("/tasks"), {
        headers: c.headers,
        data: payload,
      });
      expect([400, 404], await response.text()).toContain(response.status());
    }
  });
});
