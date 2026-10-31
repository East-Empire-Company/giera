import { expect, test } from "@playwright/test";

test("probe reports browser capabilities and packaged resource loading", async ({ page }) => {
  await page.goto("/probe.html");

  await expect(page.locator("[data-probe-root]")).toBeVisible();

  for (const key of ["webgl2", "es2022", "gamepad", "stylesheet", "texture", "root-fetch", "module-worker", "frame-rate"]) {
    await expect(page.locator(`[data-check="${key}"]`)).toHaveAttribute("data-state", "pass");
  }
  await expect(page.locator("[data-probe-fps]")).toHaveText(/Page rAF: [1-9]\d* FPS/i);

  await page.getByRole("button", { name: "Play test sound" }).click();
  await expect(page.locator('[data-check="audio"]')).toHaveAttribute("data-state", "pass");
});
