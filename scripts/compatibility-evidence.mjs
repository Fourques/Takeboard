import { isAbsolute } from "node:path";

function requireText(value, name, maximum = 500) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`${name} 缺失或超出长度限制`);
  }
  return value;
}

function requireNumber(value, name, { minimum = 0, maximum = Number.MAX_VALUE } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum}–${maximum} 之间的数字`);
  }
  return value;
}

function requireInteger(value, name, options) {
  requireNumber(value, name, options);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} 必须是安全整数`);
  return value;
}

function requireSha256(value, name) {
  const hash = requireText(value, name, 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${name} 不是小写 SHA-256`);
  return hash;
}

function requireTimestamp(value, name) {
  const timestamp = requireText(value, name, 100);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} 时间无效`);
  return milliseconds;
}

function requireRelativeWorkflowPath(value, name) {
  const path = requireText(value, name, 500);
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${name} 必须是规范的仓库相对路径`);
  }
  return path;
}

function rejectPrivateMaterial(value, filename) {
  const forbiddenKeys = new Set([
    "password",
    "passwd",
    "cookie",
    "setcookie",
    "csrf",
    "csrftoken",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "apikey",
    "secret",
    "clientsecret",
    "prompt",
    "negativeprompt",
    "email",
    "account",
    "username",
    "projectkey",
    "projectid",
    "runid",
    "assetid",
    "sessionid",
  ]);
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[_-]/g, "");
      if (forbiddenKeys.has(normalizedKey)) {
        throw new Error(`${filename} 含禁止发布的字段 ${key}`);
      }
      if (
        typeof child === "string" &&
        (child.startsWith("/") ||
          child.startsWith("\\\\") ||
          child.startsWith("~/") ||
          child.startsWith("~\\") ||
          /^file:\/\//i.test(child) ||
          /^[A-Za-z]:[\\/]/.test(child))
      ) {
        throw new Error(`${filename} 含绝对路径，拒绝发布`);
      }
      if (child && typeof child === "object") pending.push(child);
    }
  }
}

export function validateCompatibilityEvidence(value, filename = "evidence.json") {
  const evidence = value;
  if (
    !evidence ||
    typeof evidence !== "object" ||
    evidence.format !== "takeboard.gpu-release-gate" ||
    evidence.version !== 2 ||
    evidence.passed !== true ||
    evidence.evidenceKind !== "real_gpu_end_to_end"
  ) {
    throw new Error(`${filename} 不是通过的 TakeBoard GPU v2 证据`);
  }

  const evidenceId = requireText(evidence.evidenceId, `${filename}.evidenceId`, 100);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(evidenceId)) {
    throw new Error(`${filename}.evidenceId 不是 UUID v4`);
  }
  const startedAt = requireTimestamp(evidence.startedAt, `${filename}.startedAt`);
  const completedAt = requireTimestamp(evidence.completedAt, `${filename}.completedAt`);
  if (completedAt < startedAt) throw new Error(`${filename} 完成时间早于开始时间`);
  const version = requireText(evidence.takeboardVersion, `${filename}.takeboardVersion`, 100);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${filename}.takeboardVersion 不是可识别版本`);
  }
  if (!/^[a-f0-9]{40}$/i.test(evidence.source?.commit ?? "")) {
    throw new Error(`${filename} 必须绑定 40 位 Git commit`);
  }
  if (evidence.source?.dirty !== false) {
    throw new Error(`${filename} 不是从干净工作树生成，不能进入公开矩阵`);
  }

  requireText(evidence.environment?.platform, `${filename}.environment.platform`, 50);
  requireText(evidence.environment?.architecture, `${filename}.environment.architecture`, 50);
  requireText(evidence.environment?.nodeVersion, `${filename}.environment.nodeVersion`, 50);
  requireText(evidence.worker?.engine, `${filename}.worker.engine`, 100);
  requireText(evidence.worker?.version, `${filename}.worker.version`, 100);
  requireText(evidence.worker?.device, `${filename}.worker.device`, 300);
  if (evidence.worker.vramTotal !== null) {
    requireNumber(evidence.worker.vramTotal, `${filename}.worker.vramTotal`, { minimum: 1 });
  }
  if (evidence.worker.vramFreeAtStart !== null) {
    requireNumber(evidence.worker.vramFreeAtStart, `${filename}.worker.vramFreeAtStart`);
  }
  if (
    typeof evidence.worker.vramTotal === "number" &&
    typeof evidence.worker.vramFreeAtStart === "number" &&
    evidence.worker.vramFreeAtStart > evidence.worker.vramTotal
  ) {
    throw new Error(`${filename} 空闲显存大于总显存`);
  }

  requireRelativeWorkflowPath(evidence.workflow?.path, `${filename}.workflow.path`);
  if (!["native", "bound"].includes(evidence.workflow?.execution)) {
    throw new Error(`${filename}.workflow.execution 必须是 native 或 bound`);
  }
  requireSha256(evidence.workflow?.workflowHash, `${filename}.workflow.workflowHash`);
  requireSha256(
    evidence.workflow?.executionPromptSha256,
    `${filename}.workflow.executionPromptSha256`,
  );
  if (!Array.isArray(evidence.workflow.models) || evidence.workflow.models.length < 1) {
    throw new Error(`${filename}.workflow.models 必须是非空字符串数组`);
  }
  evidence.workflow.models.forEach((item, index) => {
    requireText(item, `${filename}.workflow.models[${index}]`, 500);
  });

  requireInteger(evidence.generation?.width, `${filename}.generation.width`, {
    minimum: 64,
    maximum: 16_384,
  });
  requireInteger(evidence.generation?.height, `${filename}.generation.height`, {
    minimum: 64,
    maximum: 16_384,
  });
  requireNumber(evidence.generation?.durationSeconds, `${filename}.generation.durationSeconds`, {
    minimum: 0.1,
    maximum: 300,
  });
  requireNumber(evidence.generation?.fps, `${filename}.generation.fps`, {
    minimum: 1,
    maximum: 240,
  });
  requireInteger(evidence.generation?.steps, `${filename}.generation.steps`, {
    minimum: 1,
    maximum: 10_000,
  });
  requireInteger(evidence.generation?.seed, `${filename}.generation.seed`, {
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  });
  const elapsedSeconds = requireNumber(evidence.elapsedSeconds, `${filename}.elapsedSeconds`);
  const measuredElapsedSeconds = (completedAt - startedAt) / 1_000;
  if (
    Math.abs(elapsedSeconds - measuredElapsedSeconds) > Math.max(5, measuredElapsedSeconds * 0.1)
  ) {
    throw new Error(`${filename}.elapsedSeconds 与起止时间不一致`);
  }

  if (evidence.output?.mediaType !== "video") throw new Error(`${filename} 输出不是视频`);
  const contentType = requireText(
    evidence.output?.contentType,
    `${filename}.output.contentType`,
    200,
  );
  if (!contentType.toLowerCase().startsWith("video/")) {
    throw new Error(`${filename}.output.contentType 不是视频类型`);
  }
  requireInteger(evidence.output?.byteSize, `${filename}.output.byteSize`, { minimum: 1 });
  requireSha256(evidence.output?.sha256, `${filename}.output.sha256`);
  requireInteger(evidence.output?.width, `${filename}.output.width`, { minimum: 1 });
  requireInteger(evidence.output?.height, `${filename}.output.height`, { minimum: 1 });
  requireNumber(evidence.output?.durationSeconds, `${filename}.output.durationSeconds`, {
    minimum: 0.01,
  });
  requireNumber(evidence.output?.frameRate, `${filename}.output.frameRate`, { minimum: 0.01 });
  requireInteger(evidence.output?.probeBytes, `${filename}.output.probeBytes`, { minimum: 8 });
  if (evidence.review?.automatedIntegrity !== "passed") {
    throw new Error(`${filename}.review.automatedIntegrity 未通过`);
  }
  if (!["not_reviewed", "passed", "failed"].includes(evidence.review?.visualQuality)) {
    throw new Error(`${filename}.review.visualQuality 无效`);
  }
  requireText(evidence.privacy, `${filename}.privacy`, 500);
  rejectPrivateMaterial(evidence, filename);
  return evidence;
}
