import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { apiBaseUrl, bearer, expectOk } from "../support/api";
import { savedHeaders } from "../support/auth-state";

export interface Project {
  id: string;
  projectName: string;
  projectManagerId: string;
  status: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
  progressPercentage: number;
  location?: string | null;
  budget?: number | string | null;
}
export interface Milestone {
  id: string;
  projectId: string;
  milestoneName: string;
  weight: number;
  progressPercentage: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  completedAt?: string | null;
}
export interface Task {
  id: string;
  projectId: string;
  taskName: string;
  milestoneId: string | null;
  assignedToId: string | null;
  status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
}
export interface Expense {
  id: string;
  projectId: string;
  amount: string;
  category: string | null;
  description: string | null;
  recordedById: string;
  recordedBy: { id: string; fullName: string };
}
export interface PageResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface ProjectContext {
  request: APIRequestContext;
  headers: ReturnType<typeof bearer>;
  adminId: string;
  get<T>(path: string, params?: Record<string, string | number>): Promise<T>;
  post<T>(path: string, data: Record<string, unknown>): Promise<T>;
  patch<T>(path: string, data: Record<string, unknown>): Promise<T>;
  createProject(overrides?: Record<string, unknown>): Promise<Project>;
  createMilestone(
    projectId: string,
    overrides?: Record<string, unknown>,
  ): Promise<Milestone>;
  createTask(
    projectId: string,
    overrides?: Record<string, unknown>,
  ): Promise<Task>;
  createExpense(
    projectId: string,
    overrides?: Record<string, unknown>,
  ): Promise<Expense>;
  track(kind: "task" | "milestone" | "expense" | "project", id: string): void;
}

export const unique = (label: string) => `E2E ${label} ${randomUUID()}`;
export const url = (path: string) => `${apiBaseUrl()}${path}`;
export const uuid = () => randomUUID();

