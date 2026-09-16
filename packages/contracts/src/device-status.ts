export type RemoteDeviceStatus = {
  connection: "connected" | "unreachable" | "ssh_unavailable";
  checkedAt: string;
  system: { name: string | null; platform: string | null; availableMemoryMiB: number | null };
  gpu: {
    state: "available" | "busy" | "unavailable";
    devices: Array<{
      id: string;
      name: string;
      totalMiB: number;
      usedMiB: number;
      freeMiB: number;
      utilization: number;
    }>;
    processes: Array<{ pid: number; name: string; usedMiB: number }>;
    processesKnown: boolean;
  };
  service: "unconfigured" | "stopped" | "running" | "starting" | "failed" | "unknown";
  startup: { allowed: boolean; reason: string | null };
  diagnostics: string[];
};
