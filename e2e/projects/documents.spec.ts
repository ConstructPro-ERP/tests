import {
  test,
  expect,
  unique,
  url,
  uuid,
  expectOk,
  type PageResult,
} from "./fixture";

interface Category {
  id: string;
  categoryName: string;
  description: string | null;
  isActive: boolean;
}
interface DocumentRecord {
  id: string;
  projectId: string;
  categoryId: string;
  originalName: string;
  fileName: string;
  uploadedById: string;
  description: string | null;
}
interface UploadAuthorization {
  documentId: string;
  cloudName: string;
  apiKey: string;
  publicId: string;
  resourceType: "raw" | "image";
  timestamp: number;
  signature: string;
  uploadParameters: Record<string, string | number>;
}
const documentProject = () => process.env.E2E_DOCUMENT_PROJECT_ID?.trim();
const documentCategory = () => process.env.E2E_DOCUMENT_CATEGORY_ID?.trim();
const documentReady = () => Boolean(documentProject() && documentCategory());
const uploadAllowed = () =>
  documentReady() && process.env.E2E_ENABLE_DOCUMENT_UPLOADS === "true";

// Do not create a temporary project here: documents are soft-deleted and
// may permanently prevent deletion of a project with historical document links.
test.describe("Project documents — categories and validation", () => {
  test("Admin can create, edit, deactivate, reactivate and delete unused category", async ({
    projectContext: c,
  }) => {
    const category = await c.post<Category>("/document-categories", {
      categoryName: unique("CAD drawings"),
      description: "E2E category",
    });
    try {
      const renamed = unique("Updated drawings");
      await c.patch<Category>(`/document-categories/${category.id}`, {
        categoryName: renamed,
        isActive: false,
      });
      const hidden = await c.get<Category[]>("/document-categories");
      expect(hidden.some((row) => row.id === category.id)).toBe(false);
      await c.patch<Category>(`/document-categories/${category.id}`, {
        isActive: true,
      });
      const visible = await c.get<Category[]>("/document-categories");
      expect(visible).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: category.id, categoryName: renamed }),
        ])
      );
    } finally {
      const result = await c.request.delete(
        url(`/document-categories/${category.id}`),
        { headers: c.headers }
      );
      expect(result.ok(), await result.text()).toBeTruthy();
    }
  });

  test("duplicate categories and invalid category data are rejected", async ({
    projectContext: c,
  }) => {
    const name = unique("Duplicate category");
    const original = await c.post<Category>("/document-categories", {
      categoryName: name,
    });
    try {
      const duplicate = await c.request.post(url("/document-categories"), {
        headers: c.headers,
        data: { categoryName: name },
      });
      expect(duplicate.status()).toBe(409);
      for (const invalid of [
        { categoryName: " " },
        { categoryName: "x".repeat(101) },
      ]) {
        const response = await c.request.post(url("/document-categories"), {
          headers: c.headers,
          data: invalid,
        });
        expect(response.status()).toBe(400);
      }
    } finally {
      expect(
        (
          await c.request.delete(url(`/document-categories/${original.id}`), {
            headers: c.headers,
          })
        ).ok()
      ).toBeTruthy();
    }
  });

  test("invalid document metadata, missing files, strict file signatures and size limits are rejected", async ({
    projectContext: c,
  }) => {
    const project = await c.createProject();
    const category = await c.post<Category>("/document-categories", {
      categoryName: unique("Validation files"),
    });
    try {
      const noFile = await c.request.post(
        url(`/projects/${project.id}/documents`),
        {
          headers: c.headers,
          multipart: { categoryId: category.id },
        }
      );
      expect(noFile.status()).toBe(400);
      const badFiles = [
        {
          name: "forged.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("not a pdf"),
        },
        {
          name: "forged.png",
          mimeType: "image/png",
          buffer: Buffer.from("not a png"),
        },
        {
          name: "forged.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("not a jpg"),
        },
        {
          name: "forged.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: Buffer.from("not a docx"),
        },
        {
          name: "unsupported.exe",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("not supported"),
        },
      ];
      for (const file of badFiles) {
        const response = await c.request.post(
          url(`/projects/${project.id}/documents`),
          {
            headers: c.headers,
            multipart: { categoryId: category.id, file },
          }
        );
        expect(
          response.status(),
          `${file.name}: ${await response.text()}`
        ).toBe(400);
      }
      const base = {
        categoryId: category.id,
        fileName: "drawing.dwg",
        mimeType: "application/octet-stream",
        fileSize: 10,
      };
      for (const data of [
        { ...base, categoryId: "invalid" },
        { ...base, fileSize: 0 },
        {
          ...base,
          fileName: "drawing.pdf",
          mimeType: "application/octet-stream",
        },
        { ...base, fileName: "file.exe" },
        { ...base, fileName: "../unsafe.dwg" },
      ]) {
        const response = await c.request.post(
          url(`/projects/${project.id}/documents/upload-authorizations`),
          {
            headers: c.headers,
            data,
          }
        );
        expect(
          response.status(),
          `${JSON.stringify(data)}: ${await response.text()}`
        ).toBe(400);
      }
      const oversized = await c.request.post(
        url(`/projects/${project.id}/documents/upload-authorizations`),
        {
          headers: c.headers,
          data: { ...base, fileSize: 50 * 1024 * 1024 + 1 },
        }
      );
      expect(oversized.status(), await oversized.text()).toBe(413);
      const malformedId = await c.request.get(
        url("/projects/bad-uuid/documents"),
        { headers: c.headers }
      );
      expect(malformedId.status()).toBe(400);
      const invalidQueries: Record<string, string | number | boolean>[] = [
        { page: 0 },
        { limit: 101 },
        { categoryId: "nope" },
        { sortBy: "invalid" },
      ];

      for (const params of invalidQueries) {
        const response = await c.request.get(
          url(`/projects/${project.id}/documents`),
          { headers: c.headers, params }
        );

        expect(
          response.status(),
          `${JSON.stringify(params)}: ${await response.text()}`
        ).toBe(400);
      }
      expect(
        (
          await c.get<PageResult<DocumentRecord>>(
            `/projects/${project.id}/documents`
          )
        ).data
      ).toHaveLength(0);
    } finally {
      const removed = await c.request.delete(
        url(`/document-categories/${category.id}`),
        { headers: c.headers }
      );
      expect(removed.ok(), await removed.text()).toBeTruthy();
    }
  });
});

