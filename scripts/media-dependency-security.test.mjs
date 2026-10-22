import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const server = createRequire(new URL("../apps/server/package.json", import.meta.url));
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const root = createRequire(new URL("../package.json", import.meta.url));
const vitest = createRequire(root.resolve("vitest/package.json"));
const multipart = createRequire(server.resolve("@fastify/multipart"));
const postcss = createRequire(createRequire(web.resolve("vite")).resolve("postcss"));
const atLeast = (actual, floor) => {
  const a = actual.split(".").map(Number);
  const b = floor.split(".").map(Number);
  assert.ok(a.length >= 3 && a.every(Number.isFinite), actual);
  return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
};

for (const [label, resolveFrom] of [
  ["web", web],
  ["Vitest", vitest],
]) {
  test(`${label} resolves the patched Vite, including its transitive dependency path`, () => {
    const version = resolveFrom("vite/package.json").version;
    assert.ok(atLeast(version, "8.2.4"), `${label}: Vite ${version}`);
  });
}

test("Vitest resolves the patched mocker rather than retaining the old lockfile entry", () => {
  assert.ok(atLeast(root("vitest/package.json").version, "4.1.12"));
  assert.ok(atLeast(vitest("@vitest/mocker/package.json").version, "4.1.12"));
});

test("manual mock URLs and export names remain data, not generated JavaScript", async () => {
  const { createManualModuleSource } = await import(vitest.resolve("@vitest/mocker/node"));
  const url = 'asset"); throw new Error("URL was executed"); //';
  const name = 'result"with\\quotes';
  const seen = [];
  const accessor = "__takeboard_security_mocker__";
  assert.equal(Object.hasOwn(globalThis, accessor), false);
  globalThis[accessor] = {
    async getFactoryModule(value) {
      seen.push(value);
      return { [name]: 42 };
    },
  };
  try {
    // GHSA-qxg6-89mg-rqv8: exercise the published serializer without a network server.
    const source = createManualModuleSource(url, [name], JSON.stringify(accessor));
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    assert.deepEqual(seen, [url]);
    assert.equal(module[name], 42);
  } finally {
    delete globalThis[accessor];
  }
});

test("sharp loads the patched native SVG library, not just an updated JS wrapper", async () => {
  const sharp = server("sharp");
  assert.ok(atLeast(sharp.versions.sharp, "0.35.5"), sharp.versions.sharp);
  assert.ok(
    sharp.versions.rsvg && atLeast(sharp.versions.rsvg, "2.63.2"),
    JSON.stringify(sharp.versions),
  );
  // No exploit payload: exercise the patched decoder with a harmless vector.
  const image = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#8060c0"/></svg>',
  );
  const { info } = await sharp(image)
    .resize({ width: 16 })
    .png()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 16);
  assert.equal(info.height, 8);
});

test("ordinary PNG, JPEG and WebP still produce usable image proxies", async () => {
  const sharp = server("sharp");
  for (const format of ["png", "jpeg", "webp"]) {
    const input = await sharp({
      create: { width: 24, height: 48, channels: 3, background: "#745ab8" },
    })
      .toFormat(format)
      .toBuffer();
    const { info } = await sharp(input)
      .resize({ width: 12, height: 12, fit: "inside" })
      .jpeg()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 6);
    assert.equal(info.height, 12);
    assert.equal(info.format, "jpeg");
  }
});

for (const part of ["filename", "name"]) {
  for (const newline of ["\r", "\n"]) {
    test(`multipart rejects bare ${JSON.stringify(newline)} in ${part} without losing the next valid file`, async (t) => {
      const app = server("fastify")();
      t.after(() => app.close());
      await app.register(server("@fastify/multipart"));
      app.post("/upload", async (request) => {
        const files = [];
        for await (const file of request.files()) {
          files.push({
            name: file.fieldname,
            filename: file.filename,
            body: (await file.toBuffer()).toString(),
          });
        }
        return files;
      });
      const badName = part === "name" ? `unsafe${newline}field` : "media";
      const badFile = part === "filename" ? `unsafe${newline}image.png` : "image.png";
      const payload = `--takeboard-boundary\r\nContent-Disposition: form-data; name="${badName}"; filename="${badFile}"\r\nContent-Type: image/png\r\n\r\nbad\r\n--takeboard-boundary\r\nContent-Disposition: form-data; name="media"; filename="参考.png"\r\nContent-Type: image/png\r\n\r\ngood\r\n--takeboard-boundary--\r\n`;
      const response = await app.inject({
        method: "POST",
        url: "/upload",
        headers: { "content-type": "multipart/form-data; boundary=takeboard-boundary" },
        payload,
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(response.statusCode, 200, response.body);
      const files = response.json();
      assert.equal(files.length, 1, response.body);
      assert.equal(files[0].name, "media");
      assert.equal(files[0].body, "good");
      assert.ok(!/[\r\n]/.test(files[0].filename));
      assert.ok(atLeast(multipart("@fastify/busboy/package.json").version, "3.2.2"));
    });
  }
}

test("Vite's source-map dependency rejects oversized and nested offsets in a bounded subprocess", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "-e",
      `
    const assert = require('node:assert/strict');
    const { SourceMapConsumer, SourceNode } = require(process.argv[1]);
    const leaf = {version:3,sources:['scene.js'],sourcesContent:['scene();'],names:[],mappings:'AAAA'};
    const indexed = (line, map = leaf) => ({version:3,sections:[{offset:{line,column:0},map}]});
    for (const line of [1e12, -1, 1.5, Infinity, '8'])
      assert.throws(() => new SourceMapConsumer(indexed(line)));
    assert.throws(() => new SourceMapConsumer(indexed(6e6, indexed(6e6))));
    const text = 'scene();\\n';
    const node = SourceNode.fromStringWithSourceMap(text, new SourceMapConsumer(indexed(1e7)));
    assert.equal(node.toString(), text);
    assert.ok(node.children.length < 10);
    const normal = new SourceMapConsumer(leaf);
    assert.equal(normal.originalPositionFor({line:1,column:0}).source, 'scene.js');
  `,
      postcss.resolve("source-map-js"),
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
