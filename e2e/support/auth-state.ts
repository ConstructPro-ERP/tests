import { readFileSync } from "node:fs";
import path from "node:path";

export type AuthScope = "root" | "projects" | "quotations";

export type AuthRole =
  "admin" | "primary" | "manager" | "accountant" | "restricted";

interface StorageState {
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

export function authStatePath(scope: AuthScope, role: AuthRole): string {
  const directory = process.env.E2E_AUTH_DIR;

  if (!directory) {
    throw new Error(
      "E2E_AUTH_DIR is missing. Run tests through playwright.config.ts.",
    );
  }

  return path.join(directory, `${scope}-${role}.json`);
}

export function savedAccessToken(scope: AuthScope, role: AuthRole): string {
  const state = JSON.parse(
    readFileSync(authStatePath(scope, role), "utf8"),
  ) as StorageState;

  const frontendUrl = process.env.FRONTEND_BASE_URL;

  if (!frontendUrl) {
    throw new Error("FRONTEND_BASE_URL is required.");
  }

  const origin = new URL(frontendUrl).origin;

  const matchingOrigin = state.origins.find((item) => item.origin === origin);

  const token = matchingOrigin?.localStorage.find(
    (item) => item.name === "construct_pro_access_token",
  )?.value;

  if (!token) {
    throw new Error(
      `No authenticated access token exists for ${scope}/${role}.`,
    );
  }

  return token;
}

export function savedHeaders(
  scope: AuthScope,
  role: AuthRole,
): { Authorization: string } {
  return {
    Authorization: `Bearer ${savedAccessToken(scope, role)}`,
  };
}
