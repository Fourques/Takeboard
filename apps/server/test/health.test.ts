import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /api/health", () => {
  it("reports a local TakeBoard server", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "takeboard-server",
      status: "ok",
      version: "0.0.0",
    });
  });
});
