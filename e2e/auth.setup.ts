import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { apiBaseUrl, bearer, expectOk, requiredEnv } from "./support/api";
import { adminCredentials } from "./support/admin-credentials";
import {
  authStatePath,
  type AuthScope,
  type AuthRole,
} from "./support/auth-state";

interface Credentials {
  email: string;
  password: string;
}

interface LoginTokens {
  accessToken: string;
  refreshToken?: string;
}

interface AuthProfile {
  id: string;
  role: string;
}

function optionalCredentials(
  emailVariable: string,
  passwordVariable: string,
): Credentials | null {
  const email = process.env[emailVariable]?.trim();
  const password = process.env[passwordVariable];

  if (!email && !password) return null;

  if (!email || !password?.trim()) {
    throw new Error(
      `Set both ${emailVariable} and ${passwordVariable}, or leave both empty.`,
    );
  }

  return { email, password };
}

test.beforeAll(async () => {
  await mkdir(path.dirname(authStatePath("root", "admin")), {
    recursive: true,
    mode: 0o700,
  });
});

async function saveEmptyState(scope: AuthScope, role: AuthRole): Promise<void> {
  await writeFile(
    authStatePath(scope, role),
    JSON.stringify({ cookies: [], origins: [] }),
    { mode: 0o600 },
  );
}

async function prepareAccount(
  request: APIRequestContext,
  scope: AuthScope,
  role: AuthRole,
  credentials: Credentials,
  expectedRoles: string[],
): Promise<void> {
  const loginResponse = await request.post(`${apiBaseUrl()}/auth/login`, {
    data: {
      email: credentials.email,
      password: credentials.password,
    },
  });

  const tokens = await expectOk<LoginTokens>(loginResponse);

  expect(
    tokens.accessToken,
    `Access token missing for ${scope}/${role}`,
  ).toBeTruthy();

  // Verify actual backend role, not just a successful login.
  const profile = await expectOk<AuthProfile>(
    await request.get(`${apiBaseUrl()}/auth/me`, {
      headers: bearer(tokens.accessToken),
    }),
  );

  expect(
    expectedRoles,
    `Account ${scope}/${role} has unexpected role ${profile.role}`,
  ).toContain(profile.role);

  expect(profile.id).toBeTruthy();

  const frontendOrigin = new URL(requiredEnv("FRONTEND_BASE_URL")).origin;

  // Keys must match frontend/src/lib/token.ts.
  const localStorage = [
    {
      name: "construct_pro_access_token",
      value: tokens.accessToken,
    },
  ];

  if (tokens.refreshToken) {
    localStorage.push({
      name: "construct_pro_refresh_token",
      value: tokens.refreshToken,
    });
  }

  await writeFile(
    authStatePath(scope, role),
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: frontendOrigin,
          localStorage,
        },
      ],
    }),
    { mode: 0o600 },
  );
}

async function prepareOptionalAccount(
  request: APIRequestContext,
  scope: AuthScope,
  role: AuthRole,
  emailVariable: string,
  passwordVariable: string,
  expectedRoles: string[],
): Promise<void> {
  const credentials = optionalCredentials(emailVariable, passwordVariable);

  if (!credentials) {
    await saveEmptyState(scope, role);
    return;
  }

  await prepareAccount(request, scope, role, credentials, expectedRoles);
}

// Root E2E tests.
test("prepare root authentication", async ({ request }) => {
  await prepareAccount(request, "root", "admin", adminCredentials(), ["ADMIN"]);

  await prepareAccount(
    request,
    "root",
    "primary",
    {
      email: requiredEnv("E2E_USER_EMAIL"),
      password: requiredEnv("E2E_USER_PASSWORD"),
    },
    ["ADMIN", "MANAGEMENT", "FINANCE", "ACCOUNTANT"],
  );

  await prepareOptionalAccount(
    request,
    "root",
    "accountant",
    "E2E_ACCOUNTANT_EMAIL",
    "E2E_ACCOUNTANT_PASSWORD",
    ["ACCOUNTANT"],
  );

  await prepareOptionalAccount(
    request,
    "root",
    "restricted",
    "E2E_RESTRICTED_USER_EMAIL",
    "E2E_RESTRICTED_USER_PASSWORD",
    ["PROJECT_MANAGER", "SALES_MANAGER", "CLIENT_PORTAL_USER"],
  );
});

// Project Management E2E tests.
test("prepare projects authentication", async ({ request }) => {
  await prepareAccount(request, "projects", "admin", adminCredentials(), [
    "ADMIN",
  ]);

  await prepareOptionalAccount(
    request,
    "projects",
    "manager",
    "E2E_PROJECT_MANAGER_EMAIL",
    "E2E_PROJECT_MANAGER_PASSWORD",
    ["PROJECT_MANAGER"],
  );

  await prepareOptionalAccount(
    request,
    "projects",
    "accountant",
    "E2E_ACCOUNTANT_EMAIL",
    "E2E_ACCOUNTANT_PASSWORD",
    ["ACCOUNTANT"],
  );
});

// Quotations E2E tests.
test("prepare quotations authentication", async ({ request }) => {
  await prepareAccount(request, "quotations", "admin", adminCredentials(), [
    "ADMIN",
  ]);

  await prepareOptionalAccount(
    request,
    "quotations",
    "restricted",
    "E2E_QUOTATION_RESTRICTED_USER_EMAIL",
    "E2E_QUOTATION_RESTRICTED_USER_PASSWORD",
    [
      "PROJECT_MANAGER",
      "ACCOUNTANT",
      "MANAGEMENT",
      "FINANCE",
      "CLIENT_PORTAL_USER",
    ],
  );
});
