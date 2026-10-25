import {
  test,
  expect,
  unique,
  url,
  bearer,
  login,
  expectOk,
  type PageResult,
  type Project,
  type Milestone,
  type Task,
  type Expense,
} from "./fixture";
import { loginAdminUI } from "../support/management";

test.describe("Project UI — real frontend and gateway smoke", () => {
  test("project list and every project resource tab render for an Admin", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(
      !process.env.FRONTEND_BASE_URL,
      "Set FRONTEND_BASE_URL to run browser E2E."
    );
    const project = await c.createProject();
    await loginAdminUI(page);
    await page.goto("/dashboard/projects");
    await expect(
      page.getByRole("heading", { name: "Project Management" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create project" })
    ).toBeVisible();
    await page.goto(`/dashboard/projects/${project.id}`);
    await expect(
      page.getByRole("heading", { name: project.projectName })
    ).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    for (const section of [
      "Overview",
      "Milestones",
      "Tasks",
      "Calendar",
      "Expenses",
      "Documents",
    ]) {
      await tabs.getByRole("button", { name: section, exact: true }).click();
      await expect(
        tabs.getByRole("button", { name: section, exact: true })
      ).toHaveAttribute("aria-current", "page");
    }
  });

  test("Admin can create and edit a project using the browser", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const name = unique("Browser-created project");
    await loginAdminUI(page);
    await page.goto("/dashboard/projects");
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create project" });
    await dialog.getByLabel(/Project name/).fill(name);
    await dialog.getByLabel(/Start date/).fill("2026-10-01");
    await dialog.getByLabel(/End date/).fill("2027-10-01");
    await dialog.getByLabel(/Project manager/).selectOption(c.adminId);
    let created: Project | undefined;
    try {
      await dialog
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      const list = await c.get<PageResult<Project>>("/projects", {
        search: name,
        limit: 20,
      });
      created = list.data.find((row) => row.projectName === name);
      expect(
        created,
        "Created project should appear in the backend"
      ).toBeDefined();
      await page.goto(`/dashboard/projects/${created!.id}`);
      await page.getByRole("button", { name: "Edit project" }).click();
      const edit = page.getByRole("dialog", { name: "Edit project" });
      await edit.getByLabel(/Project name/).fill(`${name} edited`);
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(edit).not.toBeVisible();
      await expect(
        page.getByRole("heading", { name: `${name} edited` })
      ).toBeVisible();
      expect(
        (await c.get<Project>(`/projects/${created!.id}`)).projectName
      ).toBe(`${name} edited`);
    } finally {
      // If UI creation succeeded but the first read failed, search again before cleanup.
      if (!created) {
        const list = await c.get<PageResult<Project>>("/projects", {
          search: name,
          limit: 20,
        });
        created = list.data.find((row) => row.projectName.startsWith(name));
      }
      if (created) {
        const deleted = await c.request.delete(url(`/projects/${created.id}`), {
          headers: c.headers,
        });
        expect(deleted.ok(), await deleted.text()).toBeTruthy();
      }
    }
  });

  test("Milestone progress updates in browser and persists to project progress", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    const milestone = await c.createMilestone(project.id, { weight: 5 });
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Milestones" })
      .click();
    await expect(
      page.getByText(milestone.milestoneName, { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Update milestone progress",
    });
    await dialog.getByLabel(/Progress \(\%\)/).fill("35");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (await c.get<Milestone>(`/milestones/${milestone.id}`))
            .progressPercentage
      )
      .toBe(35);
    await expect
      .poll(
        async () =>
          (await c.get<Project>(`/projects/${project.id}`)).progressPercentage
      )
      .toBe(35);
  });

  test("Task metadata is editable through its project tab", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    const task = await c.createTask(project.id);
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Tasks" })
      .click();
    await expect(page.getByText(task.taskName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit task" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    const updated = unique("Browser-edited task");
    await dialog.getByLabel(/Task name/).fill(updated);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(async () => (await c.get<Task>(`/tasks/${task.id}`)).taskName)
      .toBe(updated);
  });

  test("Expense amount can be edited in the browser and remains attributed to creator", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    const expense = await c.createExpense(project.id);
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Expenses" })
      .click();
    await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
    await page.getByRole("button", { name: "Edit expense" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit expense" });
    await dialog.getByLabel(/Amount \(LKR\)/).fill("222.22");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(
        async () => (await c.get<Expense>(`/expenses/${expense.id}`)).amount
      )
      .toBe("222.22");
    expect((await c.get<Expense>(`/expenses/${expense.id}`)).recordedById).toBe(
      c.adminId
    );
  });
});

test.describe("Project UI — browser validation and resource creation/deletion", () => {
  test("project creation prevents submitting an empty required name", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    await loginAdminUI(page);
    await page.goto("/dashboard/projects");
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create project" });
    await dialog.getByLabel(/Start date/).fill("2026-10-01");
    await dialog.getByLabel(/Project manager/).selectOption(c.adminId);
    await dialog
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/Project name/)).toHaveAttribute(
      "required",
      ""
    );
  });

  test("browser creates and deletes a milestone, reflected in backend", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Milestones" })
      .click();
    await page.getByRole("button", { name: "Add milestone" }).click();
    const dialog = page.getByRole("dialog", { name: "Add milestone" });
    const name = unique("Browser milestone");
    await dialog.getByLabel("Milestone name").fill(name);
    await dialog.getByLabel(/Weight/).fill("3");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    const rows = await c.get<Milestone[]>(`/projects/${project.id}/milestones`);
    const record = rows.find((m) => m.milestoneName === name);
    expect(record).toBeDefined();
    c.track("milestone", record!.id);
    // Delete through UI, not the request client; the fixture cleans up after a failure.
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Delete" })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Delete milestone?",
    });
    await confirmation
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect
      .poll(async () =>
        (await c.get<Milestone[]>(`/projects/${project.id}/milestones`)).some(
          (m) => m.id === record!.id
        )
      )
      .toBe(false);
  });

  test("browser task creation, filtering and deletion use project-scoped API", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Tasks" })
      .click();
    await page.getByRole("button", { name: "Add task" }).click();
    const dialog = page.getByRole("dialog", { name: "Add task" });
    const name = unique("Browser task");
    await dialog.getByLabel("Task name").fill(name);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    const rows = await c.get<PageResult<Task>>(
      `/projects/${project.id}/tasks`,
      { search: name, limit: 100 }
    );
    const task = rows.data.find((task) => task.taskName === name);
    expect(task).toBeDefined();
    c.track("task", task!.id);
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Delete" })
      .click();
    const confirmation = page.getByRole("dialog", { name: "Delete task?" });
    await confirmation
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await c.get<PageResult<Task>>(`/projects/${project.id}/tasks`, {
              search: name,
            })
          ).meta.total
      )
      .toBe(0);
  });

  test("browser expense creation updates summary and deletion restores total", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Expenses" })
      .click();
    await page.getByRole("button", { name: "Add expense" }).click();
    const dialog = page.getByRole("dialog", { name: "Add expense" });
    await dialog.getByLabel(/Amount \(LKR\)/).fill("8.75");
    await dialog.getByLabel("Expense date").fill("2026-10-10");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await c.get<{ total: string }>(
              `/projects/${project.id}/expenses/summary`
            )
          ).total
      )
      .toBe("8.75");
    const added = await c.get<PageResult<Expense>>(
      `/projects/${project.id}/expenses`,
      { limit: 20 }
    );
    expect(added.data).toHaveLength(1);
    c.track("expense", added.data[0].id);
    await page
      .getByRole("row")
      .filter({ hasText: "8.75" })
      .getByRole("button", { name: "Delete" })
      .click();
    const confirmation = page.getByRole("dialog", { name: "Delete expense?" });
    await confirmation
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await c.get<{ total: string }>(
              `/projects/${project.id}/expenses/summary`
            )
          ).total
      )
      .toBe("0.00");
  });

  test("calendar tab shows a useful connection state without performing third-party writes", async ({
    page,
    projectContext: c,
  }) => {
    test.skip(!process.env.FRONTEND_BASE_URL, "Set FRONTEND_BASE_URL.");
    const project = await c.createProject();
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Calendar" })
      .click();
    await expect(
      page.getByRole("region", { name: "Project calendar" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Project calendar" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh calendar" })
    ).toBeVisible();
  });
});

