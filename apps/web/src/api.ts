import type {
  Account,
  AccountInvitation,
  AccountSession,
  AuthAuditEntry,
  AuthStatus,
  CommandAuditEntry,
  InstanceRole,
  OperationsDiagnostics,
  OperationsStorage,
  OperationsTaskCenter,
  ProjectCommand,
  ProjectCommandPreview,
  ProjectMember,
  ProjectRole,
  ProjectSnapshot,
  PublicInvitation,
  RecoveryCodeStatus,
  WorkflowDiagnostic,
} from "@takeboard/contracts";

export type DemoPayload = {
  revision: number;
  snapshot: ProjectSnapshot;
};

export type ProjectCatalogItem = {
  key: string;
  revision: number;
  id: string;
  title: string;
  aspectRatio: string;
  sceneCount: number;
  shotCount: number;
  activeRunCount: number;
  updatedAt: string;
  /** Effective role used by older clients and action guards. */
  role: ProjectRole;
  /** The actual project membership, which can be absent for an instance administrator. */
  membershipRole: ProjectRole | null;
  accessSource: "membership" | "instance_admin";
  boards: ProjectBoardPreview[];
};

let csrfToken: string | null = null;
const knownProjectRevisions = new Map<string, number>();

export function isTimeoutFailure(cause: unknown) {
  const failureName = cause instanceof Error ? cause.name : "";
  return failureName === "AbortError" || failureName === "TimeoutError";
}

export function setApiCsrfToken(value: string | null) {
  csrfToken = value;
}

async function apiFetch(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  const method = (options?.method ?? "GET").toUpperCase();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("x-takeboard-csrf", csrfToken);
  }
  const projectMatch = /^\/api\/projects\/([^/?]+)/.exec(path);
  if (projectMatch?.[1] && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const key = decodeURIComponent(projectMatch[1]);
    const revision = knownProjectRevisions.get(key);
    if (revision !== undefined) headers.set("x-takeboard-revision", String(revision));
  }
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...options, headers });
  } catch (cause) {
    const timedOut = isTimeoutFailure(cause);
    throw new TakeBoardApiError(
      timedOut
        ? "TakeBoard 请求超时。请保持页面打开，检查服务器或 SSH 连接后重试。"
        : "无法连接 TakeBoard 服务。请保持页面打开，检查服务状态或 SSH 隧道后重试。",
      0,
      timedOut ? "REQUEST_TIMEOUT" : "SERVICE_UNREACHABLE",
      true,
      cause,
    );
  }
  if (response.status === 401) window.dispatchEvent(new Event("takeboard:auth-required"));
  return response;
}

export class TakeBoardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "TakeBoardApiError";
  }
}

export type TrashedProjectItem = {
  trashKey: string;
  originalKey: string;
  title: string;
  shotCount: number;
  deletedAt: string;
};

export type InstanceBackup = {
  id: string;
  filename: string;
  createdAt: string;
  size: number;
  projectCount: number;
  userCount: number;
};

export type StagedRestore = {
  restoreId: string;
  createdAt: string;
  projectCount: number;
  userCount: number;
  projects: Array<{
    key: string;
    projectId: string;
    title: string;
    revision: number;
    alreadyExists: boolean;
  }>;
  expiresAt: string;
};

