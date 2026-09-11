import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

afterEach(() => vi.unstubAllGlobals());
describe("workflow library preferences", () => {
  it("keeps source and binding unchanged when renaming, adding, favoriting and removing", async () => {
    const path = "Kino/Kino_MinimaxH3_R2V.json";
    const docs = new Map<string, unknown>([[`workflows/${path}`, { nodes: [] }]]);
    const writes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = decodeURIComponent(String(input));
        const file = url.split("/api/userdata/")[1];
        if (!file) throw new Error(`Unexpected request: ${url}`);
        if (init?.method === "POST") {
          writes.push(file);
          docs.set(file, JSON.parse(String(init.body)));
          return Response.json({});
        }
        return docs.has(file) ? Response.json(docs.get(file)) : new Response("", { status: 404 });
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    try {
      for (const payload of [
        { included: true },
        { name: "人物与宠物" },
        { favorite: true },
        { included: false },
      ]) {
        const response = await app.inject({
          method: "PUT",
          url: `/api/workflows/library?path=${encodeURIComponent(path)}`,
          payload,
        });
        expect(response.statusCode, response.body).toBe(200);
      }
      expect(docs.get(`takeboard/library/${Buffer.from(path).toString("base64url")}.json`)).toEqual(
        { included: false, favorite: true, name: "人物与宠物" },
      );
      expect(docs.get(`workflows/${path}`)).toEqual({ nodes: [] });
      expect(writes).toHaveLength(4);
      expect(writes.every((file) => file.startsWith("takeboard/library/"))).toBe(true);
      const parallel = await Promise.all([
        app.inject({
          method: "PUT",
          url: `/api/workflows/library?path=${encodeURIComponent(path)}`,
          payload: { name: "新的名称" },
        }),
        app.inject({
          method: "PUT",
          url: `/api/workflows/library?path=${encodeURIComponent(path)}`,
          payload: { included: true },
        }),
      ]);
      expect(parallel.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(docs.get(`takeboard/library/${Buffer.from(path).toString("base64url")}.json`)).toEqual(
        { included: true, favorite: true, name: "新的名称" },
      );
      const copy = await app.inject({
        method: "POST",
        url: "/api/workflows/copy",
        payload: { path },
      });
      expect(copy.statusCode, copy.body).toBe(201);
      expect(copy.json()).toMatchObject({
        execution: "comfy_only",
        bindingStatus: "needs_binding",
        origin: "imported",
      });
      expect(docs.get(`workflows/${copy.json().path}`)).toEqual({ nodes: [] });
      expect(writes.some((file) => file.startsWith("takeboard/bindings/"))).toBe(false);
      expect(docs.get(`workflows/${path}`)).toEqual({ nodes: [] });
      const invalid = await app.inject({
        method: "PUT",
        url: `/api/workflows/library?path=${encodeURIComponent(path)}`,
        payload: { trusted: true },
      });
      expect(invalid.statusCode).toBe(400);
      const traversal = await app.inject({
        method: "PUT",
        url: "/api/workflows/library?path=../secret.json",
        payload: { name: "oops" },
      });
      expect(traversal.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