// This fixture is intentionally destructive only to records it created.
// Run against an isolated E2E environment, never against production.
export const test = base.extend<{ projectContext: ProjectContext }>({
  projectContext: async ({ request }, use) => {
    const headers = savedHeaders("projects", "admin");
    const me = await expectOk<{ id: string; role: string }>(
      await request.get(url("/auth/me"), { headers }),
    );
    expect(me.role, "Project E2E requires an ADMIN credential pair").toBe(
      "ADMIN",
    );
    expect(me.id).toMatch(/^[0-9a-f-]{36}$/i);

    const created: Array<{
      path: string;
      kind: "task" | "milestone" | "expense" | "project";
    }> = [];
    async function checked<T>(
      response: APIResponse | Promise<APIResponse>,
    ): Promise<T> {
      return expectOk<T>(await response);
    }
    const context: ProjectContext = {
      track(kind, id) {
        created.push({
          kind,
          path: `/${kind === "milestone" ? "milestones" : kind === "expense" ? "expenses" : kind === "project" ? "projects" : "tasks"}/${id}`,
        });
      },
      request,
      headers,
      adminId: me.id,
      get: (path, params) =>
        checked(request.get(url(path), { headers, params })),
      post: (path, data) => checked(request.post(url(path), { headers, data })),
      patch: (path, data) =>
        checked(request.patch(url(path), { headers, data })),
      async createProject(overrides = {}) {
        const result = await context.post<Project>("/projects", {
          projectName: unique("Project"),
          location: "Colombo",
          startDate: "2026-10-01T00:00:00.000Z",
          endDate: "2027-10-01T00:00:00.000Z",
          budget: 100000,
          projectManagerId: me.id, // ADMIN is a valid project manager in the backend policy.
          ...overrides,
        });
        context.track("project", result.id);
        return result;
      },
      async createMilestone(projectId, overrides = {}) {
        const result = await context.post<Milestone>(
          `/projects/${projectId}/milestones`,
          {
            milestoneName: unique("Milestone"),
            weight: 5,
            ...overrides,
          },
        );
        context.track("milestone", result.id);
        return result;
      },
      async createTask(projectId, overrides = {}) {
        const result = await context.post<Task>("/tasks", {
          projectId,
          taskName: unique("Task"),
          ...overrides,
        });
        context.track("task", result.id);
        return result;
      },
      async createExpense(projectId, overrides = {}) {
        const result = await context.post<Expense>(
          `/projects/${projectId}/expenses`,
          {
            amount: "123.45",
            category: "MATERIAL",
            expenseDate: "2026-10-10T00:00:00.000Z",
            ...overrides,
          },
        );
        context.track("expense", result.id);
        return result;
      },
    };

    await use(context);

    // Sweep resources belonging to fixture-created projects. Browser tests and
    // alternate-role API tests can successfully create records before an
    // assertion fails; those records would otherwise not be tracked here.
    // No other projects are ever swept.
    const errors: string[] = [];
    const projectIds = created
      .filter((item) => item.kind === "project")
      .map((item) => item.path.slice("/projects/".length));
    async function sweep(
      projectId: string,
      resource: "task" | "expense" | "milestone",
    ) {
      const listPath =
        resource === "task"
          ? `/projects/${projectId}/tasks`
          : resource === "expense"
            ? `/projects/${projectId}/expenses`
            : `/projects/${projectId}/milestones`;
      const prefix =
        resource === "task"
          ? "/tasks/"
          : resource === "expense"
            ? "/expenses/"
            : "/milestones/";
      try {
        for (let batch = 0; batch < 5; batch += 1) {
          const response = await request.get(url(listPath), {
            headers,
            ...(resource !== "milestone"
              ? { params: { page: 1, limit: 100 } }
              : {}),
          });
          if (!response.ok()) {
            errors.push(
              `${listPath}: cleanup listing HTTP ${response.status()}`,
            );
            break;
          }
          const items =
            resource === "milestone"
              ? await checked<Milestone[]>(response)
              : (await checked<PageResult<{ id: string }>>(response)).data;
          if (items.length === 0) break;
          let failed = false;
          for (const item of items) {
            const path = `${prefix}${item.id}`;
            const deletion = await request.delete(url(path), { headers });
            if (!deletion.ok() && deletion.status() !== 404) {
              errors.push(`${path}: cleanup HTTP ${deletion.status()}`);
              failed = true;
            }
          }
          if (failed || resource === "milestone") break;
        }
      } catch (error) {
        errors.push(`${listPath}: ${String(error)}`);
      }
    }
    for (const projectId of projectIds) {
      try {
        const projectResponse = await request.get(
          url(`/projects/${projectId}`),
          { headers },
        );

        // The test may have already deleted this project.
        if (projectResponse.status() === 404) {
          continue;
        }

        if (!projectResponse.ok()) {
          errors.push(
            `/projects/${projectId}: cleanup existence check HTTP ${projectResponse.status()}`,
          );
          continue;
        }
      } catch (error) {
        errors.push(
          `/projects/${projectId}: cleanup existence check failed: ${String(error)}`,
        );
        continue;
      }

      await sweep(projectId, "task");
      await sweep(projectId, "expense");
      await sweep(projectId, "milestone");
    }

    // Delete tracked records and projects in dependency order. A 404 is safe:
    // it indicates the test or sweep already deleted the same record.
    for (const kind of ["task", "expense", "milestone", "project"] as const) {
      for (const item of [...created]
        .reverse()
        .filter((entry) => entry.kind === kind)) {
        try {
          const response = await request.delete(url(item.path), { headers });
          if (!response.ok() && response.status() !== 404) {
            errors.push(
              `${item.path}: HTTP ${response.status()} ${await response.text()}`,
            );
          }
        } catch (error) {
          errors.push(`${item.path}: ${String(error)}`);
        }
      }
    }
    expect(
      errors,
      "E2E data cleanup failed; inspect isolated test environment",
    ).toEqual([]);
  },
});

export { expect, expectOk };
