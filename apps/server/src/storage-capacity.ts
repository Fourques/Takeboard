import { access, statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const gibibyte = 1024 ** 3;

function configuredBytes(name: string, fallbackGiB: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * gibibyte)
    : fallbackGiB * gibibyte;
}

export function projectStorageReserveBytes() {
  return configuredBytes("TAKEBOARD_MIN_FREE_DISK_GB", 5);
}

export function comfyOutputReserveBytes() {
  return configuredBytes("COMFY_MIN_FREE_OUTPUT_DISK_GB", 8);
}

async function existingAncestor(path: string) {
  let candidate = resolve(path);
  for (;;) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error(`无法找到可检查的存储位置：${path}`);
      candidate = parent;
    }
  }
}

export async function diskCapacity(path: string) {
  try {
    const information = await statfs(await existingAncestor(path), { bigint: true });
    const totalBytes = information.blocks * information.bsize;
    const availableBytes = information.bavail * information.bsize;
    return {
      totalBytes: Number(totalBytes),
      availableBytes: Number(availableBytes),
    };
  } catch {
    return null;
  }
}

export function estimatedGenerationBytes(input: {
  outputMediaType: "image" | "video";
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
}) {
  if (input.outputMediaType === "image") {
    return Math.max(256 * 1024 ** 2, input.width * input.height * 16);
  }
  const frames = Math.max(1, Math.ceil(input.durationSeconds * input.fps));
  // ComfyUI can temporarily hold decoded frames alongside the encoded file.
  // Two bytes per pixel and a 2 GiB floor provide a conservative staging estimate
  // without pretending to know a third-party node's exact codec or cache behavior.
  return Math.max(2 * gibibyte, input.width * input.height * frames * 2);
}

export type GenerationCapacityCheck = {
  label: string;
  availableBytes: number;
  reserveBytes: number;
  estimatedBytes: number;
  requiredBytes: number;
};

export async function generationCapacityIssues(
  targets: Array<{ label: string; path: string; reserveBytes: number }>,
  estimatedBytes: number,
) {
  const unique = new Map<string, (typeof targets)[number]>();
  for (const target of targets) unique.set(resolve(target.path), target);
  const checks: GenerationCapacityCheck[] = [];
  for (const target of unique.values()) {
    const capacity = await diskCapacity(target.path);
    if (!capacity) continue;
    const requiredBytes = target.reserveBytes + estimatedBytes;
    if (capacity.availableBytes < requiredBytes) {
      checks.push({
        label: target.label,
        availableBytes: capacity.availableBytes,
        reserveBytes: target.reserveBytes,
        estimatedBytes,
        requiredBytes,
      });
    }
  }
  return checks;
}
