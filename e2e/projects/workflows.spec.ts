import {
  test,
  expect,
  type Milestone,
  type Project,
  type Task,
  type Expense,
  url,
} from "./fixture";

test.describe("Project management — cross-module integration", () => {
  test("Project -> milestones -> tasks -> expenses stays consistent", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const foundation = await c.createMilestone(project.id, {
      weight: 3,
      progressPercentage: 30,
    });
    const finishing = await c.createMilestone(project.id, {
      weight: 7,
      progressPercentage: 0,
    });
    const task = await c.createTask(project.id, { milestoneId: foundation.id });
    const expense = await c.createExpense(project.id, {
      amount: "99.99",
      category: "MATERIAL",
    });

    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(9, 5);
    expect((await c.get<Task>(`/tasks/${task.id}`)).milestoneId).toBe(
      foundation.id
    );
    expect((await c.get<Expense>(`/expenses/${expense.id}`)).projectId).toBe(
      project.id
    );
    await c.patch<Task>(`/tasks/${task.id}/status`, { status: "COMPLETED" });
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(9, 5);
    await c.patch<Milestone>(`/milestones/${foundation.id}/progress`, {
      progressPercentage: 100,
    });
    await c.patch<Milestone>(`/milestones/${finishing.id}/progress`, {
      progressPercentage: 100,
    });
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(100, 5);
    // A PLANNING project with 100% calculated progress is not automatically completed.
    expect((await c.get<Project>(`/projects/${project.id}`)).status).toBe(
      "PLANNING"
    );
    // Even with 100% progress, a planning project cannot jump straight to COMPLETED.
    expect(
      (
        await c.request.patch(url(`/projects/${project.id}/status`), {
          headers: c.headers,
          data: { status: "COMPLETED" },
        })
      ).status()
    ).toBe(400);
  });

  test("bad task-to-milestone relationships never affect progress", async ({
    projectContext: c,
  }) => {
    const first = await c.createProject();
    const second = await c.createProject();
    const milestone = await c.createMilestone(second.id, {
      weight: 4,
      progressPercentage: 80,
    });
    const response = await c.request.post(url("/tasks"), {
      headers: c.headers,
      data: {
        projectId: first.id,
        taskName: "Cross-project forbidden",
        milestoneId: milestone.id,
      },
    });
    expect([400, 404], await response.text()).toContain(response.status());
    expect(
      (await c.get<Project>(`/projects/${first.id}`)).progressPercentage
    ).toBe(0);
    expect(
      (await c.get<Project>(`/projects/${second.id}`)).progressPercentage
    ).toBeCloseTo(80, 6);
  });
});