// The following tests use real Cloudinary storage and mutate an explicitly
// pre-seeded disposable project. Enable only against an isolated test deployment.
test.describe("Project documents — real storage integration", () => {
  test("multipart upload, search, category filter, update, signed URL and delete", async ({
    projectContext: c,
  }) => {
    test.skip(
      !uploadAllowed(),
      "Enable E2E_ENABLE_DOCUMENT_UPLOADS=true plus E2E_DOCUMENT_PROJECT_ID and E2E_DOCUMENT_CATEGORY_ID."
    );
    const projectId = documentProject()!;
    const categoryId = documentCategory()!;
    const name = `e2e-${uuid()}.txt`;
    const response = await c.request.post(
      url(`/projects/${projectId}/documents`),
      {
        headers: c.headers,
        multipart: {
          categoryId,
          description: "E2E original upload",
          file: {
            name,
            mimeType: "text/plain",
            buffer: Buffer.from("ConstructPro E2E fixture\n"),
          },
        },
      }
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    const uploaded = await expectOk<DocumentRecord>(response);
    const record = await c.get<DocumentRecord>(`/documents/${uploaded.id}`);
    try {
      expect(record).toMatchObject({
        projectId,
        categoryId,
        originalName: name,
        uploadedById: c.adminId,
      });
      const list = await c.get<PageResult<DocumentRecord>>(
        `/projects/${projectId}/documents`,
        {
          search: name.slice(0, 15),
          categoryId,
          page: 1,
          limit: 100,
        }
      );
      expect(list.data.some((item) => item.id === record.id)).toBe(true);
      const changedName = `revised-${uuid()}.txt`;
      const updated = await c.patch<DocumentRecord>(`/documents/${record.id}`, {
        fileName: changedName,
        description: "Approved plan",
      });
      expect(updated).toMatchObject({
        fileName: changedName,
        description: "Approved plan",
      });
      const denied = await c.request.patch(url(`/documents/${record.id}`), {
        headers: c.headers,
        data: { fileName: "changed.pdf" },
      });
      expect(denied.status()).toBe(400);
      const download = await c.get<{ downloadUrl: string }>(
        `/documents/${record.id}/download`
      );
      expect(new URL(download.downloadUrl).protocol).toBe("https:");
    } finally {
      const deleted = await c.request.delete(url(`/documents/${record.id}`), {
        headers: c.headers,
      });
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
    }
    expect(
      (
        await c.request.get(url(`/documents/${record.id}`), {
          headers: c.headers,
        })
      ).status()
    ).toBe(404);
  });

  test("signed direct upload -> Cloudinary -> verified completion", async ({
    projectContext: c,
  }) => {
    test.setTimeout(180_000);
    test.skip(
      !uploadAllowed() ||
        process.env.E2E_ENABLE_DIRECT_DOCUMENT_UPLOADS !== "true",
      "Enable explicit direct-upload switch; this transfers a 4 MiB+ fixture to Cloudinary."
    );
    const projectId = documentProject()!;
    const categoryId = documentCategory()!;
    const filename = `e2e-${uuid()}.dwg`;
    const file = Buffer.alloc(4 * 1024 * 1024 + 1, 0x41); // CAD opaque raw format, over gateway 4 MiB limit.
    const authorization = await c.post<UploadAuthorization>(
      `/projects/${projectId}/documents/upload-authorizations`,
      {
        categoryId,
        fileName: filename,
        mimeType: "application/octet-stream",
        fileSize: file.length,
      }
    );
    // If the upstream provider fails before completion, leave the PENDING
    // record for the service's reconciliation process; it is not an ACTIVE doc.
    let active = false;
    try {
      const upload = await c.request.post(
        `https://api.cloudinary.com/v1_1/${authorization.cloudName}/${authorization.resourceType}/upload`,
        {
          multipart: {
            file: {
              name: filename,
              mimeType: "application/octet-stream",
              buffer: file,
            },
            ...Object.fromEntries(
              Object.entries(authorization.uploadParameters).map(([k, v]) => [
                k,
                String(v),
              ])
            ),
            api_key: authorization.apiKey,
            signature: authorization.signature,
          },
        }
      );
      expect(
        upload.ok(),
        `Cloudinary upload failed: ${await upload.text()}`
      ).toBeTruthy();
      const cloud = (await upload.json()) as {
        public_id: string;
        bytes: number;
        type: string;
      };
      expect(cloud).toMatchObject({
        public_id: authorization.publicId,
        bytes: file.length,
        type: "authenticated",
      });
      const completed = await c.post<DocumentRecord>(
        `/projects/${projectId}/documents/${authorization.documentId}/complete`,
        {}
      );
      active = true;
      expect(completed).toMatchObject({
        id: authorization.documentId,
        originalName: filename,
      });
      const repeat = await c.post<DocumentRecord>(
        `/projects/${projectId}/documents/${authorization.documentId}/complete`,
        {}
      );
      expect(repeat.id).toBe(completed.id); // completion is idempotent.
    } finally {
      if (active) {
        const deleted = await c.request.delete(
          url(`/documents/${authorization.documentId}`),
          { headers: c.headers }
        );
        expect(deleted.ok(), await deleted.text()).toBeTruthy();
      }
    }
  });
});
