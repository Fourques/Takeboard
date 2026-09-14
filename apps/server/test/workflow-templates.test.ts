import type { RecommendedWorkflowTemplate, WorkflowDiagnostic } from "@takeboard/contracts";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { recommendedArtifacts, registerWorkflowTemplateRoutes } from "../src/workflow-templates.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

function setup() {
  const files = new Map<string, unknown>();
  const writes: { path: string; overwrite: string | null }[] = [];
  const state = {
    endpoint: "http://comfy.test",
    compatible: true,
    offline: false,
    metadataFails: false,
    loseWriteReply: false,
    corruptWrite: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (state.offline) throw new Error("offline");
      const url = new URL(String(input));
      if (url.pathname === "/object_info") return Response.json({});
      const path = decodeURIComponent(url.pathname.replace("/api/userdata/", ""));
      if (init?.method === "POST") {
        writes.push({ path, overwrite: url.searchParams.get("overwrite") });
        if (path.startsWith("takeboard/library/") && state.metadataFails)
          return new Response("unavailable", { status: 503 });
        if (files.has(path) && url.searchParams.get("overwrite") === "false")
          return new Response("exists", { status: 409 });
        files.set(path, state.corruptWrite ? {} : JSON.parse(String(init.body)));
        if (state.loseWriteReply) throw new Error("response lost");
        return Response.json({});
      }
      return files.has(path)
        ? Response.json(files.get(path))
        : new Response("missing", { status: 404 });
    }),
  );
  const app = Fastify();
  apps.push(app);
  registerWorkflowTemplateRoutes(
    app,
    () => state.endpoint,
    (path) =>
      ({
        path,
        workflowHash: "a".repeat(64),
        executable: state.compatible,
        health: state.compatible ? "ready" : "blocked",
        nodeCount: 1,
        capability: "text_to_video",
        outputMediaType: "video",
        bindingStatus: "built_in",
        modelStatus: "ready",
        models: [],
        missingModels: [],
        missingNodeTypes: [],
        checks: [],
      }) satisfies WorkflowDiagnostic,
  );
  const list = async (): Promise<
    [RecommendedWorkflowTemplate, ...RecommendedWorkflowTemplate[]]
  > => {
    const templates = (await app.inject("/api/workflows/templates")).json()
      .templates as RecommendedWorkflowTemplate[];
    const first = templates[0];
    if (!first) throw new Error("Expected a nonempty maintained catalog");
    return [first, ...templates.slice(1)];
  };
  const install = (template: RecommendedWorkflowTemplate) =>
    app.inject({
      method: "POST",
      url: `/api/workflows/templates/${template.id}/install`,
      payload: { confirmationToken: template.confirmationToken },
    });
  return { app, state, files, writes, list, install };
}

