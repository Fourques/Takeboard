import type { RemoteDeviceStatus } from "@takeboard/contracts";
import { expect, test } from "./fixtures";

test("device, GPU and service remain independent with one action and one error owner", async ({
  page,
}) => {
  const target = {
    kind: "ssh",
    name: "Studio",
    host: "artist@studio",
    port: 8188,
    service: "comfy.service",
  };
  const device: RemoteDeviceStatus = {
    connection: "connected",
    checkedAt: new Date().toISOString(),
    system: { name: "studio", platform: "Linux", availableMemoryMiB: 16000 },
    gpu: {
      state: "available",
      devices: [
        {
          id: "GPU-a",
          name: "RTX 4090",
          totalMiB: 24564,
          usedMiB: 1000,
          freeMiB: 23000,
          utilization: 0,
        },
      ],
      processes: [],
      processesKnown: true,
    },
    service: "stopped",
    startup: { allowed: true, reason: null },
    diagnostics: [],
  };
  let ready = false;
  await page.route("**/api/generation/connection", (route) =>
    route.fulfill({
      json: {
        workerId: "studio",
        localWorkerId: "base",
        kind: "ssh",
        name: "Studio",
        address: target.host,
        state: "configured",
        error: "legacy service error must not be repeated",
        profiles: [
          {
            workerId: "studio",
            target,
            device,
            serviceState: "service_unavailable",
            error: "legacy service error must not be repeated",
          },
        ],
      },
    }),
  );
  await page.route("**/api/workers", (route) =>
    route.fulfill({
      json: {
        defaultWorkerId: "studio",
        workers: [
          {
            worker: { id: "studio", name: "Studio", enabled: true },
            status: ready ? "ready" : "offline",
          },
        ],
      },
    }),
  );
  await page.route("**/api/workers/comfy", (route) =>
    route.fulfill({
      json: {
        status: ready ? "ready" : "offline",
        startup: { canStart: false },
        control: { canStop: false },
      },
    }),
  );
  await page.route("**/api/generation/connection/start", (route) => {
    ready = true;
    device.service = "running";
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
  await page.getByRole("button", { name: "管理设备", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  const card = settings.getByRole("button", { name: "Studio artist@studio 已连接", exact: true });
  const start = settings.getByRole("button", { name: "启动 ComfyUI", exact: true });
  await expect(card).toBeVisible();
  await expect(settings.getByText("未运行", { exact: true })).toBeVisible();
  await expect(start).toHaveCount(1);
  await expect(start).toBeEnabled();
  await expect(settings.getByText("legacy service error must not be repeated")).toHaveCount(0);
  await start.click();
  await expect(settings.getByText("已就绪", { exact: true })).toBeVisible();
  await expect(card).toHaveCount(1);
  ready = false;
  device.service = "stopped";
  device.gpu.state = "busy";
  device.startup = { allowed: false, reason: "GPU 资源不足，稍后重试" };
  const refresh = () => settings.getByRole("button", { name: "刷新状态", exact: true }).click();
  await refresh();
  await expect(card).toBeVisible();
  await expect(start).toBeDisabled();
  await expect(settings.getByText(device.startup.reason, { exact: true })).toHaveCount(1);
  device.gpu.state = "unavailable";
  device.gpu.devices = [];
  device.startup.reason = "GPU 状态读取失败";
  await refresh();
  await expect(settings.getByText("GPU 状态读取失败", { exact: true })).toHaveCount(1);
  await expect(card).toBeVisible();
  await settings.getByRole("button", { name: "编辑", exact: true }).click();
  await settings.getByText("远程启动设置（可选）", { exact: true }).click();
  await expect(settings.getByRole("button", { name: /启动.*连接/ })).toHaveCount(0);
  await expect(start).toHaveCount(1);
  await settings.getByRole("button", { name: "取消编辑", exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 700 });
  await settings.getByRole("heading", { name: "生成设备", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/device-status-layers.png" });
  device.service = "running";
  device.startup.reason = "服务已经运行";
  await refresh();
  await expect(settings.getByRole("button", { name: "重新连接服务", exact: true })).toBeEnabled();
  await expect(start).toHaveCount(0);
  device.service = "stopped";
  device.connection = "unreachable";
  device.startup.reason = "先连接设备";
  await refresh();
  await expect(
    settings.getByRole("button", { name: "Studio artist@studio 无法连接", exact: true }),
  ).toBeVisible();
  device.connection = "connected";
  await refresh();
  await expect(card).toBeVisible();
});
