import { rm } from "node:fs/promises";

export default async function cleanupAuthSessions() {
  const directory = process.env.E2E_AUTH_DIR;

  if (!directory) return;

  await rm(directory, {
    recursive: true,
    force: true,
  });
}
