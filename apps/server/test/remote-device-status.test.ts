import { describe, expect, it, vi } from "vitest";
import {
  inspectRemoteDevice,
  parseGpuRows,
  type RemoteExecute,
} from "../src/remote-device-status.js";

function remote({
  gpu = "GPU-a, RTX 4090, 24564, 1000, 23000, 0",
  gpuError = false,
  sshError = "",
  service = "inactive",
} = {}) {
  return vi.fn<RemoteExecute>(async (_file, args) => {
    const command = args.at(-1) ?? "";
    if (sshError) throw new Error(sshError);
    if (command.includes("--query-gpu")) {
      if (gpuError) throw new Error("NVIDIA driver unavailable");
      return { stdout: gpu, stderr: "" };
    }
    const stdout = command.includes("hostname")
      ? "studio"
      : command.includes("uname")
        ? "Linux"
        : command.includes("meminfo")
          ? "MemAvailable: 16000000 kB"
          : command.includes("systemctl")
            ? `LoadState=loaded\nActiveState=${service}\nSubState=${service === "inactive" ? "dead" : "running"}`
            : command.includes("--query-compute-apps")
              ? "1234, python, 1000"
              : "takeboard-device-probe";
    return { stdout, stderr: "" };
  });
}

describe("independent device, resource and service states", () => {
  it("connects and reads GPUs without starting ComfyUI", async () => {
    const run = remote();
    const status = await inspectRemoteDevice("studio", "comfy.service", run);
    expect(status).toMatchObject({
      connection: "connected",
      system: { name: "studio", platform: "Linux" },
      gpu: { state: "available", processesKnown: true },
      service: "stopped",
      startup: { allowed: true },
    });
    expect(status.gpu.devices[0]).toMatchObject({ id: "GPU-a", name: "RTX 4090", freeMiB: 23000 });
    expect(run.mock.calls.some(([, args]) => /'start'|'stop'/.test(args.at(-1) ?? ""))).toBe(false);
  });
  it("busy VRAM prevents starting, not connecting", async () => {
    const status = await inspectRemoteDevice(
      "studio",
      "comfy.service",
      remote({ gpu: "GPU-a, RTX 4090, 24564, 23731, 341, 100" }),
    );
    expect(status).toMatchObject({
      connection: "connected",
      gpu: { state: "busy" },
      service: "stopped",
      startup: { allowed: false, reason: "GPU 资源不足，稍后重试" },
    });
  });
  it("a failed GPU query does not erase SSH or service status", async () => {
    const status = await inspectRemoteDevice("studio", "comfy.service", remote({ gpuError: true }));
    expect(status).toMatchObject({
      connection: "connected",
      gpu: { state: "unavailable" },
      service: "stopped",
      startup: { reason: "GPU 状态读取失败" },
    });
    expect(status.diagnostics).toEqual(["NVIDIA driver unavailable"]);
  });
  it.each(["inactive", "active", "activating", "failed"])(
    "service state %s never disconnects the device",
    async (service) => {
      const status = await inspectRemoteDevice("studio", "comfy.service", remote({ service }));
      expect(status.connection).toBe("connected");
      expect(status.service).toBe(
        { inactive: "stopped", active: "running", activating: "starting", failed: "failed" }[
          service
        ],
      );
    },
  );
  it("distinguishes SSH access failure from unreachable and can recover", async () => {
    expect(
      (await inspectRemoteDevice("studio", undefined, remote({ sshError: "Permission denied" })))
        .connection,
    ).toBe("ssh_unavailable");
    expect(
      (await inspectRemoteDevice("studio", undefined, remote({ sshError: "Connection timed out" })))
        .connection,
    ).toBe("unreachable");
    expect((await inspectRemoteDevice("studio", undefined, remote())).connection).toBe("connected");
  });
  it("reports multiple GPUs rather than pretending the GPU query failed", async () => {
    const status = await inspectRemoteDevice(
      "studio",
      "comfy.service",
      remote({ gpu: "GPU-a, A, 24564, 1000, 23000, 0\nGPU-b, B, 24564, 1000, 23000, 0" }),
    );
    expect(status.gpu.devices).toHaveLength(2);
    expect(status.gpu.state).toBe("available");
    expect(status.startup.reason).toBe("多 GPU 启动尚需指定设备");
  });
  it.each([
    "",
    "GPU-a, GPU, 24564, 1, , 0",
    "GPU-a, GPU, 24564, 1, N/A, 0",
    "GPU-a, GPU, 24564, 1, 23000, 101",
  ])("rejects unknown telemetry %s", (row) => {
    expect(() => parseGpuRows(row)).toThrow();
  });
});
