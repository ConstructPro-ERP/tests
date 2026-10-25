import {
  test,
  expect,
  url,
  type Project,
  type Milestone,
  type Expense,
} from "./fixture";

// Real database consistency across simultaneous API requests. Responses may
// legitimately be 200 or 409 if a transaction detects a conflicting update.
test.describe("Project resources — concurrent modification integrity", () => {
  test("concurrent milestone progress requests leave project and milestone progress consistent", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const milestone = await c.createMilestone(project.id, { weight: 7 });
    const responses = await Promise.all(
      [25, 75].map((progressPercentage) =>
        c.request.patch(url(`/milestones/${milestone.id}/progress`), {
          headers: c.headers,
          data: { progressPercentage },
        }),
      ),
    );
    for (const response of responses) {
      expect([200, 409], await response.text()).toContain(response.status());
    }
    expect(responses.some((response) => response.ok())).toBe(true);
    const savedMilestone = await c.get<Milestone>(
      `/milestones/${milestone.id}`,
    );
    const savedProject = await c.get<Project>(`/projects/${project.id}`);
    expect([25, 75]).toContain(savedMilestone.progressPercentage);
    expect(savedProject.progressPercentage).toBeCloseTo(
      savedMilestone.progressPercentage,
      6,
    );
    expect(savedMilestone.status).toBe("IN_PROGRESS");
  });

  test("concurrent expense inserts preserve exact decimal total and distinct records", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const writes = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        c.request.post(url(`/projects/${project.id}/expenses`), {
          headers: c.headers,
          data: {
            amount: "0.10",
            category: "CONCURRENCY",
            description: `E2E concurrent ${i}`,
            expenseDate: "2026-10-10T00:00:00.000Z",
          },
        }),
      ),
    );
    const identifiers: string[] = [];
    for (const response of writes) {
      expect(response.status(), await response.text()).toBe(201);
      const json = (await response.json()) as { data?: Expense; id?: string };
      const id = json.data?.id ?? json.id;
      expect(id).toBeTruthy();
      identifiers.push(id!);
      c.track("expense", id!);
    }
    expect(new Set(identifiers).size).toBe(5);
    const summary = await c.get<{
      total: string;
      byCategory: Array<{ category: string; amount: string }>;
    }>(`/projects/${project.id}/expenses/summary`);
    expect(summary.total).toBe("0.50");
    expect(summary.byCategory).toContainEqual(
      expect.objectContaining({ category: "CONCURRENCY", amount: "0.50" }),
    );
  });
});