export type ProjectBoardPreview = {
  sceneId: string;
  label: string;
  title: string;
  itemCount: number;
  nodes: Array<{
    id: string;
    refType: "text" | "entity" | "asset" | "shot" | "take_stack";
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  edges: Array<{ sourceItemId: string; targetItemId: string }>;
};

export type WorkerStatus = {
  status: "ready" | "offline";
  engine: string;
  version?: string;
  device?: string;
  vramTotal?: number | null;
  vramFree?: number | null;
  error?: string;
  startup?: {
    state: "ready" | "available" | "blocked" | "starting";
    canStart: boolean;
    message: string;
    platform: string;
    launcher: "systemd" | "launchd" | "windows-service" | "process" | "unavailable";
    checks: Array<{
      id: "endpoint" | "launcher" | "memory" | "accelerator" | "vram" | "load";
      label: string;
      status: "pass" | "blocked";
      detail: string;
    }>;
  };
};

export type WorkflowCapability =
  | "text_to_image"
  | "image_to_image"
  | "text_to_video"
  | "image_to_video"
  | "first_last_video"
  | "reference_video";

export type WorkflowSummary = {
  id: string;
  path: string;
  name: string;
  capability: WorkflowCapability;
  capabilityLabel: string;
  inputs: string[];
  mediaInputs?: {
    first_frame: number;
    last_frame: number;
    reference: number;
    reference_video?: number;
    reference_audio?: number;
  };
  models: string[];
  modelStatus?: "ready" | "missing" | "unknown";
  missingModels?: string[];
  nodeCount: number;
  source: "comfyui";
  editorUrl: string;
  execution: "native" | "bound" | "comfy_only";
  bindingStatus?: "built_in" | "ready" | "stale" | "needs_binding";
  workflowHash?: string;
  origin?: "built_in" | "imported" | "comfyui";
  diagnostic?: WorkflowDiagnostic;
};

export type WorkflowListDiagnostic = {
  path: string;
  status: "blocked" | "unknown";
  code: string;
  message: string;
};

export type WorkflowBindingTransform =
  | "seconds_to_frames"
  | "seconds_to_frames_plus_one"
  | "seconds_to_frames_minus_one";
export type WorkflowBindingTarget = {
  nodeId: string;
  input: string;
  transform?: WorkflowBindingTransform;
};
export type WorkflowBindingCandidate = WorkflowBindingTarget & {
  label: string;
  classType: string;
  valueType: "string" | "number" | "boolean" | "unknown";
  suggestedTransform?: WorkflowBindingTransform;
};
export type WorkflowParameterKey =
  | "prompt"
  | "negative_prompt"
  | "seed"
  | "steps"
  | "denoise"
  | "width"
  | "height"
  | "duration"
  | "fps";
export type WorkflowMediaKey =
  | "first_frame"
  | "last_frame"
  | "reference_image"
  | "reference_video"
  | "reference_audio";
export type WorkflowBindingDraft = {
  version: 1;
  workflowPath: string;
  workflowHash: string;
  capability: WorkflowCapability;
  outputMediaType: "image" | "video";
  parameters: Partial<Record<WorkflowParameterKey, WorkflowBindingTarget[]>>;
  media: Partial<Record<WorkflowMediaKey, WorkflowBindingTarget[]>>;
  trusted?: boolean;
  verifiedAt?: string;
};
export type WorkflowBindingInspection = {
  path: string;
  status: "built_in" | "ready" | "stale" | "needs_binding";
  workflowHash?: string;
  nodeCount?: number;
  candidates?: {
    parameters: Record<WorkflowParameterKey, WorkflowBindingCandidate[]>;
    media: Record<WorkflowMediaKey, WorkflowBindingCandidate[]>;
  };
  binding?: WorkflowBindingDraft;
  suggested?: WorkflowBindingDraft;
  conversionIssues?: string[];
  warning?: string;
  message?: string;
  diagnostic?: WorkflowDiagnostic;
  bindingProposal?: "recipe_package" | null;
};

export type WorkflowRecipeImport = WorkflowSummary &
  WorkflowBindingInspection & {
    imported: true;
    recipePackage: {
      format: "takeboard.workflow-recipe";
      version: 1;
      sourcePath: string;
      bindingProposalIncluded: boolean;
      trustRequired: true;
    };
  };

export type WorkflowImport = WorkflowSummary &
  WorkflowBindingInspection & {
    imported: true;
  };

export type WorkflowArchiveReference = {
  projectKey: string;
  projectTitle: string;
  location: "active" | "trash";
  shotIds: string[];
  shotLabels: string[];
  runCount: number;
};

export type WorkflowArchivePreview = {
  path: string;
  name: string;
  workflowHash: string;
  references: WorkflowArchiveReference[];
  blocked: boolean;
  confirmationToken: string;
};

export type ArchivedWorkflow = {
  archivePath: string;
  originalPath: string;
  name: string;
  archivedAt: string;
};

async function request(path: string, options?: RequestInit): Promise<DemoPayload> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await apiFetch(path, {
    ...options,
    headers,
  });
  const payload = (await response.json()) as DemoPayload | { error?: string };
  if (!response.ok || !("snapshot" in payload)) {
    throw new Error(
      "error" in payload && payload.error ? payload.error : "TakeBoard request failed",
    );
  }
  return payload;
}

