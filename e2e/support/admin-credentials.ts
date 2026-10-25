type Environment = Record<string, string | undefined>;

export function adminCredentials(env: Environment = process.env) {
  const adminEmail = env.E2E_ADMIN_EMAIL?.trim();
  const adminPassword = env.E2E_ADMIN_PASSWORD;
  // Select a complete account pair; never combine one account's email with
  // another account's password. Explicit admin settings take precedence.
  const explicitAdmin = Boolean(adminEmail || adminPassword?.trim());
  const email = explicitAdmin ? adminEmail : env.E2E_USER_EMAIL?.trim();
  const password = explicitAdmin ? adminPassword : env.E2E_USER_PASSWORD;

  if (!email || !password?.trim() || password === "replace-me") {
    throw new Error(
      "Management E2E credentials are not configured. In the tests repository, " +
        "copy .env.example to .env and set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD " +
        "to a real ADMIN account. Alternatively, leave BOTH admin variables blank " +
        "and set E2E_USER_EMAIL and E2E_USER_PASSWORD to an ADMIN account. " +
        "In CI, export the same pair as environment variables. " +
        ".env.example is documentation only and is not loaded by Playwright.",
    );
  }
  return { email, password };
}