describe("maintained template installation", () => {
  it("uses real route diagnostics and exposes installed artifacts as runnable native workflows", async () => {
    const artifacts = recommendedArtifacts();
    const files = new Map<string, unknown>();
    const info: Record<string, { input: { required: Record<string, unknown> } }> = {};
    for (const artifact of artifacts)
      for (const node of Object.values(artifact.prompt)) {
        const definition = info[node.class_type] ?? { input: { required: {} } };
        info[node.class_type] = definition;
        const fields = definition.input.required;
        for (const [field, value] of Object.entries(node.inputs)) {
          if (typeof value === "string" && value.endsWith(".safetensors")) {
            const previous = fields[field] as [string[]] | undefined;
            fields[field] = [[...new Set([...(previous?.[0] ?? []), value])]];
          }
        }
      }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/object_info") return Response.json(info);
        if (url.searchParams.get("dir") === "workflows")
          return Response.json(
            [...files.keys()]
              .filter((path) => path.startsWith("workflows/"))
              .map((path) => path.slice(10)),
          );
        const path = decodeURIComponent(url.pathname.replace("/api/userdata/", ""));
        if (init?.method === "POST") {
          files.set(path, JSON.parse(String(init.body)));
          return Response.json({});
        }
        return files.has(path)
          ? Response.json(files.get(path))
          : new Response("missing", { status: 404 });
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);
    const catalog = (await app.inject("/api/workflows/templates")).json().templates;
    expect(catalog).toHaveLength(9);
    expect(
      catalog.every(
        (item: RecommendedWorkflowTemplate) =>
          item.diagnostic?.executable && item.confirmationToken,
      ),
    ).toBe(true);
    const h3 = catalog.find((item: RecommendedWorkflowTemplate) => item.id === "h3-t2v");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workflows/templates/h3-t2v/install",
          payload: { confirmationToken: h3.confirmationToken },
        })
      ).statusCode,
    ).toBe(200);
    const workflows = (await app.inject("/api/workflows")).json().workflows;
    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      path: h3.path,
      capability: "text_to_video",
      execution: "native",
      library: { included: true },
      diagnostic: { executable: true },
    });
    info.SaveVideo = { input: { required: { incompatible_new_input: ["STRING"] } } };
    const changed = (await app.inject("/api/workflows")).json().workflows[0];
    expect(changed.diagnostic).toMatchObject({ executable: false, health: "blocked" });
    expect(changed.diagnostic.checks).toContainEqual(
      expect.objectContaining({ code: "TAKEBOARD_NATIVE_TEMPLATE_INCOMPATIBLE" }),
    );
  });
  it("lists and downloads versioned builder artifacts without writing or running anything", async () => {
    const { app, list, writes } = setup();
    const templates = await list();
    expect(templates).toHaveLength(9);
    expect(new Set(templates.map((item) => item.path)).size).toBe(9);
    for (const template of templates) {
      expect(template).toMatchObject({ installation: "absent", included: false });
      expect(template.confirmationToken).toMatch(/^[a-f0-9]{64}$/);
      const downloaded = await app.inject(`/api/workflows/templates/${template.id}/download`);
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["content-disposition"]).toContain("attachment");
      expect(downloaded.json()).toEqual(
        recommendedArtifacts().find((item) => item.id === template.id)?.prompt,
      );
    }
    expect(writes).toEqual([]);
  });

  it("installs only the selected template and supports idempotent re-adding without overwriting", async () => {
    const { list, install, writes, files } = setup();
    const template = (await list())[0];
    expect((await install(template)).statusCode).toBe(200);
    const installed = (await list())[0];
    expect(installed).toMatchObject({ installation: "installed", included: true });
    const metadataPath = `takeboard/library/${Buffer.from(template.path).toString("base64url")}.json`;
    files.set(metadataPath, { included: false, favorite: true, name: "我的常用模板" });
    expect((await install(installed)).statusCode).toBe(200);
    expect(files.get(metadataPath)).toEqual({
      included: true,
      favorite: true,
      name: "我的常用模板",
    });
    expect(writes.filter((item) => item.path.startsWith("workflows/"))).toEqual([
      { path: `workflows/${template.path}`, overwrite: "false" },
    ]);
  });

  it("rejects stale confirmations after device changes or dependency loss", async () => {
    const { list, install, state, writes } = setup();
    const template = (await list())[0];
    state.endpoint = "http://other-device.test";
    expect((await install(template)).statusCode).toBe(409);
    state.endpoint = "http://comfy.test";
    state.compatible = false;
    expect((await install(template)).statusCode).toBe(409);
    expect((await list())[0].confirmationToken).toBeNull();
    expect(writes).toEqual([]);
  });

  it("preserves modified and historical files, including a file changed after inspection", async () => {
    const { list, install, files, writes } = setup();
    const template = (await list())[0];
    const original = { nodes: [{ id: 1, type: "UserCustom" }] };
    files.set(`workflows/${template.path}`, original);
    files.set("workflows/Kino/Kino_MinimaxH3_T2V.json", original);
    expect((await install(template)).statusCode).toBe(409);
    expect((await list())[0]).toMatchObject({ installation: "different", confirmationToken: null });
    expect(files.get(`workflows/${template.path}`)).toEqual(original);
    expect(files.get("workflows/Kino/Kino_MinimaxH3_T2V.json")).toEqual(original);
    expect(writes).toEqual([]);
  });

  it.each(["metadataFails", "loseWriteReply"] as const)(
    "recovers %s by checking existing content, without duplicate files",
    async (failure) => {
      const { list, install, files, writes, state } = setup();
      state[failure] = true;
      expect((await install((await list())[0])).statusCode).toBe(502);
      state[failure] = false;
      const partial = (await list())[0];
      expect(partial).toMatchObject({ installation: "installed", included: false });
      expect((await install(partial)).statusCode).toBe(200);
      expect((await list())[0].included).toBe(true);
      expect([...files.keys()].filter((path) => path.startsWith("workflows/"))).toHaveLength(1);
      expect(writes.filter((item) => item.path.startsWith("workflows/"))).toHaveLength(1);
    },
  );

  it("never marks an unverified write as installed", async () => {
    const { list, install, state, writes } = setup();
    state.corruptWrite = true;
    expect((await install((await list())[0])).statusCode).toBe(409);
    expect(writes.some((item) => item.path.startsWith("takeboard/library/"))).toBe(false);
  });

  it("keeps offline downloads accessible but prevents unchecked installation", async () => {
    const { app, list, state, writes } = setup();
    state.offline = true;
    const templates = await list();
    expect(templates).toHaveLength(9);
    expect(
      templates.every((item) => item.confirmationToken === null && item.installation === "unknown"),
    ).toBe(true);
    expect(
      (await app.inject(`/api/workflows/templates/${templates[0].id}/download`)).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workflows/templates/h3-t2v/install",
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workflows/templates/unknown/install",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(writes).toEqual([]);
  });
});
