import { expect, test } from "@playwright/test";

test("主工作区使用中文展示核心导航和操作区域", async ({ page }) => {
  await page.goto("/map");

  await expect(page.getByText("空间分析工作台")).toBeVisible();
  await expect(page.getByRole("heading", { name: "工程图层" })).toBeVisible();
  await expect(page.getByText("数据、成果与底图")).toBeVisible();
  await expect(page.getByRole("heading", { name: "地图工程" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "上传数据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前图层" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "底图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "分析记录" })).toBeVisible();
  await expect(page.getByPlaceholder("描述地点、数据集或空间分析任务…")).toBeVisible();
});
