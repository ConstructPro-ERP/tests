import {
  test,
  expect,
  type Milestone,
  type Project,
  type Task,
  unique,
  url,
} from "./fixture";

test.describe("Milestones — CRUD, weighted progress and constraints", () => {
  test("milestone metadata CRUD, progress transitions and project weighting", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const a = await c.createMilestone(project.id, {
      weight: 2,
      progressPercentage: 100,
    });
    const b = await c.createMilestone(project.id, {
      weight: 8,
      progressPercentage: 50,
    });
    expect(
      (await c.get<Milestone[]>(`/projects/${project.id}/milestones`)).map(
        (m) => m.id
      )
    ).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(60, 6);
    const renamed = unique("Milestone updated");
    await c.patch<Milestone>(`/milestones/${b.id}`, {
      milestoneName: renamed,
      weight: 6,
      description: "Revised scope",
    });
    expect(await c.get<Milestone>(`/milestones/${b.id}`)).toMatchObject({
      milestoneName: renamed,
      weight: 6,
    });
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(62.5, 6);
    await c.patch<Milestone>(`/milestones/${b.id}/progress`, {
      progressPercentage: 100,
    });
    expect((await c.get<Milestone>(`/milestones/${b.id}`)).status).toBe(
      "COMPLETED"
    );
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(100, 6);
    const reset = await c.patch<Milestone>(`/milestones/${b.id}/progress`, {
      progressPercentage: 0,
    });
    expect(reset.status).toBe("PENDING");
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBeCloseTo(25, 6);
  });

  test("weight and progress invalid values are rejected without mutations", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    for (const weight of [0, 11, 2.5]) {
      const response = await c.request.post(
        url(`/projects/${project.id}/milestones`),
        {
          headers: c.headers,
          data: { milestoneName: unique("Invalid"), weight },
        }
      );
      expect(response.status()).toBe(400);
    }
    const milestone = await c.createMilestone(project.id);
    for (const data of [
      { progressPercentage: -1 },
      { progressPercentage: 101 },
      { progressPercentage: 100, status: "IN_PROGRESS" },
      { progressPercentage: 40, status: "PENDING" },
    ]) {
      const response = await c.request.patch(
        url(`/milestones/${milestone.id}/progress`),
        { headers: c.headers, data }
      );
      expect(response.status()).toBe(400);
    }
    expect(
      (await c.get<Milestone>(`/milestones/${milestone.id}`)).progressPercentage
    ).toBe(0);
  });

  test("deletion is blocked while tasks reference milestone; removal recalculates project progress", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const milestone = await c.createMilestone(project.id, {
      weight: 5,
      progressPercentage: 80,
    });
    const task = await c.createTask(project.id, { milestoneId: milestone.id });
    const blocked = await c.request.delete(url(`/milestones/${milestone.id}`), {
      headers: c.headers,
    });
    expect(blocked.status()).toBe(409);
    expect((await c.get<Task>(`/tasks/${task.id}`)).milestoneId).toBe(
      milestone.id
    );
    await c.patch<Task>(`/tasks/${task.id}`, { milestoneId: null });
    const deleted = await c.request.delete(url(`/milestones/${milestone.id}`), {
      headers: c.headers,
    });
    expect(deleted.ok()).toBeTruthy();
    expect(
      (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
    ).toBe(0);
  });
});
