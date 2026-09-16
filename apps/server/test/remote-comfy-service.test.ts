import { describe, expect, it, vi } from "vitest";
import { remoteServiceName, startRemoteComfy } from "../src/remote-comfy-service.js";

function runtime(gpu = "16000, 0", active = false) {
  return vi.fn(async (_file: string, args: string[]) => {
    const command = args.at(-1) ?? "";
    let stdout = "";
    if (command.includes("LoadState"))
      stdout = `LoadState=loaded\nActiveState=${active ? "active" : "inactive"}\nSubState=${active ? "running" : "dead"}`;
    else if (command.includes("InvocationID")) stdout = "a".repeat(32);
    else if (command.includes("meminfo")) stdout = "MemAvailable: 16000000 kB";
    else if (command.includes("uname")) stdout = "Linux";
    else if (command.includes("--query-gpu"))
      stdout = gpu
        .split("\n")
        .map((row, index) => `GPU-${index}, GPU, 24564, 4000, ${row}`)
        .join("\n");
    return { stdout, stderr: "" };
  });
}

describe("explicit remote ComfyUI startup", () => {
  it("uses the selected host and service and verifies connection", async () => {
    const run = runtime();
    const connect = vi.fn(async () => "connected");
    expect(await startRemoteComfy("artist@studio", "my-comfy.service", connect, run)).toBe(
      "connected",
    );
    expect(connect).toHaveBeenCalledOnce();
    expect(
      run.mock.calls.every(([file, args]) => file === "ssh" && args.includes("artist@studio")),
    ).toBe(true);
    expect(
      run.mock.calls.some(([, args]) => args.at(-1)?.includes("'start' 'my-comfy.service'")),
    ).toBe(true);
  });
  it.each(["1000, 0", "16000,", "16000, 99", "16000, 0\n16000, 0", "N/A, N/A"])(
    "does not launch on unsafe or unknown telemetry: %s",
    async (gpu) => {
      const run = runtime(gpu);
      await expect(startRemoteComfy("studio", "comfy.service", vi.fn(), run)).rejects.toThrow();
      expect(run.mock.calls.some(([, args]) => args.at(-1)?.includes("'start'"))).toBe(false);
    },
  );
  it("rolls back only the owned invocation when readiness fails", async () => {
    const run = runtime();
    await expect(
      startRemoteComfy(
        "studio",
        "comfy.service",
        async () => {
          throw new Error("offline");
        },
        run,
      ),
    ).rejects.toThrow("offline");
    expect(run.mock.calls.some(([, args]) => args.at(-1)?.includes("'stop' 'comfy.service'"))).toBe(
      true,
    );
  });
  it("never takes over an already running service", async () => {
    const run = runtime("16000, 0", true);
    await expect(startRemoteComfy("studio", "comfy.service", vi.fn(), run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects commands disguised as service names or SSH options", async () => {
    expect(() => remoteServiceName("comfy.service; reboot")).toThrow();
    const run = runtime();
    await expect(
      startRemoteComfy("-oProxyCommand=bad", "comfy.service", vi.fn(), run),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
