import { expect, test } from "@playwright/test";
import { apiBaseUrl, bearer, expectOk, login, requiredEnv } from "./support/api";

interface PortalPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PortalProject {
  id: string;
  projectName: string;
  status: string;
  progressPercentage: number;
}

interface PortalDocument {
  id: string;
  projectId: string;
  originalName: string;
  mimeType: string | null;
  fileSize: number | null;
  description: string | null;
  createdAt: string;
  category: { id: string; categoryName: string } | null;
}

interface PortalQuotation {
  id: string;
  status: string;
  totalAmount: string;
}

const pageQuery = "?page=1&limit=100";

test.describe("Client portal access and ownership", () => {
  test("a client can sign in and read their own portal sections", async ({ request }) => {
    const token = await login(
      request,
      requiredEnv("E2E_CLIENT_USER_EMAIL"),
      requiredEnv("E2E_CLIENT_USER_PASSWORD"),
    );
    const headers = bearer(token);
    const projectId = requiredEnv("E2E_CLIENT_PROJECT_ID");
    const documentId = requiredEnv("E2E_CLIENT_DOCUMENT_ID");
    const quotationId = requiredEnv("E2E_CLIENT_QUOTATION_ID");

    const projects = await expectOk<PortalPage<PortalProject>>(
      await request.get(`${apiBaseUrl()}/client-portal/projects${pageQuery}`, { headers }),
    );
    expect(projects.items.map((project) => project.id)).toContain(projectId);

    const project = await expectOk<PortalProject>(
      await request.get(`${apiBaseUrl()}/client-portal/projects/${projectId}`, { headers }),
    );
    expect(project).toMatchObject({ id: projectId });
    expect(project.projectName).toBeTruthy();

    await expectOk<unknown[]>(
      await request.get(`${apiBaseUrl()}/client-portal/projects/${projectId}/milestones`, {
        headers,
      }),
    );

    const documents = await expectOk<PortalPage<PortalDocument>>(
      await request.get(
        `${apiBaseUrl()}/client-portal/projects/${projectId}/documents${pageQuery}`,
        { headers },
      ),
    );
    expect(documents.items.map((document) => document.id)).toContain(documentId);
    for (const document of documents.items) {
      expect(document).not.toHaveProperty("fileUrl");
      expect(document).not.toHaveProperty("cloudinaryPublicId");
      expect(document).not.toHaveProperty("uploadedBy");
    }

    const quotations = await expectOk<PortalPage<PortalQuotation>>(
      await request.get(`${apiBaseUrl()}/client-portal/quotations${pageQuery}`, { headers }),
    );
    expect(quotations.items.map((quotation) => quotation.id)).toContain(quotationId);
    for (const quotation of quotations.items) {
      expect(quotation.totalAmount).toMatch(/^\d+\.\d{2}$/);
    }

    const download = await request.get(
      `${apiBaseUrl()}/client-portal/documents/${documentId}/download`,
      { headers },
    );
    expect(download.ok(), `client document download failed with ${download.status()}`).toBeTruthy();
  });

  test("a client cannot view another client's project or document", async ({ request }) => {
    const token = await login(
      request,
      requiredEnv("E2E_CLIENT_USER_EMAIL"),
      requiredEnv("E2E_CLIENT_USER_PASSWORD"),
    );
    const headers = bearer(token);
    const foreignProjectId = requiredEnv("E2E_OTHER_CLIENT_PROJECT_ID");
    const foreignDocumentId = requiredEnv("E2E_OTHER_CLIENT_DOCUMENT_ID");

    const project = await request.get(
      `${apiBaseUrl()}/client-portal/projects/${foreignProjectId}`,
      { headers },
    );
    expect(project.status()).toBe(404);

    const milestones = await request.get(
      `${apiBaseUrl()}/client-portal/projects/${foreignProjectId}/milestones`,
      { headers },
    );
    expect(milestones.status()).toBe(404);

    const documents = await request.get(
      `${apiBaseUrl()}/client-portal/projects/${foreignProjectId}/documents`,
      { headers },
    );
    expect(documents.status()).toBe(404);

    const download = await request.get(
      `${apiBaseUrl()}/client-portal/documents/${foreignDocumentId}/download`,
      { headers },
    );
    expect(download.status()).toBe(404);
  });

  test("anonymous and staff accounts cannot access client portal APIs", async ({ request }) => {
    const anonymous = await request.get(`${apiBaseUrl()}/client-portal/projects`);
    expect(anonymous.status()).toBe(401);

    const staffToken = await login(
      request,
      requiredEnv("E2E_STAFF_USER_EMAIL"),
      requiredEnv("E2E_STAFF_USER_PASSWORD"),
    );
    const staff = await request.get(`${apiBaseUrl()}/client-portal/projects`, {
      headers: bearer(staffToken),
    });
    expect(staff.status()).toBe(403);
  });

  test("a second client sees its own project and not the first client's project", async ({
    request,
  }) => {
    const token = await login(
      request,
      requiredEnv("E2E_OTHER_CLIENT_USER_EMAIL"),
      requiredEnv("E2E_OTHER_CLIENT_USER_PASSWORD"),
    );
    const headers = bearer(token);
    const ownProjectId = requiredEnv("E2E_OTHER_CLIENT_PROJECT_ID");
    const foreignProjectId = requiredEnv("E2E_CLIENT_PROJECT_ID");

    const projects = await expectOk<PortalPage<PortalProject>>(
      await request.get(`${apiBaseUrl()}/client-portal/projects${pageQuery}`, { headers }),
    );
    const projectIds = projects.items.map((project) => project.id);
    expect(projectIds).toContain(ownProjectId);
    expect(projectIds).not.toContain(foreignProjectId);

    const foreignProject = await request.get(
      `${apiBaseUrl()}/client-portal/projects/${foreignProjectId}`,
      { headers },
    );
    expect(foreignProject.status()).toBe(404);
  });
});