test.describe("Project documents — browser workflow with dedicated storage fixture", () => {
  test("browser uploads, edits, prepares download, and deletes a small project document", async ({
    page,
    projectContext: c,
  }) => {
    test.setTimeout(180_000);
    test.skip(
      !process.env.FRONTEND_BASE_URL ||
        process.env.E2E_ENABLE_DOCUMENT_UPLOADS !== "true" ||
        !process.env.E2E_DOCUMENT_PROJECT_ID ||
        !process.env.E2E_DOCUMENT_CATEGORY_ID,
      "Requires FRONTEND_BASE_URL, E2E_ENABLE_DOCUMENT_UPLOADS=true and disposable E2E_DOCUMENT_PROJECT_ID / E2E_DOCUMENT_CATEGORY_ID."
    );
    const projectId = process.env.E2E_DOCUMENT_PROJECT_ID!;
    const categoryId = process.env.E2E_DOCUMENT_CATEGORY_ID!;
    const fileName = `${unique("browser").replaceAll(" ", "-")}.txt`;
    const editedName = `revised-${fileName}`;
    let documentId: string | undefined;
    await loginAdminUI(page);
    await page.goto(`/dashboard/projects/${projectId}`);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Documents" })
      .click();
    try {
      await page.getByRole("button", { name: "Upload document" }).click();
      const upload = page.getByRole("dialog", {
        name: "Upload project document",
      });
      await upload.getByLabel(/File/).setInputFiles({
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from("ConstructPro E2E browser fixture\n"),
      });
      await upload.getByLabel(/Category/).selectOption(categoryId);
      await upload.getByRole("button", { name: "Upload document" }).click();
      await expect(upload).not.toBeVisible({ timeout: 90_000 });
      const list = await c.get<PageResult<{ id: string; fileName: string }>>(
        `/projects/${projectId}/documents`,
        {
          search: fileName,
          limit: 100,
        }
      );
      const record = list.data.find((item) => item.fileName === fileName);
      expect(record).toBeDefined();
      documentId = record!.id;
      const row = page.getByRole("row").filter({ hasText: fileName });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog", { name: "Edit document details" });
      await edit.getByLabel("File name").fill(editedName);
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(edit).not.toBeVisible();
      const editedRow = page.getByRole("row").filter({ hasText: editedName });
      await expect(editedRow).toBeVisible();
      await editedRow.getByRole("button", { name: "Download" }).click();
      const download = page.getByRole("dialog", { name: "Download document" });
      await expect(
        download.getByRole("link", { name: "Download file" })
      ).toHaveAttribute("href", /^https:\/\//);
      await download.getByRole("button", { name: "Close dialog" }).click();
      await editedRow.getByRole("button", { name: "Delete" }).click();
      const confirm = page.getByRole("dialog", { name: "Delete document?" });
      await confirm.getByRole("button", { name: "Delete permanently" }).click();
      await expect(confirm).not.toBeVisible();
      await expect
        .poll(async () =>
          (
            await c.request.get(url(`/documents/${documentId}`), {
              headers: c.headers,
            })
          ).status()
        )
        .toBe(404);
      documentId = undefined;
    } finally {
      if (!documentId) {
        // If the frontend completed the upload but an assertion failed before
        // reading its ID, resolve the uniquely named record for cleanup.
        const list = await c.get<PageResult<{ id: string; fileName: string }>>(
          `/projects/${projectId}/documents`,
          { search: fileName, limit: 100 }
        );
        documentId = list.data.find(
          (item) => item.fileName === fileName || item.fileName === editedName
        )?.id;
      }
      if (documentId) {
        const deleted = await c.request.delete(
          url(`/documents/${documentId}`),
          { headers: c.headers }
        );
        expect(deleted.ok(), await deleted.text()).toBeTruthy();
      }
    }
  });
});

test.describe("Project UI — role-specific permissions", () => {
  test("Accountant sees read-only task/milestone/document controls and may add expenses", async ({
    page,
    projectContext: c,
  }) => {
    const email = process.env.E2E_ACCOUNTANT_EMAIL;
    const password = process.env.E2E_ACCOUNTANT_PASSWORD;
    test.skip(
      !process.env.FRONTEND_BASE_URL || !email || !password,
      "Requires FRONTEND_BASE_URL and Accountant credentials."
    );
    const project = await c.createProject();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/modules(?:[/?#]|$)/);
    await page.goto(`/dashboard/projects/${project.id}`);
    await expect(
      page.getByRole("heading", { name: project.projectName })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit project" })
    ).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    for (const section of ["Tasks", "Milestones"]) {
      await tabs.getByRole("button", { name: section }).click();
      await expect(
        page.getByRole("button", {
          name: `Add ${section === "Tasks" ? "task" : "milestone"}`,
        })
      ).toHaveCount(0);
    }
    await tabs.getByRole("button", { name: "Documents" }).click();
    await expect(
      page.getByRole("button", { name: "Upload document" })
    ).toHaveCount(0);
    await tabs.getByRole("button", { name: "Expenses" }).click();
    await expect(
      page.getByRole("button", { name: "Add expense" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true })
    ).toHaveCount(0);
  });

  test("assigned Project Manager can manage tasks and milestones through the UI", async ({
    page,
    request,
    projectContext: c,
  }) => {
    const email = process.env.E2E_PROJECT_MANAGER_EMAIL;
    const password = process.env.E2E_PROJECT_MANAGER_PASSWORD;
    test.skip(
      !process.env.FRONTEND_BASE_URL || !email || !password,
      "Requires FRONTEND_BASE_URL and Project Manager credentials."
    );
    const token = await login(request, email!, password!);
    const me = await expectOk<{ id: string; role: string }>(
      await request.get(url("/auth/me"), { headers: bearer(token) })
    );
    expect(me.role).toBe("PROJECT_MANAGER");
    const project = await c.createProject({ projectManagerId: me.id });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/modules(?:[/?#]|$)/);
    await page.goto(`/dashboard/projects/${project.id}`);
    await expect(
      page.getByRole("heading", { name: project.projectName })
    ).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    await tabs.getByRole("button", { name: "Milestones" }).click();
    await expect(
      page.getByRole("button", { name: "Add milestone" })
    ).toBeVisible();
    await tabs.getByRole("button", { name: "Tasks" }).click();
    await expect(page.getByRole("button", { name: "Add task" })).toBeVisible();
    await tabs.getByRole("button", { name: "Expenses" }).click();
    await expect(page.getByRole("button", { name: "Add expense" })).toHaveCount(
      0
    );
  });
});