export const demoApi = {
  get: () => request("/api/demo/project"),
  reset: () => request("/api/demo/reset", { method: "POST" }),
  move: (itemId: string, x: number, y: number) =>
    request("/api/demo/canvas-position", {
      method: "PATCH",
      body: JSON.stringify({ itemId, x, y }),
    }),
  generate: (shotId: string) =>
    request("/api/demo/generate", {
      method: "POST",
      body: JSON.stringify({ shotId }),
    }),
  reject: (takeId: string, reason: string) =>
    request("/api/demo/reject", {
      method: "POST",
      body: JSON.stringify({ takeId, reason }),
    }),
  approve: (takeId: string, reason: string | null) =>
    request("/api/demo/approve", {
      method: "POST",
      body: JSON.stringify({ takeId, reason }),
    }),
};

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await apiFetch(path, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
    currentRevision?: number;
  };
  if (!response.ok) {
    if (response.status === 409 && payload.code === "REVISION_CONFLICT") {
      window.dispatchEvent(
        new CustomEvent("takeboard:revision-conflict", {
          detail: { path, currentRevision: payload.currentRevision },
        }),
      );
    }
    if (response.status === 413) {
      throw new TakeBoardApiError(
        payload.error ?? "文件超过当前服务上传上限",
        response.status,
        payload.code ?? null,
        false,
      );
    }
    throw new TakeBoardApiError(
      payload.error ?? `TakeBoard 请求失败（${response.status}）`,
      response.status,
      payload.code ?? null,
      response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500,
    );
  }
  const revisionPayload = payload as unknown as { key?: unknown; revision?: unknown };
  if (typeof revisionPayload.key === "string" && typeof revisionPayload.revision === "number") {
    const key = revisionPayload.key;
    const revision = revisionPayload.revision;
    knownProjectRevisions.set(key, Math.max(revision, knownProjectRevisions.get(key) ?? 0));
  }
  return payload;
}

type CommandResponse = DemoPayload & {
  key: string;
  commandId: string;
  replayed: boolean;
  status: "applied" | "undone";
  result: Record<string, unknown>;
};

function commandRequestId() {
  return `web:${crypto.randomUUID()}`;
}

async function previewProjectCommand(key: string, command: ProjectCommand) {
  return await jsonRequest<{ key: string; preview: ProjectCommandPreview }>(
    `/api/projects/${encodeURIComponent(key)}/commands/preview`,
    { method: "POST", body: JSON.stringify({ command }) },
  );
}

