import { createHash } from "node:crypto";
import type { RecommendedWorkflowTemplate, WorkflowDiagnostic } from "@takeboard/contracts";
import {
  type ComfyObjectInfo,
  type ComfyPrompt,
  nativeRecipePrompt,
  nativeRecipes,
} from "@takeboard/executor-comfy";
import type { FastifyInstance } from "fastify";
import { fetchComfyObjectInfo, workflowHash } from "./workflow-bindings.js";
import { readWorkflowLibraryEntry, updateWorkflowLibraryEntry } from "./workflow-library.js";

export function recommendedArtifacts() {
  return nativeRecipes.map((recipe) => {
    const prompt = nativeRecipePrompt(`Kino/${recipe.filename}`);
    if (!prompt) throw new Error(`Missing maintained recipe: ${recipe.id}`);
    const hash = workflowHash(prompt);
    return {
      ...recipe,
      prompt,
      hash,
      version: `1.${hash.slice(0, 12)}`,
      path: `Kino/TakeBoard/${hash.slice(0, 16)}/${recipe.filename}`,
      bytes: Buffer.byteLength(JSON.stringify(prompt)),
    };
  });
}
type Artifact = ReturnType<typeof recommendedArtifacts>[number];
type Inspect = (path: string, prompt: ComfyPrompt, info: ComfyObjectInfo) => WorkflowDiagnostic;
const fileUrl = (endpoint: string, path: string) =>
  `${endpoint}/api/userdata/${encodeURIComponent(`workflows/${path}`)}`;

async function storedHash(endpoint: string, path: string) {
  const response = await fetch(fileUrl(endpoint, path), { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("无法读取生成设备上的模板，请检查连接后重试。");
  return workflowHash(await response.json());
}

async function inspectArtifact(
  endpoint: string,
  artifact: Artifact,
  info: ComfyObjectInfo,
  inspect: Inspect,
): Promise<RecommendedWorkflowTemplate> {
  const diagnostic = inspect(artifact.path, artifact.prompt, info);
  const hash = await storedHash(endpoint, artifact.path);
  const installation =
    hash === null ? "absent" : hash === artifact.hash ? "installed" : "different";
  const library =
    hash === artifact.hash ? await readWorkflowLibraryEntry(endpoint, artifact.path) : {};
  const problem =
    installation === "different"
      ? "同名模板已被修改，保留原文件；请使用已有工作流或创建可编辑副本。"
      : null;
  const confirmationToken =
    !problem && diagnostic.executable
      ? createHash("sha256")
          .update(
            JSON.stringify({
              purpose: "takeboard-template-install-v1",
              endpoint,
              path: artifact.path,
              hash: artifact.hash,
              stored: hash,
              checks: diagnostic.checks,
            }),
          )
          .digest("hex")
      : null;
  return {
    id: artifact.id,
    capability: artifact.capability,
    name: artifact.name,
    path: artifact.path,
    version: artifact.version,
    bytes: artifact.bytes,
    installation,
    included: library.included === true,
    diagnostic,
    problem,
    confirmationToken,
  };
}

export function registerWorkflowTemplateRoutes(
  app: FastifyInstance,
  getEndpoint: () => string,
  inspect: Inspect,
) {
  // Capture a single device per request; confirmations are bound to that device and graph.
  const pending = new Set<string>();
  app.get("/api/workflows/templates", async () => {
    const endpoint = getEndpoint();
    const info = await fetchComfyObjectInfo(endpoint).catch(() => null);
    const templates = await Promise.all(
      recommendedArtifacts().map(async (artifact): Promise<RecommendedWorkflowTemplate> => {
        try {
          if (!info) throw new Error("请先连接生成设备，再检查模板是否可用。");
          return await inspectArtifact(endpoint, artifact, info, inspect);
        } catch {
          return {
            id: artifact.id,
            capability: artifact.capability,
            name: artifact.name,
            path: artifact.path,
            version: artifact.version,
            bytes: artifact.bytes,
            installation: "unknown",
            included: false,
            diagnostic: null,
            confirmationToken: null,
            problem: info
              ? "暂时无法读取设备上的模板，请检查连接后重试。"
              : "请先连接生成设备，再检查模板是否可用。",
          };
        }
      }),
    );
    return { templates };
  });
  app.get<{ Params: { id: string } }>("/api/workflows/templates/:id/download", (request, reply) => {
    const artifact = recommendedArtifacts().find((item) => item.id === request.params.id);
    if (!artifact) return reply.code(404).send({ error: "推荐模板不存在" });
    return reply
      .header("content-disposition", `attachment; filename="${artifact.filename}"`)
      .send(artifact.prompt);
  });
  app.post<{ Params: { id: string }; Body: { confirmationToken?: string } }>(
    "/api/workflows/templates/:id/install",
    async (request, reply) => {
      const artifact = recommendedArtifacts().find((item) => item.id === request.params.id);
      if (!artifact) return reply.code(404).send({ error: "推荐模板不存在" });
      if (typeof request.body?.confirmationToken !== "string")
        return reply.code(400).send({ error: "请先检查模板并确认添加。" });
      const endpoint = getEndpoint();
      const key = `${endpoint}:${artifact.path}`;
      if (pending.has(key))
        return reply.code(409).send({ error: "此模板正在添加，请稍后重新检查。" });
      pending.add(key);
      try {
        const info = await fetchComfyObjectInfo(endpoint);
        const checked = await inspectArtifact(endpoint, artifact, info, inspect);
        if (
          !checked.confirmationToken ||
          request.body.confirmationToken !== checked.confirmationToken
        )
          return reply
            .code(409)
            .send({ error: "设备、模板或依赖状态已变化。请重新检查后再添加。" });
        if (checked.installation === "absent") {
          const response = await fetch(`${fileUrl(endpoint, artifact.path)}?overwrite=false`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(artifact.prompt),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok && response.status !== 409)
            throw new Error("模板写入未确认，请重新检查后重试；不会重复创建其他文件。");
        }
        if ((await storedHash(endpoint, artifact.path)) !== artifact.hash)
          return reply.code(409).send({ error: "模板文件与推荐版本不一致，未覆盖原文件。" });
        try {
          await updateWorkflowLibraryEntry(endpoint, artifact.path, { included: true });
        } catch {
          return reply
            .code(502)
            .send({ error: "模板已保存，但未加入列表。请重新检查并再次添加。" });
        }
        return { path: artifact.path, version: artifact.version, installed: true };
      } catch {
        return reply.code(502).send({
          error:
            "添加结果未确认。请检查设备连接，重新检查模板后再添加；已写入的同版本文件会被保留。",
        });
      } finally {
        pending.delete(key);
      }
    },
  );
}
