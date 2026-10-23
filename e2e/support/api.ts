import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

interface ApiEnvelope<T> {
  success?: boolean;
  data: T;
}

export function apiBaseUrl(): string {
  const configured = process.env.API_BASE_URL;
  if (!configured) {
    throw new Error("API_BASE_URL is required. Copy .env.example to .env and set the deployed gateway URL.");
  }
  const base = configured.replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for this test.`);
  return value;
}

export async function body<T>(response: APIResponse): Promise<T> {
  const json = (await response.json()) as T | ApiEnvelope<T>;
  if (json && typeof json === "object" && "data" in json) {
    return (json as ApiEnvelope<T>).data;
  }
  return json as T;
}

export async function login(
  request: APIRequestContext,
  email = requiredEnv("E2E_USER_EMAIL"),
  password = requiredEnv("E2E_USER_PASSWORD"),
): Promise<string> {
  const response = await request.post(`${apiBaseUrl()}/auth/login`, {
    data: { email, password },
  });
  expect(response.ok(), `login failed: ${await response.text()}`).toBeTruthy();
  const result = await body<{ accessToken: string }>(response);
  expect(result.accessToken).toBeTruthy();
  return result.accessToken;
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function expectOk<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} failed: ${await response.text()}`).toBeTruthy();
  return body<T>(response);
}