async function executeProjectCommand(
  key: string,
  command: ProjectCommand,
  preview?: ProjectCommandPreview,
) {
  const requiresPreview =
    command.type === "canvas.remove_item" ||
    command.type === "shot.delete" ||
    command.type === "canvas.connect_items" ||
    command.type === "canvas.arrange_scene";
  const confirmedPreview =
    preview ?? (requiresPreview ? (await previewProjectCommand(key, command)).preview : null);
  return await jsonRequest<CommandResponse>(`/api/projects/${encodeURIComponent(key)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      command,
      requestId: commandRequestId(),
      ...(confirmedPreview ? { expectedRevision: confirmedPreview.currentRevision } : {}),
      ...(confirmedPreview?.confirmationToken
        ? { confirmationToken: confirmedPreview.confirmationToken }
        : {}),
    }),
  });
}

export const projectApi = {
  tasks: () => jsonRequest<OperationsTaskCenter>("/api/operations/tasks"),
  storage: () => jsonRequest<OperationsStorage>("/api/operations/storage"),
  diagnostics: () => jsonRequest<OperationsDiagnostics>("/api/operations/diagnostics"),
  list: async () => {
    const payload = await jsonRequest<{ projects: ProjectCatalogItem[] }>("/api/projects");
    for (const project of payload.projects)
      knownProjectRevisions.set(project.key, project.revision);
    return payload;
  },
  markRevision: (key: string, revision: number) => {
    knownProjectRevisions.set(key, revision);
  },
  open: async (key: string) => {
    const payload = await jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}`,
    );
    knownProjectRevisions.set(key, payload.revision);
    return payload;
  },
  sync: async (key: string, revision: number) => {
    const response = await apiFetch(`/api/projects/${encodeURIComponent(key)}/sync`, {
      headers: { "if-none-match": `"takeboard-r${revision}"` },
    });
    if (response.status === 304) return null;
    const payload = (await response.json().catch(() => ({}))) as DemoPayload & {
      key: string;
      error?: string;
    };
    if (!response.ok || !payload.snapshot) {
      throw new Error(payload.error ?? `项目同步失败（${response.status}）`);
    }
    return payload;
  },
  create: (input: { title: string }) =>
    jsonRequest<DemoPayload & { key: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  importPackage: (file: File) => {
    const body = new FormData();
    body.append("projectPackage", file);
    return jsonRequest<{
      imported: true;
      key: string;
      title: string;
      projectId: string;
      revision: number;
    }>("/api/projects/import", { method: "POST", body });
  },
  exportUrl: (key: string) => `/api/projects/${encodeURIComponent(key)}/export`,
  createShot: (
    key: string,
    input: {
      aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | "2.35:1";
      x?: number;
      y?: number;
    } = {},
  ) =>
    executeProjectCommand(key, { type: "canvas.create_shot", ...input }) as Promise<
      CommandResponse & { shotId: string; itemId: string }
    >,
  deleteShot: (key: string, shotId: string) =>
    executeProjectCommand(key, { type: "shot.delete", shotId }) as Promise<
      CommandResponse & { removedShotId: string; removedItemIds: string[] }
    >,
  reorderShot: (key: string, shotId: string, toIndex: number) =>
    executeProjectCommand(key, { type: "shot.reorder", shotId, toIndex }) as Promise<
      CommandResponse & {
        shotId: string;
        sceneId: string;
        fromIndex: number;
        toIndex: number;
        orderedShotIds: string[];
      }
    >,
  createTextNode: (
    key: string,
    input: { title?: string; body?: string; sceneId?: string; x?: number; y?: number },
  ) =>
    executeProjectCommand(key, { type: "canvas.create_text", ...input }) as Promise<
      CommandResponse & { textId: string; itemId: string }
    >,
  rename: (key: string, title: string) =>
    jsonRequest<DemoPayload & { key: string }>(`/api/projects/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  delete: async (key: string) => {
    const result = await jsonRequest<{
      key: string;
      deleted: true;
      recoverable: true;
      stoppedRunCount: number;
    }>(`/api/projects/${encodeURIComponent(key)}`, { method: "DELETE" });
    knownProjectRevisions.delete(key);
    return result;
  },
  trash: () => jsonRequest<{ projects: TrashedProjectItem[] }>("/api/projects/trash"),
  restore: (trashKey: string) =>
    jsonRequest<{ restored: true; key: string; title: string }>(
      `/api/projects/trash/${encodeURIComponent(trashKey)}/restore`,
      { method: "POST" },
    ),
  connect: (
    key: string,
    sourceItemId: string,
    targetItemId: string,
    targetSlot: "first_frame" | "last_frame" | "reference" | "reference_video" | "reference_audio",
  ) =>
    executeProjectCommand(key, {
      type: "canvas.connect_items",
      sourceItemId,
      targetItemId,
      targetSlot,
    }),
  disconnect: (key: string, edgeId: string) =>
    executeProjectCommand(key, { type: "canvas.disconnect", edgeId }) as Promise<
      CommandResponse & { removedEdgeId: string }
    >,
  move: (key: string, itemId: string, x: number, y: number) =>
    executeProjectCommand(key, { type: "canvas.move_item", itemId, x, y }),
  uploadAsset: async (
    key: string,
    file: File,
    metadata?: {
      kind?: "character" | "location" | "prop";
      name?: string;
      x?: number;
      y?: number;
      addToCanvas?: boolean;
    },
  ) => {
    const body = new FormData();
    body.set("file", file);
    const query = new URLSearchParams();
    if (metadata?.kind) query.set("kind", metadata.kind);
    if (metadata?.name) query.set("name", metadata.name);
    if (metadata?.x !== undefined) query.set("x", String(metadata.x));
    if (metadata?.y !== undefined) query.set("y", String(metadata.y));
    if (metadata?.addToCanvas === false) query.set("canvas", "0");
    return await jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/assets${query.size ? `?${query}` : ""}`,
      { method: "POST", body },
    );
  },
  updateAsset: (
    key: string,
    assetId: string,
    input: {
      title?: string;
      customTags?: string[];
      libraryKind?: "character" | "location" | "prop" | null;
    },
  ) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/assets/${encodeURIComponent(assetId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  inspectAssetMetadata: (key: string) =>
    jsonRequest<
      DemoPayload & {
        key: string;
        inspected: number;
        updatedAssetIds: string[];
        warnings: Array<{ assetId: string; name: string; reason: string }>;
      }
    >(`/api/projects/${encodeURIComponent(key)}/assets/inspect-metadata`, { method: "POST" }),
  generate: (
    key: string,
    shotId: string,
    settings: {
      recipePath: string;
      prompt: string;
      promptSource?: string;
      negativePrompt: string;
      firstFrameAssetId: string | null;
      lastFrameAssetId: string | null;
      referenceImageAssetIds?: string[];
      referenceVideoAssetIds?: string[];
      referenceAudioAssetIds?: string[];
      referenceImageSize?: "match" | "max";
      width: number;
      height: number;
      durationSeconds: number;
      fps: number;
      seed: number;
      steps: number;
      denoise: number;
      candidateBatchId?: string;
      candidateIndex?: number;
      candidateCount?: number;
      retryOfRunId?: string;
    },
  ) =>
    jsonRequest<
      DemoPayload & {
        key: string;
        runId: string;
        promptId: string;
        candidateBatchId: string | null;
        candidateIndex: number | null;
        candidateCount: number | null;
      }
    >(`/api/projects/${encodeURIComponent(key)}/shots/${encodeURIComponent(shotId)}/generate`, {
      method: "POST",
      body: JSON.stringify(settings),
    }),
  run: (key: string, runId: string) =>
    jsonRequest<
      DemoPayload & {
        key: string;
        runId: string;
        status: string;
        progress: {
          phase: "queued" | "running" | "collecting";
          label: string;
          detail: string;
          percent: number | null;
          nodeId: string | null;
          queueRemaining: number | null;
          source: "comfy_websocket" | "comfy_history";
          updatedAt: string;
        } | null;
      }
    >(`/api/projects/${encodeURIComponent(key)}/runs/${encodeURIComponent(runId)}`),
  cancelRun: (key: string, runId: string) =>
    jsonRequest<
      DemoPayload & {
        key: string;
        runId: string;
        status: string;
        cancelled: boolean;
        resourcesReleased: boolean;
        warning?: string;
      }
    >(`/api/projects/${encodeURIComponent(key)}/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    }),
  addCanvasItem: (
    key: string,
    input: {
      refType: "text" | "entity" | "asset" | "shot" | "take_stack";
      refId: string;
      sceneId?: string;
      x?: number;
      y?: number;
    },
  ) =>
    executeProjectCommand(key, { type: "canvas.add_item", ...input }) as Promise<
      CommandResponse & { itemId: string }
    >,
  duplicateCanvasItem: (key: string, itemId: string, x?: number, y?: number) =>
    executeProjectCommand(key, { type: "canvas.duplicate_item", itemId, x, y }) as Promise<
      CommandResponse & { itemId: string; copyMode: "independent" | "reference" }
    >,
  editCanvasItem: (
    key: string,
    itemId: string,
    input: {
      title?: string;
      body?: string;
      customTags?: string[];
      workflowPath?: string;
      durationSeconds?: number;
      aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | "2.35:1";
    },
  ) => executeProjectCommand(key, { type: "canvas.edit_item", itemId, ...input }),
  deleteCanvasItem: (key: string, itemId: string) =>
    executeProjectCommand(key, { type: "canvas.remove_item", itemId }) as Promise<
      CommandResponse & { removedItemId: string }
    >,
  previewCommand: (key: string, command: ProjectCommand) => previewProjectCommand(key, command),
  executeCommand: (key: string, command: ProjectCommand, preview?: ProjectCommandPreview) =>
    executeProjectCommand(key, command, preview),
  audit: (key: string, limit = 50) =>
    jsonRequest<{ key: string; revision: number; entries: CommandAuditEntry[] }>(
      `/api/projects/${encodeURIComponent(key)}/audit?limit=${limit}`,
    ),
  undo: (key: string, commandId: string) =>
    jsonRequest<CommandResponse & { undoneCommandId: string }>(
      `/api/projects/${encodeURIComponent(key)}/commands/${encodeURIComponent(commandId)}/undo`,
      { method: "POST" },
    ),
  reject: (key: string, takeId: string, reason: string) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/takes/${encodeURIComponent(takeId)}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  approve: (key: string, takeId: string, reason: string | null) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/takes/${encodeURIComponent(takeId)}/approve`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  assetUrl: (key: string, assetId: string, proxy = false) =>
    `/api/projects/${encodeURIComponent(key)}/assets/${encodeURIComponent(assetId)}/content${proxy ? "?proxy=1" : ""}`,
  worker: () => jsonRequest<WorkerStatus>("/api/workers/comfy"),
  startWorker: async () => {
    const response = await apiFetch("/api/workers/comfy/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "safe-start" }),
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<WorkerStatus> & {
      error?: string;
    };
    if (payload.status === "ready" || payload.status === "offline") {
      return payload as WorkerStatus;
    }
    throw new Error(payload.error ?? `ComfyUI 启动请求失败（${response.status}）`);
  },
};

export const authApi = {
  status: () => jsonRequest<AuthStatus>("/api/auth/status"),
  bootstrap: (input: { name: string; email: string; password: string }) =>
    jsonRequest<{ user: Account; csrfToken: string }>("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  login: (email: string, password: string) =>
    jsonRequest<{ user: Account; csrfToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  invitation: (token: string) =>
    jsonRequest<{ invitation: PublicInvitation }>(
      `/api/auth/invitations/${encodeURIComponent(token)}`,
    ),
  acceptInvitation: (token: string, password: string) =>
    jsonRequest<{ user: Account; csrfToken: string }>(
      `/api/auth/invitations/${encodeURIComponent(token)}`,
      { method: "POST", body: JSON.stringify({ password }) },
    ),
  recover: (email: string, code: string, newPassword: string) =>
    jsonRequest<{ recovered: true; revokedSessions: true }>("/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({ email, code, newPassword }),
    }),
  logout: () => jsonRequest<{ loggedOut: true }>("/api/auth/logout", { method: "POST" }),
  sessions: () => jsonRequest<{ sessions: AccountSession[] }>("/api/auth/sessions"),
  revokeSession: (sessionId: string) =>
    jsonRequest<{ revoked: true; current: boolean }>(
      `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    ),
  updateProfile: (name: string) =>
    jsonRequest<{ user: Account }>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    jsonRequest<{ changed: true; revokedOtherSessions: true }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  recoveryCodeStatus: () => jsonRequest<{ status: RecoveryCodeStatus }>("/api/auth/recovery-codes"),
  generateRecoveryCodes: (currentPassword: string) =>
    jsonRequest<{ codes: string[]; status: RecoveryCodeStatus }>("/api/auth/recovery-codes", {
      method: "POST",
      body: JSON.stringify({ currentPassword }),
    }),
  users: () => jsonRequest<{ users: Account[] }>("/api/admin/users"),
  invitations: () => jsonRequest<{ invitations: AccountInvitation[] }>("/api/admin/invitations"),
  createInvitation: (input: {
    name: string;
    email: string;
    instanceRole: InstanceRole;
    expiresHours: number;
  }) =>
    jsonRequest<{ invitation: AccountInvitation; token: string }>("/api/admin/invitations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeInvitation: (invitationId: string) =>
    jsonRequest<{ revoked: true }>(`/api/admin/invitations/${encodeURIComponent(invitationId)}`, {
      method: "DELETE",
    }),
  audit: (limit = 100) =>
    jsonRequest<{ entries: AuthAuditEntry[] }>(`/api/admin/audit?limit=${limit}`),
  backups: () => jsonRequest<{ backups: InstanceBackup[] }>("/api/admin/backups"),
  createBackup: () =>
    jsonRequest<{ backup: InstanceBackup }>("/api/admin/backups", { method: "POST" }),
  backupDownloadUrl: (backupId: string) =>
    `/api/admin/backups/${encodeURIComponent(backupId)}/download`,
  inspectBackup: async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return await jsonRequest<{ restore: StagedRestore }>("/api/admin/backups/inspect", {
      method: "POST",
      body,
    });
  },
  applyRestore: (restoreId: string, currentPassword: string, confirmation: string) =>
    jsonRequest<{ restored: string[]; skipped: string[]; identityRestored: false }>(
      `/api/admin/backups/restores/${encodeURIComponent(restoreId)}/apply`,
      { method: "POST", body: JSON.stringify({ currentPassword, confirmation }) },
    ),
  discardRestore: (restoreId: string) =>
    jsonRequest<{ removed: true }>(`/api/admin/backups/restores/${encodeURIComponent(restoreId)}`, {
      method: "DELETE",
    }),
  createUser: (input: {
    name: string;
    email: string;
    password: string;
    instanceRole: InstanceRole;
  }) =>
    jsonRequest<{ user: Account }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateUser: (
    userId: string,
    input: { status?: "active" | "disabled"; instanceRole?: InstanceRole },
  ) =>
    jsonRequest<{ user: Account }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  projectMembers: (key: string) =>
    jsonRequest<{ members: ProjectMember[]; directory: Account[] }>(
      `/api/projects/${encodeURIComponent(key)}/members`,
    ),
  setProjectMember: (key: string, userId: string, role: ProjectRole) =>
    jsonRequest<{ members: ProjectMember[] }>(
      `/api/projects/${encodeURIComponent(key)}/members/${encodeURIComponent(userId)}`,
      { method: "PUT", body: JSON.stringify({ role }) },
    ),
  removeProjectMember: (key: string, userId: string) =>
    jsonRequest<{ removed: true; members: ProjectMember[] }>(
      `/api/projects/${encodeURIComponent(key)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
};

export const workflowApi = {
  list: () =>
    jsonRequest<{
      editorUrl: string;
      workflows: WorkflowSummary[];
      warnings: string[];
      diagnostics?: WorkflowListDiagnostic[];
      error?: string;
    }>("/api/workflows"),
  rawUrl: (path: string) => `/api/workflows/raw?path=${encodeURIComponent(path)}`,
  recipePackageUrl: (path: string) =>
    `/api/workflows/recipe-package?path=${encodeURIComponent(path)}`,
  import: async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return await jsonRequest<WorkflowImport>("/api/workflows/import", {
      method: "POST",
      body,
    });
  },
  importRecipePackage: async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return await jsonRequest<WorkflowRecipeImport>("/api/workflows/recipe-package/import", {
      method: "POST",
      body,
    });
  },
  inspectBinding: (path: string) =>
    jsonRequest<WorkflowBindingInspection>(
      `/api/workflows/binding?path=${encodeURIComponent(path)}`,
    ),
  inspectWorkflow: (path: string) =>
    jsonRequest<WorkflowBindingInspection>(
      `/api/workflows/inspect?path=${encodeURIComponent(path)}`,
    ),
  saveBinding: (path: string, binding: WorkflowBindingDraft) =>
    jsonRequest<{ status: "ready"; binding: WorkflowBindingDraft }>(
      `/api/workflows/binding?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        body: JSON.stringify({ ...binding, trusted: true }),
      },
    ),
  archivePreview: (path: string) =>
    jsonRequest<WorkflowArchivePreview>(
      `/api/workflows/archive-preview?path=${encodeURIComponent(path)}`,
    ),
  archive: (preview: WorkflowArchivePreview) =>
    jsonRequest<{ archived: true; archivePath: string; originalPath: string }>(
      "/api/workflows/archive",
      {
        method: "POST",
        body: JSON.stringify({
          path: preview.path,
          confirmationToken: preview.confirmationToken,
        }),
      },
    ),
  archives: () => jsonRequest<{ archives: ArchivedWorkflow[] }>("/api/workflows/archives"),
  restoreArchive: (archivePath: string) =>
    jsonRequest<{ restored: true; path: string }>("/api/workflows/archives/restore", {
      method: "POST",
      body: JSON.stringify({ archivePath }),
    }),
};
