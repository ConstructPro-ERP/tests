import { expect, test } from "@playwright/test";
import { apiBaseUrl, bearer, expectOk, login, requiredEnv } from "./support/api";
import type { RiskPrediction } from "./support/contracts";

test.describe("ERP data to AI analytics workflow", () => {
  test("generates a contract-valid prediction and displays it in Analytics", async ({
    page,
  }) => {
    const projectId = requiredEnv("E2E_PROJECT_ID");
    const token = await login(page.request);
    const prediction = await expectOk<RiskPrediction>(
      await page.request.get(
        `${apiBaseUrl()}/ai-forecasting/projects/${projectId}/risk`,
        { headers: bearer(token) },
      ),
    );

    expect(prediction.projectId).toBe(projectId);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(prediction.projectRiskLevel);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(prediction.paymentDelayRisk);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(prediction.milestoneDelayRisk);
    expect(["DECLINING", "STABLE", "GROWING"]).toContain(prediction.revenueTrend);
    expect(["RULE_BASED", "AI_PROVIDER", "SAFE_FALLBACK"]).toContain(
      prediction.predictionSource,
    );
    expect(prediction.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(prediction.confidenceScore).toBeLessThanOrEqual(1);
    expect(prediction.explanation).not.toHaveLength(0);
    expect(prediction.recommendedAction).not.toHaveLength(0);

    await page.goto("/login");
    await page.getByLabel("Email").fill(requiredEnv("E2E_USER_EMAIL"));
    await page.getByLabel("Password").fill(requiredEnv("E2E_USER_PASSWORD"));
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/modules/);
    await page.goto("/dashboard/analytics");

    const projectSelect = page.locator("select").first();
    await expect(projectSelect).toBeVisible();
    await projectSelect.selectOption(projectId);
    await page.getByRole("button", { name: "Run Analysis" }).click();

    await expect(page.getByRole("heading", { name: `AI prediction: ${prediction.projectName}` })).toBeVisible();
    await expect(page.getByText("Payment-delay risk")).toBeVisible();
    await expect(page.getByText("Milestone-delay risk")).toBeVisible();
    await expect(page.getByText("Revenue trend")).toBeVisible();
    await expect(page.getByText(prediction.recommendedAction, { exact: true })).toBeVisible();
  });
});
