import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

async function inject(app, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    return await app.inject({ ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Resolve each application's own dependency rather than a test-only copy.
for (const name of ["server", "portal"]) {
  const require = createRequire(new URL(`../apps/${name}/package.json`, import.meta.url));
  const Fastify = require("fastify");

  test(`${name}: mixed-case header dependencies cannot bypass validation (GHSA-9q9j-q6p8-xq58)`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    let calls = 0;
    app.get(
      "/headers",
      {
        schema: {
          headers: {
            type: "object",
            properties: { "X-Action": { type: "string" }, "X-Action-Token": { type: "string" } },
            dependencies: { "X-Action": ["X-Action-Token"] },
          },
        },
      },
      async () => {
        calls++;
        return { ok: true };
      },
    );
    const blocked = await inject(app, { url: "/headers", headers: { "x-action": "edit" } });
    assert.equal(blocked.statusCode, 400, blocked.body);
    assert.equal(calls, 0);
    const allowed = await inject(app, {
      url: "/headers",
      headers: { "X-Action": "edit", "X-Action-Token": "test-token" },
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.equal(calls, 1);
  });

  test(`${name}: false schemas reject every request part (GHSA-hwr6-493r-vm6h)`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    let calls = 0;
    for (const part of ["body", "querystring", "query", "params", "headers"]) {
      app.post(`/${part}/:id`, { schema: { [part]: false } }, async () => {
        calls++;
        return { forbidden: true };
      });
    }
    for (const part of ["body", "querystring", "query", "params", "headers"]) {
      const response = await inject(app, {
        method: "POST",
        url: `/${part}/one?q=test`,
        payload: { action: "edit" },
      });
      assert.equal(response.statusCode, 400, `${part}: ${response.body}`);
    }
    assert.equal(calls, 0);
  });

  test(`${name}: malformed URLs never reach a sibling private fallback (GHSA-p68q-wchp-6fh7)`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    let privateCalls = 0;
    app.register(
      async (scope) => {
        scope.get("/ok", async () => ({ public: true }));
        scope.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ public: true }));
      },
      { prefix: "/public" },
    );
    app.register(
      async (scope) => {
        scope.setNotFoundHandler(
          {
            preHandler: async (_request, reply) =>
              reply.code(401).send({ error: "Authentication required" }),
          },
          async () => {
            privateCalls++;
            return { private: true };
          },
        );
      },
      { prefix: "/private" },
    );
    for (const method of ["GET", "POST", "DELETE"]) {
      for (const url of ["/public/%", "/public/%ZZ", "/public/%E0%A4%A"]) {
        const response = await inject(app, { method, url });
        assert.equal(response.statusCode, 400, `${method} ${url}: ${response.body}`);
        assert.ok(!response.body.includes('"private":true'));
      }
    }
    const privateResponse = await inject(app, { url: "/private/missing" });
    assert.equal(privateResponse.statusCode, 401, privateResponse.body);
    const publicResponse = await inject(app, { url: "/public/ok" });
    assert.equal(publicResponse.statusCode, 200, publicResponse.body);
    assert.equal(privateCalls, 0);
  });

  test(`${name}: async validation preserves the validated body (GHSA-667r-xxjv-c9mm)`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    app.post(
      "/async",
      {
        schema: {
          body: {
            $async: true,
            type: "object",
            required: ["action", "value"],
            properties: {
              action: { const: "preview" },
              value: { type: "object" },
              error: { type: "string" },
            },
          },
        },
      },
      async (request) => request.body,
    );
    const payload = { action: "preview", value: { action: "delete" } };
    for (const validPayload of [payload, { ...payload, error: "payload-field" }]) {
      const valid = await inject(app, { method: "POST", url: "/async", payload: validPayload });
      assert.equal(valid.statusCode, 200, valid.body);
      assert.deepEqual(valid.json(), validPayload);
    }
    const invalid = await inject(app, {
      method: "POST",
      url: "/async",
      payload: { ...payload, action: "delete" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
  });

  test(`${name}: HTTP/2 trailers do not crash the process (GHSA-4mh8-r7rc-xpvc)`, () => {
    // An affected version terminates the process; isolate it so other regressions still run.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const assert = require('node:assert/strict');
      const http2 = require('node:http2');
      const Fastify = require(process.argv[1]);
      (async () => {
        const app = Fastify({ http2: true });
        app.get('/trailer', async (_request, reply) => {
          reply.trailer('x-proof', async () => 'complete');
          return 'frame';
        });
        app.get('/health', async () => 'ok');
        const origin = await app.listen({ host: '127.0.0.1', port: 0 });
        const client = http2.connect(origin);
        try {
          async function request(path) {
            return await new Promise((resolve, reject) => {
              const stream = client.request({ ':path': path });
              let body = '', headers, trailers;
              stream.setEncoding('utf8');
              stream.on('response', (value) => { headers = value; });
              stream.on('trailers', (value) => { trailers = value; });
              stream.on('data', (value) => { body += value; });
              stream.on('error', reject);
              stream.on('end', () => resolve({ body, headers, trailers }));
              stream.end();
            });
          }
          const first = await request('/trailer');
          assert.equal(first.headers[':status'], 200);
          assert.equal(first.headers['transfer-encoding'], undefined);
          assert.equal(first.body, 'frame');
          assert.equal(first.trailers['x-proof'], 'complete');
          assert.equal((await request('/health')).body, 'ok');
        } finally {
          client.destroy();
          await app.close();
        }
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `,
        require.resolve("fastify"),
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
  });
}
