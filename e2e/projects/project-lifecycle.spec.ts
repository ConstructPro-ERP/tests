import {
  test,
  expect,
  url,
  unique,
  bearer,
  login,
  expectOk,
  uuid,
  type Project,
  type Milestone,
  type Task,
  type Expense,
} from "./fixture";

interface Quotation {
  id: string;
  leadId: string;
  projectId: string | null;
  status: string;
}
interface Conversion {
  quotation: Quotation;
  projectId: string;
  projectStatus: string;
}

/**
 * Quotation conversion has no supported DELETE endpoint. The projects created
 * here become ACTIVE, COMPLETED or CANCELLED and cannot be deleted either.
 * Consequently these are explicitly opt-in, persistent staging-only tests.
 * Reset the disposable staging database between lifecycle runs.
 */
test.describe("Project lifecycle — quotation conversion, closure and write locks", () => {
  test.beforeEach(() => {
    test.skip(
      process.env.E2E_ALLOW_PERSISTENT_LIFECYCLE_WRITES !== "true" ||
        !process.env.E2E_LEAD_ID,
      "Set E2E_ALLOW_PERSISTENT_LIFECYCLE_WRITES=true and a disposable E2E_LEAD_ID; this creates nondeletable staging records."
    );
  });

  test("quotation conversion activates a project; hold/resume/completion enforce milestones and closed-project locks", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const email =
      process.env.E2E_ADMIN_EMAIL?.trim() || process.env.E2E_USER_EMAIL!;
    const password =
      process.env.E2E_ADMIN_PASSWORD?.trim() || process.env.E2E_USER_PASSWORD!;
    const headers = bearer(await login(request, email, password));
    const me = await expectOk<{ id: string; role: string }>(
      await request.get(url("/auth/me"), { headers })
    );
    expect(me.role).toBe("ADMIN");

    const quotation = await expectOk<Quotation>(
      await request.post(url("/quotations"), {
        headers,
        data: {
          leadId: process.env.E2E_LEAD_ID!,
          status: "PENDING_APPROVAL",
          items: [
            {
              itemName: unique("Lifecycle foundation"),
              quantity: 1,
              unitPrice: 100,
            },
          ],
        },
      })
    );
    expect(quotation.status).toBe("PENDING_APPROVAL");
    const approved = await expectOk<Conversion>(
      await request.patch(url(`/quotations/${quotation.id}/approve`), {
        headers,
        data: {
          projectName: unique("Quotation-converted project"),
          projectManagerId: me.id,
          startDate: "2026-10-01T00:00:00.000Z",
          endDate: "2027-10-01T00:00:00.000Z",
        },
      })
    );
    expect(approved.quotation.status).toBe("CONVERTED");
    expect(approved.quotation.projectId).toBe(approved.projectId);
    expect(approved.projectStatus).toBe("ACTIVE");
    const path = `/projects/${approved.projectId}`;
    const getProject = async () =>
      expectOk<Project>(await request.get(url(path), { headers }));
    expect((await getProject()).status).toBe("ACTIVE");

    const duplicate = await request.patch(
      url(`/quotations/${quotation.id}/approve`),
      { headers, data: { projectName: unique("Duplicate") } }
    );
    expect(duplicate.status()).toBe(409);
    expect((await getProject()).status).toBe("ACTIVE");

    const noMilestones = await request.patch(url(`${path}/status`), {
      headers,
      data: { status: "COMPLETED" },
    });
    expect(noMilestones.status()).toBe(400);
    const hold = await request.patch(url(`${path}/status`), {
      headers,
      data: { status: "ON_HOLD" },
    });
    expect(hold.ok(), await hold.text()).toBeTruthy();
    expect((await getProject()).status).toBe("ON_HOLD");
    const resume = await request.patch(url(`${path}/status`), {
      headers,
      data: { status: "ACTIVE" },
    });
    expect(resume.ok(), await resume.text()).toBeTruthy();

    const milestone = await expectOk<Milestone>(
      await request.post(url(`${path}/milestones`), {
        headers,
        data: {
          milestoneName: unique("Lifecycle milestone"),
          weight: 5,
          progressPercentage: 50,
        },
      })
    );
    const task = await expectOk<Task>(
      await request.post(url("/tasks"), {
        headers,
        data: {
          projectId: approved.projectId,
          taskName: unique("Lifecycle task"),
          milestoneId: milestone.id,
        },
      })
    );
    const expense = await expectOk<Expense>(
      await request.post(url(`${path}/expenses`), {
        headers,
        data: { amount: "9.99", expenseDate: "2026-10-10T00:00:00.000Z" },
      })
    );
    expect((await getProject()).progressPercentage).toBe(50);
    const premature = await request.patch(url(`${path}/status`), {
      headers,
      data: { status: "COMPLETED" },
    });
    expect(premature.status()).toBe(400);
    expect((await getProject()).status).toBe("ACTIVE");
    await expectOk<Milestone>(
      await request.patch(url(`/milestones/${milestone.id}/progress`), {
        headers,
        data: { progressPercentage: 100 },
      })
    );
    expect((await getProject()).progressPercentage).toBe(100);
    const close = await request.patch(url(`${path}/status`), {
      headers,
      data: { status: "COMPLETED" },
    });
    expect(close.ok(), await close.text()).toBeTruthy();
    expect((await getProject()).status).toBe("COMPLETED");

    // Closed projects must block writes even when the caller is ADMIN.
    for (const [pathPart, data] of [
      [
        "/tasks",
        { projectId: approved.projectId, taskName: unique("Blocked") },
      ],
      [`${path}/milestones`, { milestoneName: unique("Blocked"), weight: 2 }],
      [
        `${path}/expenses`,
        { amount: "1.25", expenseDate: "2026-10-10T00:00:00.000Z" },
      ],
      [
        `${path}/documents/upload-authorizations`,
        {
          categoryId: uuid(),
          fileName: "blocked.dwg",
          mimeType: "application/octet-stream",
          fileSize: 16,
        },
      ],
    ] as const) {
      const response = await request.post(url(pathPart), { headers, data });
      expect(response.status(), `${pathPart}: ${await response.text()}`).toBe(
        409
      );
    }
    for (const [pathPart, data] of [
      [`/tasks/${task.id}`, { taskName: "Blocked edit" }],
      [`/tasks/${task.id}/status`, { status: "COMPLETED" }],
      [`/tasks/${task.id}/assign`, { assignedToId: null }],
      [`/milestones/${milestone.id}`, { milestoneName: "Blocked edit" }],
      [`/milestones/${milestone.id}/progress`, { progressPercentage: 50 }],
      [`/expenses/${expense.id}`, { amount: "2.00" }],
    ] as const) {
      const response = await request.patch(url(pathPart), { headers, data });
      expect(response.status(), `${pathPart}: ${await response.text()}`).toBe(
        409
      );
    }
    for (const pathPart of [
      `/tasks/${task.id}`,
      `/milestones/${milestone.id}`,
      `/expenses/${expense.id}`,
    ]) {
      const response = await request.delete(url(pathPart), { headers });
      expect(response.status(), `${pathPart}: ${await response.text()}`).toBe(
        409
      );
    }
    expect((await request.delete(url(path), { headers })).status()).toBe(409);
    expect(
      (
        await request.patch(url(`${path}/status`), {
          headers,
          data: { status: "ACTIVE" },
        })
      ).status()
    ).toBe(400);
    expect((await getProject()).status).toBe("COMPLETED");
  });

  test("planning project can be cancelled; terminal status rejects further changes", async ({
    request,
  }) => {
    const email =
      process.env.E2E_ADMIN_EMAIL?.trim() || process.env.E2E_USER_EMAIL!;
    const password =
      process.env.E2E_ADMIN_PASSWORD?.trim() || process.env.E2E_USER_PASSWORD!;
    const headers = bearer(await login(request, email, password));
    const me = await expectOk<{ id: string; role: string }>(
      await request.get(url("/auth/me"), { headers })
    );
    expect(me.role).toBe("ADMIN");
    const project = await expectOk<Project>(
      await request.post(url("/projects"), {
        headers,
        data: {
          projectName: unique("Cancellation lifecycle"),
          projectManagerId: me.id,
          startDate: "2026-10-01T00:00:00.000Z",
        },
      })
    );
    const cancel = await request.patch(url(`/projects/${project.id}/status`), {
      headers,
      data: { status: "CANCELLED" },
    });
    expect(cancel.ok(), await cancel.text()).toBeTruthy();
    expect(
      (
        await expectOk<Project>(
          await request.get(url(`/projects/${project.id}`), { headers })
        )
      ).status
    ).toBe("CANCELLED");
    expect(
      (
        await request.patch(url(`/projects/${project.id}/status`), {
          headers,
          data: { status: "ACTIVE" },
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await request.delete(url(`/projects/${project.id}`), { headers })
      ).status()
    ).toBe(409);
    expect(
      (
        await request.post(url(`/projects/${project.id}/expenses`), {
          headers,
          data: { amount: "1.01", expenseDate: "2026-10-10T00:00:00.000Z" },
        })
      ).status()
    ).toBe(409);
  });
});
