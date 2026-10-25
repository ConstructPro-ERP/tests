import {
  test,
  expect,
  bearer,
  expectOk,
  login,
  url,
  type Project,
  type Task,
  type Milestone,
} from "./fixture";

// Requires a disposable, ACTIVE Project Manager account. Manager authorization
// is checked both for an owned project and one assigned to a different user.
test.describe("Project Manager — assigned and unassigned project permissions", () => {
  test("assigned manager can manage project, milestones and tasks, but not expenses or manager assignments", async ({
    request,
    projectContext: c,
  }) => {
    const email = process.env.E2E_PROJECT_MANAGER_EMAIL;
    const password = process.env.E2E_PROJECT_MANAGER_PASSWORD;
    test.skip(
      !email || !password,
      "Configure E2E_PROJECT_MANAGER_EMAIL and E2E_PROJECT_MANAGER_PASSWORD."
    );
    const manager = bearer(await login(request, email!, password!));
    const me = await expectOk<{ id: string; role: string }>(
      await request.get(url("/auth/me"), { headers: manager })
    );
    expect(me.role).toBe("PROJECT_MANAGER");
    const assigned = await c.createProject({ projectManagerId: me.id });
    const foreign = await c.createProject();
    expect(
      (
        await request.get(url(`/projects/${assigned.id}`), { headers: manager })
      ).status()
    ).toBe(200);
    expect(
      (
        await request.get(url(`/projects/${foreign.id}`), { headers: manager })
      ).status()
    ).toBe(403);
    const updatedName = `Manager update ${assigned.id}`;
    const change = await request.patch(url(`/projects/${assigned.id}`), {
      headers: manager,
      data: { projectName: updatedName },
    });
    expect(change.ok(), await change.text()).toBeTruthy();
    expect((await c.get<Project>(`/projects/${assigned.id}`)).projectName).toBe(
      updatedName
    );
    const createdMilestone = await expectOk<Milestone>(
      await request.post(url(`/projects/${assigned.id}/milestones`), {
        headers: manager,
        data: { milestoneName: "Manager milestone", weight: 3 },
      })
    );
    c.track("milestone", createdMilestone.id);
    const createdTask = await expectOk<Task>(
      await request.post(url("/tasks"), {
        headers: manager,
        data: {
          projectId: assigned.id,
          taskName: "Manager task",
          milestoneId: createdMilestone.id,
        },
      })
    );
    c.track("task", createdTask.id);
    try {
      expect(
        (
          await request.get(url(`/milestones/${createdMilestone.id}`), {
            headers: manager,
          })
        ).status()
      ).toBe(200);
      expect(
        (
          await request.get(url(`/tasks/${createdTask.id}`), {
            headers: manager,
          })
        ).status()
      ).toBe(200);
      for (const [path, data] of [
        [`/projects/${assigned.id}/manager`, { projectManagerId: c.adminId }],
        [
          `/projects/${assigned.id}/expenses`,
          { amount: "1.00", expenseDate: "2026-10-10T00:00:00.000Z" },
        ],
        ["/document-categories", { categoryName: "Forbidden" }],
      ] as const) {
        const response = path.endsWith("/manager")
          ? await request.patch(url(path), { headers: manager, data })
          : await request.post(url(path), { headers: manager, data });
        expect(response.status(), `${path}: ${await response.text()}`).toBe(
          403
        );
      }
      const forbidden = await request.patch(url(`/projects/${foreign.id}`), {
        headers: manager,
        data: { projectName: "Unauthorized" },
      });
      expect(forbidden.status()).toBe(403);
      const list = await expectOk<{ data: Project[] }>(
        await request.get(url("/projects"), {
          headers: manager,
          params: { limit: 100 },
        })
      );
      expect(list.data.some((p) => p.id === assigned.id)).toBe(true);
      expect(list.data.some((p) => p.id === foreign.id)).toBe(false);
    } finally {
      // Cleanup using Admin, since the fixture only tracks resources created
      // through its own helpers.
      expect(
        (
          await request.delete(url(`/tasks/${createdTask.id}`), {
            headers: c.headers,
          })
        ).ok()
      ).toBeTruthy();
      expect(
        (
          await request.delete(url(`/milestones/${createdMilestone.id}`), {
            headers: c.headers,
          })
        ).ok()
      ).toBeTruthy();
    }
  });
});
